#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?Set DATABASE_URL to a disposable Supabase/Postgres database}"

psql_bin="${PSQL_BIN:-psql}"
command -v "$psql_bin" >/dev/null 2>&1 || {
  echo "psql is required (or set PSQL_BIN to a compatible wrapper)" >&2
  exit 2
}

readonly statement_timeout="12s"
readonly lock_timeout="8s"
readonly idle_transaction_timeout="10s"
readonly holder_sleep_seconds="3"
readonly activity_poll_attempts="50"
readonly activity_poll_delay="0.1"

test_tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/nexez-plan-concurrency.XXXXXX")"
background_pids=()

psql_with_limits() {
  local application_name="$1"
  shift

  PGAPPNAME="$application_name" \
    PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-5}" \
    PGOPTIONS="-c statement_timeout=${statement_timeout} -c lock_timeout=${lock_timeout} -c idle_in_transaction_session_timeout=${idle_transaction_timeout}" \
    "$psql_bin" "$DATABASE_URL" \
      -X \
      --set=ON_ERROR_STOP=1 \
      --set=VERBOSITY=verbose \
      "$@"
}

kill_background_sessions() {
  local pid
  for pid in "${background_pids[@]-}"; do
    [[ -n "$pid" ]] || continue
    if kill -0 "$pid" >/dev/null 2>&1; then
      kill "$pid" >/dev/null 2>&1 || true
    fi
  done
  for pid in "${background_pids[@]-}"; do
    [[ -n "$pid" ]] || continue
    wait "$pid" >/dev/null 2>&1 || true
  done
  background_pids=()
}

delete_test_data() {
  psql_with_limits "nexez-concurrency-cleanup" -q <<'SQL'
delete from auth.users
where id in (
  'ac000000-0000-0000-0000-000000000001',
  'ac000000-0000-0000-0000-000000000002',
  'ac000000-0000-0000-0000-000000000003',
  'ac000000-0000-0000-0000-000000000004',
  'ac000000-0000-0000-0000-000000000005',
  'ac000000-0000-0000-0000-000000000006',
  'ac000000-0000-0000-0000-000000000007',
  'ac000000-0000-0000-0000-000000000008',
  'ac000000-0000-0000-0000-000000000009'
);

delete from public.seller_growth_campaigns
where id = 'ca000000-0000-0000-0000-000000000001';
SQL
}

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  kill_background_sessions
  delete_test_data >/dev/null 2>&1 || true
  rm -rf "$test_tmp_dir"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

print_pair_logs() {
  local name="$1"
  local log_file
  for log_file in \
    "$test_tmp_dir/${name}-holder.log" \
    "$test_tmp_dir/${name}-contender.log" \
    "$test_tmp_dir/${name}-retry.log"; do
    if [[ -f "$log_file" ]]; then
      sed -n '1,200p' "$log_file" >&2 || true
    fi
  done
}

wait_for_session_state() {
  local application_name="$1"
  local expected_sql="$2"
  local process_pid="$3"
  local description="$4"
  local poll_log="$test_tmp_dir/${application_name}-poll.log"
  local observed
  local attempt=0

  if [[ ! "$application_name" =~ ^[a-z0-9-]+$ ]]; then
    echo "${description}: unsafe application name" >&2
    return 1
  fi

  while (( attempt < activity_poll_attempts )); do
    if ! kill -0 "$process_pid" >/dev/null 2>&1; then
      echo "${description}: database session exited before reaching the expected state" >&2
      return 1
    fi

    if ! observed="$({
      psql_with_limits "nexez-concurrency-observer" -Atq \
        -c "select exists (
              select 1
              from pg_catalog.pg_stat_activity
              where application_name = '${application_name}'
                and ${expected_sql}
            )"
    } 2>"$poll_log")"; then
      echo "${description}: failed while inspecting pg_stat_activity" >&2
      sed -n '1,160p' "$poll_log" >&2 || true
      return 1
    fi

    if [[ "$observed" == "t" ]]; then
      return 0
    fi

    sleep "$activity_poll_delay"
    attempt=$((attempt + 1))
  done

  echo "${description}: session never reached the expected database wait state" >&2
  return 1
}

wait_for_lock_or_exit() {
  local application_name="$1"
  local process_pid="$2"
  local description="$3"
  local poll_log="$test_tmp_dir/${application_name}-poll.log"
  local observed
  local attempt=0

  if [[ ! "$application_name" =~ ^[a-z0-9-]+$ ]]; then
    echo "${description}: unsafe application name" >&2
    return 1
  fi

  while (( attempt < activity_poll_attempts )); do
    if ! kill -0 "$process_pid" >/dev/null 2>&1; then
      return 10
    fi

    if ! observed="$({
      psql_with_limits "nexez-concurrency-observer" -Atq \
        -c "select exists (
              select 1
              from pg_catalog.pg_stat_activity
              where application_name = '${application_name}'
                and state = 'active'
                and wait_event_type = 'Lock'
                and wait_event = 'advisory'
            )"
    } 2>"$poll_log")"; then
      echo "${description}: failed while inspecting pg_stat_activity" >&2
      sed -n '1,160p' "$poll_log" >&2 || true
      return 1
    fi

    if [[ "$observed" == "t" ]]; then
      return 0
    fi

    sleep "$activity_poll_delay"
    attempt=$((attempt + 1))
  done

  echo "${description}: neither blocked on the advisory lock nor exited" >&2
  return 1
}

assert_postgres_failure() {
  local label="$1"
  local process_status="$2"
  local log_file="$3"
  local expected_sqlstate="$4"
  local expected_message="$5"
  local error_count

  if [[ "$process_status" -eq 0 ]]; then
    echo "${label}: statement unexpectedly committed" >&2
    return 1
  fi

  error_count="$(grep -c '^ERROR:' "$log_file" || true)"
  if [[ "$error_count" -ne 1 ]]; then
    echo "${label}: expected exactly one PostgreSQL error, found ${error_count}" >&2
    return 1
  fi

  if ! grep -Eq "^ERROR:[[:space:]]+${expected_sqlstate}:" "$log_file"; then
    echo "${label}: expected SQLSTATE ${expected_sqlstate}" >&2
    return 1
  fi

  if ! grep '^ERROR:' "$log_file" \
    | grep -Fq "${expected_sqlstate}: ${expected_message}"; then
    echo "${label}: PostgreSQL returned the wrong SQLSTATE/message pair" >&2
    return 1
  fi

  if grep -Eq '^ERROR:[[:space:]]+(40P01|55P03|57014|08[0-9A-Z]{3}|28[0-9A-Z]{3}|42501|53300|57P0[123]):' "$log_file"; then
    echo "${label}: deadlock, timeout, permission, or connection failure cannot satisfy this test" >&2
    return 1
  fi
}

assert_quota_failure() {
  local label="$1"
  local process_status="$2"
  local log_file="$3"
  local expected_message="$4"

  assert_postgres_failure \
    "$label" \
    "$process_status" \
    "$log_file" \
    "23514" \
    "$expected_message"
}

assert_retryable_allocation_failure() {
  local label="$1"
  local process_status="$2"
  local log_file="$3"

  assert_postgres_failure \
    "$label" \
    "$process_status" \
    "$log_file" \
    "40001" \
    "NEXEZ_ENTITLEMENT_ALLOCATION_RETRY"
}

run_blocking_quota_pair() {
  local name="$1"
  local holder_sql="$2"
  local contender_sql="$3"
  local expected_message="$4"
  # PostgreSQL truncates application_name to 63 bytes. Keep both observer keys
  # below that boundary so synchronization cannot silently miss a live session.
  local holder_application="nzce-${name:0:48}-h"
  local contender_application="nzce-${name:0:48}-c"
  local holder_pid
  local contender_pid
  local holder_status
  local contender_status
  local contention_outcome
  local retry_status

  psql_with_limits "$holder_application" \
    -c "begin; ${holder_sql}; select pg_catalog.pg_sleep(${holder_sleep_seconds}); commit" \
    >"$test_tmp_dir/${name}-holder.log" 2>&1 &
  holder_pid=$!
  background_pids+=("$holder_pid")

  if ! wait_for_session_state \
    "$holder_application" \
    "state = 'active' and wait_event = 'PgSleep'" \
    "$holder_pid" \
    "${name} holder"; then
    print_pair_logs "$name"
    return 1
  fi

  psql_with_limits "$contender_application" \
    -c "$contender_sql" \
    >"$test_tmp_dir/${name}-contender.log" 2>&1 &
  contender_pid=$!
  background_pids+=("$contender_pid")

  if wait_for_lock_or_exit \
    "$contender_application" \
    "$contender_pid" \
    "${name} contender"; then
    contention_outcome="blocked"
  else
    contention_outcome=$?
    if [[ "$contention_outcome" -ne 10 ]]; then
      print_pair_logs "$name"
      return 1
    fi
    contention_outcome="retryable"
  fi

  if wait "$contender_pid"; then
    contender_status=0
  else
    contender_status=$?
  fi
  if wait "$holder_pid"; then
    holder_status=0
  else
    holder_status=$?
  fi

  if [[ "$holder_status" -ne 0 ]]; then
    echo "${name}: holder failed" >&2
    print_pair_logs "$name"
    return 1
  fi

  if [[ "$contention_outcome" == "blocked" ]]; then
    if ! assert_quota_failure \
      "$name" \
      "$contender_status" \
      "$test_tmp_dir/${name}-contender.log" \
      "$expected_message"; then
      print_pair_logs "$name"
      return 1
    fi

    background_pids=()
    echo "${name}: blocked, serialized, and rejected with SQLSTATE 23514"
    return 0
  fi

  if ! assert_retryable_allocation_failure \
    "${name} first attempt" \
    "$contender_status" \
    "$test_tmp_dir/${name}-contender.log"; then
    print_pair_logs "$name"
    return 1
  fi

  if psql_with_limits "${contender_application}-retry" \
    -c "$contender_sql" \
    >"$test_tmp_dir/${name}-retry.log" 2>&1; then
    retry_status=0
  else
    retry_status=$?
  fi

  if ! assert_quota_failure \
    "${name} retry" \
    "$retry_status" \
    "$test_tmp_dir/${name}-retry.log" \
    "$expected_message"; then
    print_pair_logs "$name"
    return 1
  fi

  background_pids=()
  echo "${name}: returned SQLSTATE 40001, then retry rejected with SQLSTATE 23514"
}

run_blocking_success_pair() {
  local name="$1"
  local holder_sql="$2"
  local contender_sql="$3"
  local holder_application="nzce-${name:0:48}-h"
  local contender_application="nzce-${name:0:48}-c"
  local holder_pid
  local contender_pid
  local holder_status
  local contender_status

  psql_with_limits "$holder_application" \
    -c "begin; ${holder_sql}; select pg_catalog.pg_sleep(${holder_sleep_seconds}); commit" \
    >"$test_tmp_dir/${name}-holder.log" 2>&1 &
  holder_pid=$!
  background_pids+=("$holder_pid")

  if ! wait_for_session_state \
    "$holder_application" \
    "state = 'active' and wait_event = 'PgSleep'" \
    "$holder_pid" \
    "${name} holder"; then
    print_pair_logs "$name"
    return 1
  fi

  psql_with_limits "$contender_application" \
    -c "$contender_sql" \
    >"$test_tmp_dir/${name}-contender.log" 2>&1 &
  contender_pid=$!
  background_pids+=("$contender_pid")

  if ! wait_for_session_state \
    "$contender_application" \
    "state = 'active' and wait_event_type = 'Lock' and wait_event = 'advisory'" \
    "$contender_pid" \
    "${name} contender"; then
    print_pair_logs "$name"
    return 1
  fi

  if wait "$contender_pid"; then
    contender_status=0
  else
    contender_status=$?
  fi
  if wait "$holder_pid"; then
    holder_status=0
  else
    holder_status=$?
  fi

  if [[ "$holder_status" -ne 0 || "$contender_status" -ne 0 ]]; then
    echo "${name}: expected both serialized operations to commit" >&2
    print_pair_logs "$name"
    return 1
  fi

  if grep -Eq '^ERROR:[[:space:]]+(40P01|55P03|57014|08[0-9A-Z]{3}|28[0-9A-Z]{3}|42501|53300|57P0[123]):' \
    "$test_tmp_dir/${name}-holder.log" \
    "$test_tmp_dir/${name}-contender.log"; then
    echo "${name}: deadlock, timeout, permission, or connection failure" >&2
    print_pair_logs "$name"
    return 1
  fi

  background_pids=()
  echo "${name}: observed ordered advisory blocking and both operations committed"
}

run_retryable_success_pair() {
  local name="$1"
  local holder_sql="$2"
  local contender_sql="$3"
  local holder_application="nzce-${name:0:48}-h"
  local contender_application="nzce-${name:0:48}-c"
  local holder_pid
  local contender_pid
  local holder_status
  local contender_status
  local retry_status

  psql_with_limits "$holder_application" \
    -c "begin; ${holder_sql}; select pg_catalog.pg_sleep(${holder_sleep_seconds}); commit" \
    >"$test_tmp_dir/${name}-holder.log" 2>&1 &
  holder_pid=$!
  background_pids+=("$holder_pid")

  if ! wait_for_session_state \
    "$holder_application" \
    "state = 'active' and wait_event = 'PgSleep'" \
    "$holder_pid" \
    "${name} holder"; then
    print_pair_logs "$name"
    return 1
  fi

  psql_with_limits "$contender_application" \
    -c "$contender_sql" \
    >"$test_tmp_dir/${name}-contender.log" 2>&1 &
  contender_pid=$!
  background_pids+=("$contender_pid")

  if wait "$contender_pid"; then
    contender_status=0
  else
    contender_status=$?
  fi

  if ! assert_retryable_allocation_failure \
    "${name} first attempt" \
    "$contender_status" \
    "$test_tmp_dir/${name}-contender.log"; then
    print_pair_logs "$name"
    return 1
  fi

  if wait "$holder_pid"; then
    holder_status=0
  else
    holder_status=$?
  fi

  if [[ "$holder_status" -ne 0 ]]; then
    echo "${name}: holder failed" >&2
    print_pair_logs "$name"
    return 1
  fi

  if psql_with_limits "${contender_application}-retry" \
    -c "$contender_sql" \
    >"$test_tmp_dir/${name}-retry.log" 2>&1; then
    retry_status=0
  else
    retry_status=$?
  fi

  if [[ "$retry_status" -ne 0 ]]; then
    echo "${name}: retry failed after the holder committed" >&2
    print_pair_logs "$name"
    return 1
  fi

  if grep -Eq '^ERROR:[[:space:]]+(40P01|55P03|57014|08[0-9A-Z]{3}|28[0-9A-Z]{3}|42501|53300|57P0[123]):' \
    "$test_tmp_dir/${name}-holder.log" \
    "$test_tmp_dir/${name}-retry.log"; then
    echo "${name}: deadlock, timeout, permission, or connection failure" >&2
    print_pair_logs "$name"
    return 1
  fi

  background_pids=()
  echo "${name}: returned SQLSTATE 40001, then retry committed after the holder"
}

delete_test_data >/dev/null

timeout_settings="$(
  psql_with_limits "nexez-concurrency-preflight" -Atq -F '|' \
    -c "select
          current_setting('statement_timeout'),
          current_setting('lock_timeout'),
          current_setting('idle_in_transaction_session_timeout')"
)"
if [[ "$timeout_settings" != "${statement_timeout}|${lock_timeout}|${idle_transaction_timeout}" ]]; then
  echo "concurrency preflight: database session timeouts were not applied" >&2
  exit 1
fi

psql_with_limits "nexez-concurrency-fixtures" <<'SQL'
begin;

insert into auth.users (id) values
  ('ac000000-0000-0000-0000-000000000001'),
  ('ac000000-0000-0000-0000-000000000002'),
  ('ac000000-0000-0000-0000-000000000003'),
  ('ac000000-0000-0000-0000-000000000004'),
  ('ac000000-0000-0000-0000-000000000005'),
  ('ac000000-0000-0000-0000-000000000006');

insert into public.seller_growth_campaigns (
  id,
  campaign_key,
  name,
  status,
  enrollment_mode,
  grant_plan_id,
  grant_duration_days,
  invite_slots,
  invite_expires_days,
  max_grants,
  starts_at,
  signup_closes_at
) values (
  'ca000000-0000-0000-0000-000000000001',
  'plan-entitlement-concurrency',
  'Plan entitlement concurrency',
  'active',
  'open',
  'launch',
  30,
  0,
  14,
  1,
  statement_timestamp() - interval '1 second',
  statement_timestamp() + interval '1 hour'
);

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
) values
  (
    '00000000-0000-0000-0000-000000000000',
    'ac000000-0000-0000-0000-000000000007',
    'authenticated',
    'authenticated',
    'growth-concurrency-one@example.test',
    '',
    statement_timestamp(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    statement_timestamp(),
    statement_timestamp()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'ac000000-0000-0000-0000-000000000008',
    'authenticated',
    'authenticated',
    'growth-concurrency-two@example.test',
    '',
    statement_timestamp(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    statement_timestamp(),
    statement_timestamp()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'ac000000-0000-0000-0000-000000000009',
    'authenticated',
    'authenticated',
    'growth-downgrade-race@example.test',
    '',
    statement_timestamp(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    statement_timestamp(),
    statement_timestamp()
  );

insert into public.billing_subscriptions (owner_id, plan_id, status, account_origin) values
  ('ac000000-0000-0000-0000-000000000001', 'free', 'active', 'free'),
  ('ac000000-0000-0000-0000-000000000002', 'pro', 'active', 'legacy'),
  ('ac000000-0000-0000-0000-000000000003', 'launch', 'active', 'legacy'),
  ('ac000000-0000-0000-0000-000000000004', 'free', 'active', 'free'),
  ('ac000000-0000-0000-0000-000000000005', 'pro', 'active', 'legacy'),
  ('ac000000-0000-0000-0000-000000000006', 'launch', 'active', 'legacy'),
  ('ac000000-0000-0000-0000-000000000007', 'free', 'active', 'free'),
  ('ac000000-0000-0000-0000-000000000008', 'free', 'active', 'free'),
  ('ac000000-0000-0000-0000-000000000009', 'pro', 'active', 'legacy');

insert into public.team_invites (owner_id, email, role, status) values
  ('ac000000-0000-0000-0000-000000000002', 'concurrency-seat-one@example.test', 'viewer', 'accepted'),
  ('ac000000-0000-0000-0000-000000000002', 'concurrency-seat-two@example.test', 'viewer', 'accepted');

insert into public.pages (id, owner_id, name, slug, custom_domain, custom_domain_verified, domain_path, is_published) values
  ('dc000000-0000-0000-0000-000000000001', 'ac000000-0000-0000-0000-000000000003', 'Concurrency domain one', 'concurrency-domain-one', 'concurrency-one.example.test', null, '/', false),
  ('dc000000-0000-0000-0000-000000000002', 'ac000000-0000-0000-0000-000000000003', 'Concurrency domain two', 'concurrency-domain-two', 'concurrency-two.example.test', null, '/', false),
  ('dc000000-0000-0000-0000-000000000003', 'ac000000-0000-0000-0000-000000000004', 'Concurrency listing one', 'concurrency-listing-one', null, null, '/', false),
  ('dc000000-0000-0000-0000-000000000004', 'ac000000-0000-0000-0000-000000000004', 'Concurrency listing two', 'concurrency-listing-two', null, null, '/', false),
  ('dc000000-0000-0000-0000-000000000005', 'ac000000-0000-0000-0000-000000000005', 'Downgrade listing keeper', 'downgrade-listing-keeper', null, null, '/', true),
  ('dc000000-0000-0000-0000-000000000006', 'ac000000-0000-0000-0000-000000000005', 'Downgrade listing contender', 'downgrade-listing-contender', null, null, '/', false),
  ('dc000000-0000-0000-0000-000000000007', 'ac000000-0000-0000-0000-000000000006', 'Downgrade domain keeper', 'downgrade-domain-keeper', 'downgrade-domain-one.example.test', statement_timestamp(), '/', false),
  ('dc000000-0000-0000-0000-000000000008', 'ac000000-0000-0000-0000-000000000006', 'Downgrade domain contender', 'downgrade-domain-contender', 'downgrade-domain-two.example.test', null, '/', false),
  ('dc000000-0000-0000-0000-000000000009', 'ac000000-0000-0000-0000-000000000007', 'Growth campaign listing one', 'growth-campaign-listing-one', null, null, '/', false),
  ('dc000000-0000-0000-0000-000000000010', 'ac000000-0000-0000-0000-000000000008', 'Growth campaign listing two', 'growth-campaign-listing-two', null, null, '/', false),
  ('dc000000-0000-0000-0000-000000000011', 'ac000000-0000-0000-0000-000000000009', 'Growth downgrade race', 'growth-downgrade-race', null, null, '/', true);

update public.pages
set website_url = case id
  when 'dc000000-0000-0000-0000-000000000009' then 'https://growth-concurrency-one.example.test'
  else 'https://growth-concurrency-two.example.test'
end
where id in (
  'dc000000-0000-0000-0000-000000000009',
  'dc000000-0000-0000-0000-000000000010'
);

update public.pages
set website_url = 'https://growth-downgrade-race.example.test'
where id = 'dc000000-0000-0000-0000-000000000011';

-- URL changes intentionally clear old proof. Stamp verification in a separate
-- service-role mutation so the fixture follows the production proof lifecycle.
update public.pages
set website_verified_at = statement_timestamp()
where id in (
  'dc000000-0000-0000-0000-000000000009',
  'dc000000-0000-0000-0000-000000000010'
);

commit;
SQL

run_blocking_quota_pair \
  "storefront-peer-race" \
  "insert into public.storefronts (owner_id, handle) values ('ac000000-0000-0000-0000-000000000001', 'concurrency-store-one')" \
  "insert into public.storefronts (owner_id, handle) values ('ac000000-0000-0000-0000-000000000001', 'concurrency-store-two')" \
  "Storefront limit reached for your plan (1 storefront(s))."

run_blocking_quota_pair \
  "team-seat-peer-race" \
  "insert into public.team_invites (owner_id, email, role, status) values ('ac000000-0000-0000-0000-000000000002', 'concurrency-seat-three@example.test', 'viewer', 'accepted')" \
  "insert into public.team_invites (owner_id, email, role, status) values ('ac000000-0000-0000-0000-000000000002', 'concurrency-seat-four@example.test', 'viewer', 'accepted')" \
  "Team seat limit reached for your plan (3 seat(s))."

run_blocking_quota_pair \
  "verified-domain-peer-race" \
  "update public.pages set custom_domain_verified = statement_timestamp() where id = 'dc000000-0000-0000-0000-000000000001'" \
  "update public.pages set custom_domain_verified = statement_timestamp() where id = 'dc000000-0000-0000-0000-000000000002'" \
  "Verified custom-domain limit reached for your plan (1 domain(s))."

run_blocking_quota_pair \
  "published-listing-peer-race" \
  "update public.pages set is_published = true where id = 'dc000000-0000-0000-0000-000000000003'" \
  "update public.pages set is_published = true where id = 'dc000000-0000-0000-0000-000000000004'" \
  "Published listing limit reached for your plan (1 listing(s))."

run_blocking_quota_pair \
  "uncommitted-downgrade-vs-publish" \
  "update public.billing_subscriptions set plan_id = 'free', account_origin = 'free' where owner_id = 'ac000000-0000-0000-0000-000000000005'" \
  "update public.pages set is_published = true where id = 'dc000000-0000-0000-0000-000000000006'" \
  "Published listing limit reached for your plan (1 listing(s))."

run_blocking_quota_pair \
  "uncommitted-downgrade-vs-domain-activation" \
  "update public.billing_subscriptions set plan_id = 'free', account_origin = 'free' where owner_id = 'ac000000-0000-0000-0000-000000000006'" \
  "update public.pages set custom_domain_verified = statement_timestamp() where id = 'dc000000-0000-0000-0000-000000000008'" \
  "A retained custom domain cannot be verified or reactivated below Launch."

run_blocking_success_pair \
  "active-growth-campaign-lock-order" \
  "update public.pages set is_published = true where id = 'dc000000-0000-0000-0000-000000000009'" \
  "update public.pages set is_published = true where id = 'dc000000-0000-0000-0000-000000000010'"

# The billing writer owns the listing/domain lock prefix while full downgrade
# reconciliation completes. The page is already published, so proof issuance
# is a legitimate non-allocation mutation after the downgrade; its first
# attempt must still fail fast rather than holding the tuple and deadlocking.
run_retryable_success_pair \
  "growth-proof-vs-downgrade-reconciliation" \
  "update public.billing_subscriptions set plan_id = 'free', account_origin = 'free' where owner_id = 'ac000000-0000-0000-0000-000000000009'" \
  "update public.pages set website_verified_at = statement_timestamp() where id = 'dc000000-0000-0000-0000-000000000011'"

psql_with_limits "nexez-concurrency-verification" <<'SQL'
do $verify$
declare
  v_growth_published integer;
  v_growth_owner_one_grants integer;
  v_growth_owner_two_grants integer;
begin
  if (
    select
      count(*) <> 1
      or count(*) filter (where plan_suspended_at is null) <> 1
    from public.storefronts
    where owner_id = 'ac000000-0000-0000-0000-000000000001'
  ) then
    raise exception 'storefront concurrency allocation was exceeded';
  end if;

  if (
    select count(*) <> 3
    from public.team_invites
    where owner_id = 'ac000000-0000-0000-0000-000000000002'
      and status <> 'revoked'
  ) then
    raise exception 'team-seat concurrency allocation was exceeded';
  end if;

  if (
    select count(distinct lower(btrim(custom_domain))) <> 1
    from public.pages
    where owner_id = 'ac000000-0000-0000-0000-000000000003'
      and custom_domain_verified is not null
  ) then
    raise exception 'verified-domain concurrency allocation was exceeded';
  end if;

  if (
    select count(*) <> 1
    from public.pages
    where owner_id = 'ac000000-0000-0000-0000-000000000004'
      and is_published is true
  ) then
    raise exception 'published-listing concurrency allocation was exceeded';
  end if;

  if not exists (
    select 1
    from public.billing_subscriptions
    where owner_id = 'ac000000-0000-0000-0000-000000000005'
      and plan_id = 'free'
  ) or (
    select count(*) <> 1
    from public.pages
    where owner_id = 'ac000000-0000-0000-0000-000000000005'
      and is_published is true
  ) then
    raise exception 'downgrade/publish race committed an over-allocation';
  end if;

  if not exists (
    select 1
    from public.billing_subscriptions
    where owner_id = 'ac000000-0000-0000-0000-000000000006'
      and plan_id = 'free'
  ) or exists (
    select 1
    from public.pages
    where id = 'dc000000-0000-0000-0000-000000000008'
      and custom_domain_verified is not null
  ) then
    raise exception 'downgrade/domain race activated an over-allocation';
  end if;

  select count(*)::integer
  into v_growth_published
  from public.pages
  where owner_id in (
    'ac000000-0000-0000-0000-000000000007',
    'ac000000-0000-0000-0000-000000000008'
  )
    and is_published is true;

  select count(*)::integer
  into v_growth_owner_one_grants
  from public.promotional_plan_grants
  where campaign_id = 'ca000000-0000-0000-0000-000000000001'
    and owner_id = 'ac000000-0000-0000-0000-000000000007'
    and status = 'active';

  select count(*)::integer
  into v_growth_owner_two_grants
  from public.promotional_plan_grants
  where campaign_id = 'ca000000-0000-0000-0000-000000000001'
    and owner_id = 'ac000000-0000-0000-0000-000000000008';

  if v_growth_published <> 2
     or v_growth_owner_one_grants <> 1
     or v_growth_owner_two_grants <> 0 then
    raise exception 'active campaign lock order lost a publish or exceeded capacity'
      using detail = format(
        'published=%s, holder_grants=%s, contender_grants=%s',
        v_growth_published,
        v_growth_owner_one_grants,
        v_growth_owner_two_grants
      );
  end if;

  if not exists (
    select 1
    from public.billing_subscriptions
    where owner_id = 'ac000000-0000-0000-0000-000000000009'
      and plan_id = 'free'
      and account_origin = 'free'
  ) or not exists (
    select 1
    from public.pages
    where id = 'dc000000-0000-0000-0000-000000000011'
      and owner_id = 'ac000000-0000-0000-0000-000000000009'
      and is_published is true
      and website_verified_at is not null
  ) or exists (
    select 1
    from public.promotional_plan_grants
    where owner_id = 'ac000000-0000-0000-0000-000000000009'
  ) then
    raise exception 'growth proof/downgrade retry left the wrong final state';
  end if;

  raise notice 'all plan-entitlement concurrency invariants: ok';
end
$verify$;
SQL

# Organization scan entitlements are a separate authority boundary. Keep its
# two-session suspension proof in the existing required concurrency invocation.
NEXEZ_TEST_DATABASE_URL="$DATABASE_URL" python3 scripts/test-organization-read-boundary.py

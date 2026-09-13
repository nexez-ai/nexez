begin;
set local search_path = public, extensions;

select plan(31);

update public.seller_growth_campaigns
set status = 'ended'
where status = 'active';

insert into auth.users (id, email)
values ('a1000000-0000-4000-8000-000000000001', 'growth-operator@nexez.ai');

insert into public.seller_growth_campaigns (
  id,
  campaign_key,
  name,
  status,
  grant_plan_id,
  grant_duration_days,
  invite_slots,
  invite_expires_days,
  max_grants,
  starts_at
) values (
  'a2000000-0000-4000-8000-000000000001',
  'cohort-rollout-test',
  'Cohort rollout test',
  'active',
  'launch',
  180,
  2,
  14,
  100,
  now() - interval '1 hour'
);

update public.seller_growth_campaigns
set is_public_launch = true
where campaign_key = 'cohort-rollout-test';

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select lives_ok(
  $$
    select public.stage_seller_growth_cohort_batch(
      'a2000000-0000-4000-8000-000000000001',
      'a1000000-0000-4000-8000-000000000001',
      'Reviewed verifier export',
      'stage-rollout-test-1',
      '[
        {"email":"valid@example.com","label":"Valid Co","wave":1,"verificationStatus":"valid","verificationProvider":"millionverifier"},
        {"email":"risky@example.com","label":"Risky Co","wave":1,"verificationStatus":"risky","verificationProvider":"millionverifier"},
        {"email":"unknown@example.com","label":"Unknown Co","wave":1,"verificationStatus":"unknown","verificationProvider":"apollo"}
      ]'::jsonb
    )
  $$,
  'a reviewed candidate batch can be staged atomically'
);

select is(
  (select count(*)::integer from public.seller_growth_invites
   where campaign_id = 'a2000000-0000-4000-8000-000000000001'
     and invite_kind = 'cohort'),
  3,
  'all unique candidates enter the private roster'
);

select is(
  (select rollout_state from public.seller_growth_invites where invitee_email = 'valid@example.com'),
  'ready',
  'only a valid verification result becomes ready'
);

select is(
  (select rollout_state from public.seller_growth_invites where invitee_email = 'risky@example.com'),
  'suppressed',
  'a risky result is bounce-gated'
);

select is(
  (select rollout_state from public.seller_growth_invites where invitee_email = 'unknown@example.com'),
  'staged',
  'an unknown result remains staged and cannot send'
);

select ok(
  (public.stage_seller_growth_cohort_batch(
    'a2000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000001',
    'Reviewed verifier export',
    'stage-rollout-test-1',
    '[
      {"email":"valid@example.com","label":"Valid Co","wave":1,"verificationStatus":"valid","verificationProvider":"millionverifier"},
      {"email":"risky@example.com","label":"Risky Co","wave":1,"verificationStatus":"risky","verificationProvider":"millionverifier"},
      {"email":"unknown@example.com","label":"Unknown Co","wave":1,"verificationStatus":"unknown","verificationProvider":"apollo"}
    ]'::jsonb
  ) ->> 'replayed')::boolean,
  'an exact staging replay does not duplicate candidates'
);

select throws_ok(
  $$
    select public.stage_seller_growth_cohort_batch(
      'a2000000-0000-4000-8000-000000000001',
      'a1000000-0000-4000-8000-000000000001',
      'Duplicate input test',
      'stage-rollout-test-2',
      '[
        {"email":"same@example.com","label":null,"wave":1,"verificationStatus":"valid","verificationProvider":"apollo"},
        {"email":"same@example.com","label":null,"wave":2,"verificationStatus":"valid","verificationProvider":"apollo"}
      ]'::jsonb
    )
  $$,
  '23505',
  null,
  'duplicate addresses fail the whole input before mutation'
);

select throws_ok(
  $$
    select public.stage_seller_growth_cohort_batch(
      'a2000000-0000-4000-8000-000000000001',
      'a1000000-0000-4000-8000-000000000001',
      'Unsupported verifier test',
      'stage-rollout-test-unsupported-provider',
      '[{"email":"manual@example.com","label":null,"wave":1,"verificationStatus":"valid","verificationProvider":"manual"}]'::jsonb
    )
  $$,
  '22023',
  null,
  'an arbitrary provider cannot mark a candidate releaseable'
);

select throws_ok(
  $$
    select public.claim_seller_growth_cohort_wave(
      'a2000000-0000-4000-8000-000000000001',
      'a1000000-0000-4000-8000-000000000001',
      1,
      26,
      'Oversized release test',
      'RELEASE WAVE 1',
      'release-rollout-test-oversized'
    )
  $$,
  '22023',
  null,
  'the database rejects releases above 25'
);

select throws_ok(
  $$
    select public.claim_seller_growth_cohort_wave(
      'a2000000-0000-4000-8000-000000000001',
      'a1000000-0000-4000-8000-000000000001',
      1,
      20,
      'Wrong confirmation test',
      'RELEASE ALL',
      'release-rollout-test-wrong-confirmation'
    )
  $$,
  '22023',
  null,
  'the database requires the exact wave confirmation'
);

create temporary table claimed_wave as
select public.claim_seller_growth_cohort_wave(
  'a2000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  1,
  20,
  'Controlled wave release',
  'RELEASE WAVE 1',
  'release-rollout-test-1'
) as result;

select is(
  (select jsonb_array_length(result -> 'members') from claimed_wave),
  1,
  'the release claim selects only the verified-valid candidate'
);

select is(
  (select result -> 'members' -> 0 ->> 'email' from claimed_wave),
  'valid@example.com',
  'the valid address is the only claimed recipient'
);

select ok(
  (select char_length(result -> 'members' -> 0 ->> 'token_seed') > 20 from claimed_wave),
  'the service-only claim receives a retryable token seed'
);

select ok(
  (public.claim_seller_growth_cohort_wave(
    'a2000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000001',
    1,
    20,
    'Controlled wave release',
    'RELEASE WAVE 1',
    'release-rollout-test-1'
  ) ->> 'replayed')::boolean,
  'an exact release replay reuses the active claim'
);

select lives_ok(
  $$
    select public.record_seller_growth_cohort_delivery_result(
      (select id from public.seller_growth_invites where invitee_email = 'valid@example.com'),
      'release-rollout-test-1',
      true,
      null,
      'provider-message-1'
    )
  $$,
  'a successful provider result finalizes the claimed delivery'
);

select ok(
  (select rollout_state = 'sent'
      and delivery_count = 1
      and rollout_token_seed is null
      and rollout_provider_message_id = 'provider-message-1'
   from public.seller_growth_invites where invitee_email = 'valid@example.com'),
  'delivery finalization clears the seed and records the provider receipt'
);

select is(
  (select jsonb_array_length(public.claim_seller_growth_cohort_wave(
    'a2000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000001',
    1,
    20,
    'No duplicate release',
    'RELEASE WAVE 1',
    'release-rollout-test-2'
  ) -> 'members')),
  0,
  'a delivered candidate cannot be selected again'
);

select lives_ok(
  $$
    select public.stage_seller_growth_cohort_batch(
      'a2000000-0000-4000-8000-000000000001',
      'a1000000-0000-4000-8000-000000000001',
      'Failure recovery candidate',
      'stage-rollout-failure-test',
      '[{"email":"failure@example.com","label":"Failure Co","wave":2,"verificationStatus":"valid","verificationProvider":"apollo"}]'::jsonb
    )
  $$,
  'a verified candidate can be staged for failure recovery proof'
);

create temporary table failed_claim_1 as
select public.claim_seller_growth_cohort_wave(
  'a2000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  2,
  1,
  'Failure recovery attempt one',
  'RELEASE WAVE 2',
  'release-failure-test-1'
) as result;

select is(
  (select (result -> 'members' -> 0 ->> 'attempt')::integer from failed_claim_1),
  1,
  'the first provider claim records attempt one'
);

select lives_ok(
  $$
    select public.record_seller_growth_cohort_delivery_result(
      (select id from public.seller_growth_invites where invitee_email = 'failure@example.com'),
      'release-failure-test-1',
      false,
      'temporary provider rejection',
      null
    )
  $$,
  'an explicit provider failure returns the row to a recoverable state'
);

select is(
  (select rollout_state from public.seller_growth_invites where invitee_email = 'failure@example.com'),
  'failed',
  'a non-final failure is retryable'
);

create temporary table failed_claim_2 as
select public.claim_seller_growth_cohort_wave(
  'a2000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  2,
  1,
  'Failure recovery attempt two',
  'RELEASE WAVE 2',
  'release-failure-test-2'
) as result;

select is(
  (select (result -> 'members' -> 0 ->> 'attempt')::integer from failed_claim_2),
  2,
  'a fresh retry advances the bounded attempt counter'
);

update public.seller_growth_invites
set
  rollout_attempts = 3,
  rollout_claimed_at = statement_timestamp() - interval '16 minutes',
  rollout_release_key = 'release-failure-crashed-third',
  rollout_token_seed = 'third-attempt-seed'
where invitee_email = 'failure@example.com';

create temporary table recovered_third_claim as
select public.claim_seller_growth_cohort_wave(
  'a2000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  2,
  1,
  'Recover crashed third attempt',
  'RELEASE WAVE 2',
  'release-failure-test-3-recovery'
) as result;

select is(
  (select (result -> 'members' -> 0 ->> 'attempt')::integer from recovered_third_claim),
  3,
  'a stale third-attempt claim is recoverable without creating attempt four'
);

select is(
  (select result -> 'members' -> 0 ->> 'token_seed' from recovered_third_claim),
  'third-attempt-seed',
  'a stale reclaim preserves the original message token and provider identity'
);

select lives_ok(
  $$
    select public.record_seller_growth_cohort_delivery_result(
      (select id from public.seller_growth_invites where invitee_email = 'failure@example.com'),
      'release-failure-test-3-recovery',
      false,
      'third provider rejection',
      null
    )
  $$,
  'the third explicit failure finalizes normally'
);

select is(
  (select rollout_state from public.seller_growth_invites where invitee_email = 'failure@example.com'),
  'suppressed',
  'three explicit provider failures suppress further release'
);

select is(
  (select jsonb_array_length(public.claim_seller_growth_cohort_wave(
    'a2000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000001',
    2,
    1,
    'No fourth provider attempt',
    'RELEASE WAVE 2',
    'release-failure-test-4'
  ) -> 'members')),
  0,
  'a suppressed candidate cannot create a fourth attempt'
);

select ok(
  not has_function_privilege('anon', 'public.stage_seller_growth_cohort_batch(uuid,uuid,text,text,jsonb)', 'execute')
    and not has_function_privilege('authenticated', 'public.stage_seller_growth_cohort_batch(uuid,uuid,text,text,jsonb)', 'execute'),
  'browser roles cannot stage cohort batches'
);

select ok(
  has_function_privilege('service_role', 'public.stage_seller_growth_cohort_batch(uuid,uuid,text,text,jsonb)', 'execute')
    and has_function_privilege('service_role', 'public.claim_seller_growth_cohort_wave(uuid,uuid,integer,integer,text,text,text)', 'execute')
    and has_function_privilege('service_role', 'public.record_seller_growth_cohort_delivery_result(uuid,text,boolean,text,text)', 'execute'),
  'the server role alone can run the rollout lifecycle'
);

select is(
  (public.seller_growth_cohort_rollout_snapshot('a2000000-0000-4000-8000-000000000001') ->> 'verified_valid')::integer,
  2,
  'rollout telemetry reports the verified-valid population'
);

select is(
  (public.seller_growth_cohort_rollout_snapshot('a2000000-0000-4000-8000-000000000001') ->> 'suppressed')::integer,
  2,
  'rollout telemetry reports bounce-gated candidates'
);

select * from finish();
rollback;

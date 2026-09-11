-- Required through plan_entitlements.test.sql. All fixtures and adversarial
-- source mutations roll back, including the temporary trigger/constraint changes.
\set ON_ERROR_STOP on
begin;
set local plpgsql.check_asserts = on;
set local statement_timeout = '30s';
select set_config('report_test.month', (date_trunc('month', statement_timestamp() at time zone 'UTC') - interval '1 month')::date::text, true);

insert into auth.users(id) values
  ('9a000000-0000-4000-8000-000000000001'), ('9a000000-0000-4000-8000-000000000002');
-- Isolate the input contract from unrelated publication/billing side effects.
alter table public.pages disable trigger user;
alter table public.checkout_orders disable trigger user;
insert into public.pages(id, owner_id, name, slug, description, website_url, cta_url, audience, industry, contact_email, products, services, faqs, draft) values
  ('9b000000-0000-4000-8000-000000000001', '9a000000-0000-4000-8000-000000000001', 'Report merchant', 'report-input-a', 'Live description', 'https://example.com', 'https://example.com/book', 'Buyer', 'Services', 'private@example.com', '[{"name":"Private offer","price":"PRIVATE_PRICE"}]', '[]', '[{"question":"Private question","answer":"Private answer"}]', '{"description":"PRIVATE_DRAFT"}'),
  ('9b000000-0000-4000-8000-000000000002', '9a000000-0000-4000-8000-000000000001', 'Second listing', 'report-input-b', null, null, null, null, null, null, '[]', '[]', '[]', null),
  ('9b000000-0000-4000-8000-000000000003', '9a000000-0000-4000-8000-000000000002', 'Foreign listing', 'report-input-c', null, null, null, null, null, null, '[]', '[]', '[]', null);

do $$
declare r text; t text; f text;
begin
  foreach t in array array['private.merchant_report_access', 'private.merchant_report_coverage'] loop
    assert (select relrowsecurity from pg_class where oid = t::regclass), 'RLS required';
    foreach r in array array['anon','authenticated','service_role'] loop
      assert not has_table_privilege(r, t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'), 'no direct table privileges';
    end loop;
  end loop;
  foreach f in array array['public.read_merchant_report_inputs(uuid,date)', 'private.read_merchant_report_inputs(uuid,date)'] loop
    assert has_function_privilege('authenticated', f, 'EXECUTE'), 'session RPC available';
    assert not has_function_privilege('anon', f, 'EXECUTE'), 'anonymous RPC denied';
    assert not has_function_privilege('service_role', f, 'EXECUTE'), 'no service-role fallback';
    assert (select provolatile = 's' and proconfig @> array['search_path=""'] from pg_proc where oid = f::regprocedure), 'stable snapshot and empty path';
  end loop;
  assert not (select prosecdef from pg_proc where oid = 'public.read_merchant_report_inputs(uuid,date)'::regprocedure), 'public wrapper is an invoker';
  assert exists (select 1 from pg_indexes where indexname = 'agent_visits_owner_page_created_idx'), 'scoped visit index exists';
end $$;

select set_config('request.jwt.claim.sub', '9a000000-0000-4000-8000-000000000001', true);
set local role authenticated;
do $$
declare p uuid := '9b000000-0000-4000-8000-000000000001'; m date := current_setting('report_test.month')::date;
begin
  assert public.read_merchant_report_inputs('9b000000-0000-4000-8000-000000000003', m) is null, 'foreign page denies';
  assert public.read_merchant_report_inputs('9b000000-0000-4000-8000-000000000099', m) is null, 'unknown page matches denial';
  begin perform public.read_merchant_report_inputs(p, m); raise exception 'pilot unexpectedly active'; exception when sqlstate 'PT503' then null; end;
  begin insert into private.merchant_report_access(owner_id, enabled, expires_at) values (auth.uid(), true, now() + interval '1 day');
    raise exception 'self enrollment succeeded'; exception when insufficient_privilege then null; end;
  begin select * from private.merchant_report_coverage; raise exception 'coverage read succeeded'; exception when insufficient_privilege then null; end;
end $$;
reset role;
insert into private.merchant_report_access(owner_id, expires_at) values
  ('9a000000-0000-4000-8000-000000000001', statement_timestamp() + interval '1 day'),
  ('9a000000-0000-4000-8000-000000000002', statement_timestamp() + interval '1 day');
do $$ begin assert not exists(select 1 from private.merchant_report_access where enabled), 'access defaults disabled'; end $$;
update private.merchant_report_access set enabled = true;

-- An event outside any attested interval does not establish collection coverage.
insert into public.agent_visits(page_id, owner_id, slug, path, created_at) values
  ('9b000000-0000-4000-8000-000000000001', '9a000000-0000-4000-8000-000000000001', 'report-input-a', '/PRIVATE_PATH', current_setting('report_test.month')::date::timestamp at time zone 'UTC');
set local role authenticated;
do $$
declare p uuid := '9b000000-0000-4000-8000-000000000001'; m date := current_setting('report_test.month')::date; v jsonb; bad date;
begin
  v := public.read_merchant_report_inputs(p, m);
  assert v->'traffic' = '{"state":"no_coverage"}' and v->'orders' = '{"state":"no_coverage"}', 'records do not imply coverage';
  assert v#>'{listing,readinessSignals}' = '[true,true,true,true,true,true,true,true,true,true,false]', 'canonical presence signals';
  assert v::text !~ 'PRIVATE|private@example|Private offer|Private question|example.com|products|draft_content|amount_cents', 'no private source payload';
  assert v->>'month' = to_char(m, 'YYYY-MM') and (v->>'observedAt')::timestamptz = statement_timestamp(), 'statement observation and period';
  foreach bad in array array[null::date, 'infinity'::date, m + 1, (m + interval '1 month')::date, (m - interval '12 months')::date] loop
    begin perform public.read_merchant_report_inputs(p, bad); raise exception 'invalid month accepted'; exception when sqlstate 'PT400' then null; end;
  end loop;
  assert public.read_merchant_report_inputs(p, (m - interval '11 months')::date) is not null, 'oldest of twelve completed months allowed';
end $$;
reset role;

-- Partial traffic, whole-account orders, inclusive start and exclusive end.
insert into private.merchant_report_coverage(owner_id, listing_id, metric, period_start, covered_from, covered_to_exclusive, evidence_sha256)
select '9a000000-0000-4000-8000-000000000001', case when metric = 'traffic' then '9b000000-0000-4000-8000-000000000001'::uuid end,
  metric, m, (m + interval '3 days') at time zone 'UTC', (m + interval '20 days') at time zone 'UTC', 'sha256:' || repeat('a',64)
from (select current_setting('report_test.month')::date m) dates cross join (values ('traffic'), ('orders')) metrics(metric);

insert into public.agent_visits(page_id, owner_id, slug, path, created_at, trust_level, is_ai_agent)
select page_id::uuid, owner_id::uuid, 'report-input-a', '/PRIVATE_PATH', (current_setting('report_test.month')::date + delta) at time zone 'UTC', trust, ai
from (values
  ('9b000000-0000-4000-8000-000000000001','9a000000-0000-4000-8000-000000000001',interval '3 days','verified_server',true),
  ('9b000000-0000-4000-8000-000000000001','9a000000-0000-4000-8000-000000000001',interval '4 days','unverified_client',false),
  ('9b000000-0000-4000-8000-000000000001','9a000000-0000-4000-8000-000000000001',interval '5 days','legacy_unverified',false),
  ('9b000000-0000-4000-8000-000000000001','9a000000-0000-4000-8000-000000000001',interval '20 days','verified_server',true),
  ('9b000000-0000-4000-8000-000000000002','9a000000-0000-4000-8000-000000000001',interval '5 days','verified_server',true),
  ('9b000000-0000-4000-8000-000000000001','9a000000-0000-4000-8000-000000000002',interval '5 days','verified_server',true)
) f(page_id,owner_id,delta,trust,ai);

-- Exercise future/unsupported statuses defensively without changing the schema
-- outside this rolled-back test. Mode classification takes priority over status.
alter table public.checkout_orders drop constraint checkout_orders_status_check;
insert into public.checkout_orders(owner_id, page_id, stripe_session_id, amount_cents, currency, buyer_email, stripe_livemode, status, created_at)
select owner_id::uuid, page_id::uuid, 'report-fixture-' || row_number() over (), 777777, 'usd', 'PRIVATE_BUYER', mode, status,
  (current_setting('report_test.month')::date + delta) at time zone 'UTC'
from (values
  ('9a000000-0000-4000-8000-000000000001','9b000000-0000-4000-8000-000000000001',true,'paid',interval '3 days'),
  ('9a000000-0000-4000-8000-000000000001','9b000000-0000-4000-8000-000000000002',true,'refunded',interval '4 days'),
  ('9a000000-0000-4000-8000-000000000001',null,true,'disputed',interval '5 days'),
  ('9a000000-0000-4000-8000-000000000001','9b000000-0000-4000-8000-000000000003',true,'dispute_won',interval '6 days'),
  ('9a000000-0000-4000-8000-000000000001',null,false,'future_status',interval '7 days'),
  ('9a000000-0000-4000-8000-000000000001',null,null,'future_status',interval '8 days'),
  ('9a000000-0000-4000-8000-000000000001',null,true,'future_status',interval '9 days'),
  ('9a000000-0000-4000-8000-000000000001',null,true,'paid',interval '20 days'),
  ('9a000000-0000-4000-8000-000000000002','9b000000-0000-4000-8000-000000000001',true,'paid',interval '4 days')
) f(owner_id,page_id,mode,status,delta);
set local role authenticated;
do $$
declare v jsonb := public.read_merchant_report_inputs('9b000000-0000-4000-8000-000000000001', current_setting('report_test.month')::date);
begin
  assert v#>'{traffic,value}' = '{"totalVisits":3,"detectedAiVisits":1,"verifiedServerVisits":1,"unverifiedClientVisits":1,"legacyUnverifiedVisits":1}', 'traffic scope, trust and time reconcile';
  assert v#>'{orders,value}' = '{"eligibleLiveOrders":4,"byPaymentStatus":{"paid":1,"refunded":1,"disputed":1,"dispute_won":1},"excludedTestOrders":1,"excludedUnknownModeOrders":1,"excludedUnsupportedStatusOrders":1}', 'account scope, disjoint exclusions and payment states reconcile';
  assert v#>>'{traffic,coverage,state}' = 'partial' and v#>>'{orders,coverage,state}' = 'partial', 'partial coverage labelled';
  assert v::text !~ 'PRIVATE|777777|amount_cents|currency|buyer_email|stripe_session_id|orderIds', 'no money or buyer fields';
  begin update private.merchant_report_coverage set covered_from = '-infinity'; raise exception 'owner forged coverage'; exception when insufficient_privilege then null; end;
end $$;
reset role;

-- With no measured rows, evidence permits zero; withdrawn evidence removes it.
delete from public.agent_visits where owner_id in ('9a000000-0000-4000-8000-000000000001','9a000000-0000-4000-8000-000000000002');
delete from public.checkout_orders where stripe_session_id like 'report-fixture-%';
update private.merchant_report_coverage set covered_from = period_start::timestamp at time zone 'UTC',
  covered_to_exclusive = (period_start + interval '1 month') at time zone 'UTC';
set local role authenticated;
do $$ declare v jsonb := public.read_merchant_report_inputs('9b000000-0000-4000-8000-000000000001', current_setting('report_test.month')::date);
begin
  assert v#>>'{traffic,value,totalVisits}' = '0' and v#>>'{orders,value,eligibleLiveOrders}' = '0', 'attested zero stays available';
  assert v#>>'{traffic,coverage,state}' = 'complete' and v#>>'{orders,coverage,state}' = 'complete', 'exact month coverage';
end $$;
reset role;

-- Exact cap succeeds. Sentinel overflow is unavailable, never a partial total.
insert into public.agent_visits(page_id, owner_id, slug, path, created_at)
select '9b000000-0000-4000-8000-000000000001', '9a000000-0000-4000-8000-000000000001', 'report-input-a', '/',
  current_setting('report_test.month')::date::timestamp at time zone 'UTC' from generate_series(1,100000);
insert into public.checkout_orders(owner_id, stripe_session_id, amount_cents, stripe_livemode, created_at)
select '9a000000-0000-4000-8000-000000000001', 'report-cap-' || n, 100, true,
  current_setting('report_test.month')::date::timestamp at time zone 'UTC' from generate_series(1,100000) n;
set local role authenticated;
do $$ declare v jsonb := public.read_merchant_report_inputs('9b000000-0000-4000-8000-000000000001', current_setting('report_test.month')::date);
begin assert v#>>'{traffic,value,totalVisits}' = '100000' and v#>>'{orders,value,eligibleLiveOrders}' = '100000', 'exact cap remains exact'; end $$;
reset role;
insert into public.agent_visits(page_id, owner_id, slug, path, created_at) values
  ('9b000000-0000-4000-8000-000000000001','9a000000-0000-4000-8000-000000000001','report-input-a','/',current_setting('report_test.month')::date::timestamp at time zone 'UTC');
insert into public.checkout_orders(owner_id, stripe_session_id, amount_cents, stripe_livemode, created_at) values
  ('9a000000-0000-4000-8000-000000000001','report-cap-sentinel',100,true,current_setting('report_test.month')::date::timestamp at time zone 'UTC');
set local role authenticated;
do $$ declare v jsonb := public.read_merchant_report_inputs('9b000000-0000-4000-8000-000000000001', current_setting('report_test.month')::date);
begin assert v->'traffic' = '{"state":"calculation_failed"}' and v->'orders' = '{"state":"calculation_failed"}', 'overflow has no misleading total'; end $$;
reset role;
delete from private.merchant_report_coverage;

-- Parity across each actual SQL presence signal, including collection JSON,
-- contact fallback and current content independent of staged draft values.
do $$
declare mask integer; bits boolean[]; v jsonb; i integer;
begin
  for mask in 0..2047 loop
    bits := array[]::boolean[];
    for i in 0..10 loop bits := bits || ((mask & (1 << i)) <> 0); end loop;
    -- Published rows require a slug in the real schema (1,536 valid masks).
    -- The pure TypeScript contract separately exercises all 2,048 masks.
    if bits[11] and not bits[2] then continue; end if;
    update public.pages set name = case when bits[1] then 'Merchant' else '' end,
      slug = case when bits[2] then 'report-input-a' else null end,
      description = case when bits[3] then 'Description' else null end,
      website_url = case when bits[4] then 'https://example.com' else null end,
      cta_url = case when bits[5] then 'https://example.com/book' else null end,
      audience = case when bits[6] then 'Buyer' else null end,
      industry = case when bits[7] then 'Services' else null end,
      contact_email = case when bits[8] then 'private@example.com' else null end,
      services = case when bits[9] then '[{"name":"Private offer"}]'::jsonb else '[]'::jsonb end,
      products = '[]', faqs = case when bits[10] then '[{"question":"Q","answer":"A"}]'::jsonb else 'null'::jsonb end,
      is_published = bits[11]
    where id = '9b000000-0000-4000-8000-000000000001';
    v := public.read_merchant_report_inputs('9b000000-0000-4000-8000-000000000001', current_setting('report_test.month')::date);
    assert v#>'{listing,readinessSignals}' = to_jsonb(bits), 'SQL presence parity mask ' || mask;
  end loop;
end $$;
update public.pages set products = '{"secret":"PRIVATE"}' where id = '9b000000-0000-4000-8000-000000000001';
do $$ begin assert public.read_merchant_report_inputs('9b000000-0000-4000-8000-000000000001', current_setting('report_test.month')::date)->'listing' = '{"state":"calculation_failed"}', 'malformed collections do not fabricate readiness'; end $$;

update auth.users set is_anonymous = true where id = '9a000000-0000-4000-8000-000000000001';
do $$ begin assert public.read_merchant_report_inputs('9b000000-0000-4000-8000-000000000001', current_setting('report_test.month')::date) is null, 'anonymous account denied'; end $$;
update auth.users set is_anonymous = false, banned_until = statement_timestamp() + interval '1 day' where id = '9a000000-0000-4000-8000-000000000001';
do $$ begin assert public.read_merchant_report_inputs('9b000000-0000-4000-8000-000000000001', current_setting('report_test.month')::date) is null, 'banned account denied'; end $$;
update auth.users set banned_until = null, deleted_at = statement_timestamp() where id = '9a000000-0000-4000-8000-000000000001';
do $$ begin assert public.read_merchant_report_inputs('9b000000-0000-4000-8000-000000000001', current_setting('report_test.month')::date) is null, 'deleted account with stale JWT denied'; end $$;
update auth.users set deleted_at = null where id = '9a000000-0000-4000-8000-000000000001';
update private.merchant_report_access set expires_at = statement_timestamp() - interval '1 second';
do $$ begin
  begin perform public.read_merchant_report_inputs('9b000000-0000-4000-8000-000000000001', current_setting('report_test.month')::date); raise exception 'expired pilot allowed'; exception when sqlstate 'PT503' then null; end;
end $$;
rollback;

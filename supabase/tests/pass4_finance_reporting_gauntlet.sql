begin;

select plan(57);

select ok(
  not has_function_privilege('anon', 'public.nz_owner_finance_rollup(timestamptz,timestamptz,integer)', 'execute'),
  'anonymous callers cannot execute finance reporting'
);
select ok(
  has_function_privilege('authenticated', 'public.nz_owner_finance_rollup(timestamptz,timestamptz,integer)', 'execute'),
  'authenticated owners can execute finance reporting'
);
select ok(
  has_function_privilege('service_role', 'public.nz_owner_finance_rollup(timestamptz,timestamptz,integer)', 'execute'),
  'service role can execute finance reporting'
);
select ok(
  not (select prosecdef from pg_proc where oid = 'public.nz_owner_finance_rollup(timestamptz,timestamptz,integer)'::regprocedure),
  'finance reporting runs as security invoker'
);

insert into auth.users (id) values
  ('b1000000-0000-0000-0000-000000000001'),
  ('b1000000-0000-0000-0000-000000000002');

insert into public.pages (id, owner_id, name, slug, currency) values
  ('b2000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'Finance Alpha', 'finance-alpha', 'usd'),
  ('b2000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000002', 'Finance Other', 'finance-other', 'usd');

insert into public.checkout_orders (
  id, owner_id, page_id, slug, offer_name, offer_key, stripe_session_id,
  amount_cents, currency, application_fee_cents, commission_bps, status,
  channel, refunded_cents, stripe_livemode, created_at, updated_at
) values
  ('b3000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000001', 'finance-alpha', 'Direct Audit', 'services-0', 'cs_pass4_1', 10000, 'usd', null, 1000, 'paid', 'agent_checkout', 0, true, now() - interval '10 minutes', now() - interval '10 minutes'),
  ('b3000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000001', 'finance-alpha', 'Protocol Audit', 'services-1', 'cs_pass4_2', 10000, 'usd', 1000, 1000, 'paid', 'acp', 2500, true, now() - interval '9 minutes', now() - interval '9 minutes'),
  ('b3000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000001', 'finance-alpha', 'Protocol EUR', 'services-2', 'cs_pass4_3', 20000, 'eur', 2000, 1000, 'disputed', 'ucp', 0, true, now() - interval '8 minutes', now() - interval '8 minutes'),
  ('b3000000-0000-0000-0000-000000000004', 'b1000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000001', 'finance-alpha', 'Recurring Audit', 'services-3', 'cs_pass4_4', 15000, 'usd', 1500, 1000, 'refunded', 'recurring_service', 0, true, now() - interval '7 minutes', now() - interval '7 minutes'),
  ('b3000000-0000-0000-0000-000000000005', 'b1000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000001', 'finance-alpha', 'Test Order', 'services-4', 'cs_pass4_5', 99999, 'usd', 9999, 1000, 'paid', 'agent_checkout', 0, false, now(), now()),
  ('b3000000-0000-0000-0000-000000000006', 'b1000000-0000-0000-0000-000000000002', 'b2000000-0000-0000-0000-000000000002', 'finance-other', 'Other Owner', 'services-0', 'cs_pass4_6', 99999, 'usd', 9999, 1000, 'paid', 'agent_checkout', 0, true, now(), now());

insert into public.agent_negotiations (
  id, page_id, owner_id, slug, offer_key, offer_name, offer_kind, status,
  amount_cents, refunded_cents, currency, commission_bps, commission_percent,
  application_fee_cents, stripe_livemode, stripe_payment_intent_id, created_at, updated_at
) values
  ('b4000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'finance-alpha', 'services-0', 'Held Audit', 'services', 'held', 5000, 0, 'usd', 1000, 10, 500, true, 'pi_pass4_1', now() - interval '4 days', now() - interval '4 days'),
  ('b4000000-0000-0000-0000-000000000002', 'b2000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'finance-alpha', 'services-1', 'Partial Audit', 'services', 'complete', 10000, 2500, 'usd', 1000, 10, 1000, true, 'pi_pass4_2', now() - interval '6 minutes', now() - interval '6 minutes'),
  ('b4000000-0000-0000-0000-000000000003', 'b2000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'finance-alpha', 'services-2', 'JPY Audit', 'services', 'complete', 100000, 0, 'jpy', 600, 6, null, true, 'pi_pass4_3', now() - interval '5 minutes', now() - interval '5 minutes'),
  ('b4000000-0000-0000-0000-000000000004', 'b2000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'finance-alpha', 'services-3', 'Dispute Audit', 'services', 'disputed', 8000, 0, 'usd', 1000, 10, 800, true, 'pi_pass4_4', now() - interval '4 minutes', now() - interval '4 minutes'),
  ('b4000000-0000-0000-0000-000000000005', 'b2000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000002', 'finance-other', 'services-0', 'Other Deal', 'services', 'complete', 99999, 0, 'usd', 1000, 10, 9999, true, 'pi_pass4_5', now(), now());

insert into public.order_requests (
  id, order_kind, order_id, owner_id, page_id, slug, kind, status
) values
  ('b5000000-0000-0000-0000-000000000001', 'checkout', 'b3000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000001', 'finance-alpha', 'refund_request', 'open'),
  ('b5000000-0000-0000-0000-000000000002', 'negotiation', 'b4000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000001', 'finance-alpha', 'problem_report', 'acknowledged'),
  ('b5000000-0000-0000-0000-000000000003', 'checkout', 'b3000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000001', 'finance-alpha', 'problem_report', 'resolved'),
  ('b5000000-0000-0000-0000-000000000004', 'checkout', 'b3000000-0000-0000-0000-000000000006', 'b1000000-0000-0000-0000-000000000002', 'b2000000-0000-0000-0000-000000000002', 'finance-other', 'refund_request', 'open');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select is((public.nz_owner_finance_rollup() #>> '{schemaVersion}')::integer, 1, 'rollup returns the supported schema');
select is(jsonb_array_length(public.nz_owner_finance_rollup() -> 'currencies'), 2, 'order currencies remain separate');
select is((jsonb_path_query_first(public.nz_owner_finance_rollup(), '$.currencies[*] ? (@.currency == "usd").transactions') #>> '{}')::bigint, 3::bigint, 'USD transaction count is exact');
select is((jsonb_path_query_first(public.nz_owner_finance_rollup(), '$.currencies[*] ? (@.currency == "usd").grossCents') #>> '{}')::bigint, 35000::bigint, 'USD gross is exact');
select is((jsonb_path_query_first(public.nz_owner_finance_rollup(), '$.currencies[*] ? (@.currency == "usd").retainedGrossCents') #>> '{}')::bigint, 17500::bigint, 'USD retained gross subtracts refunds');
select is((jsonb_path_query_first(public.nz_owner_finance_rollup(), '$.currencies[*] ? (@.currency == "usd").refundCents') #>> '{}')::bigint, 17500::bigint, 'USD refunds include partial and legacy full reversals');
select is((jsonb_path_query_first(public.nz_owner_finance_rollup(), '$.currencies[*] ? (@.currency == "usd").disputeCents') #>> '{}')::bigint, 0::bigint, 'USD disputes remain distinct from refunds');
select is((jsonb_path_query_first(public.nz_owner_finance_rollup(), '$.currencies[*] ? (@.currency == "usd").outflowCents') #>> '{}')::bigint, 17500::bigint, 'USD reversal outflow is aggregated per transaction');
select is((jsonb_path_query_first(public.nz_owner_finance_rollup(), '$.currencies[*] ? (@.currency == "usd").feeCents') #>> '{}')::bigint, 1750::bigint, 'retained fee is proportional after refunds');
select is((jsonb_path_query_first(public.nz_owner_finance_rollup(), '$.currencies[*] ? (@.currency == "usd").netCents') #>> '{}')::bigint, 15750::bigint, 'seller net is exact after refunds and fees');
select is((jsonb_path_query_first(public.nz_owner_finance_rollup(), '$.currencies[*] ? (@.currency == "usd").aovCents') #>> '{}')::bigint, 11667::bigint, 'AOV uses exact gross and order count');
select is((jsonb_path_query_first(public.nz_owner_finance_rollup(), '$.currencies[*] ? (@.currency == "usd").partialRefunds') #>> '{}')::bigint, 1::bigint, 'partial direct refunds are explicit');
select is((jsonb_path_query_first(public.nz_owner_finance_rollup(), '$.currencies[*] ? (@.currency == "usd").snapshotTransactions') #>> '{}')::bigint, 3::bigint, 'economics snapshot coverage is reported');
select is((jsonb_path_query_first(public.nz_owner_finance_rollup(), '$.currencies[*] ? (@.currency == "usd").estimatedTransactions') #>> '{}')::bigint, 0::bigint, 'no covered transaction is marked estimated');
select is((jsonb_path_query_first(public.nz_owner_finance_rollup(), '$.currencies[*] ? (@.currency == "eur").grossCents') #>> '{}')::bigint, 20000::bigint, 'EUR remains separate');
select is((jsonb_path_query_first(public.nz_owner_finance_rollup(), '$.currencies[*] ? (@.currency == "eur").disputeCents') #>> '{}')::bigint, 20000::bigint, 'dispute exposure is explicit');
select is((jsonb_path_query_first(public.nz_owner_finance_rollup(), '$.currencies[*] ? (@.currency == "eur").outflowCents') #>> '{}')::bigint, 20000::bigint, 'dispute outflow is included once');
select is((jsonb_path_query_first(public.nz_owner_finance_rollup(), '$.currencies[*] ? (@.currency == "eur").netCents') #>> '{}')::bigint, 0::bigint, 'open dispute is excluded from seller net');

select is((jsonb_path_query_first(public.nz_owner_finance_rollup(), '$.channels[*] ? (@.currency == "usd" && @.channel == "direct").grossCents') #>> '{}')::bigint, 10000::bigint, 'direct channel is truthful');
select is((jsonb_path_query_first(public.nz_owner_finance_rollup(), '$.channels[*] ? (@.currency == "usd" && @.channel == "agent_protocol").grossCents') #>> '{}')::bigint, 10000::bigint, 'ACP/UCP channel is grouped separately');
select is((jsonb_path_query_first(public.nz_owner_finance_rollup(), '$.channels[*] ? (@.currency == "usd" && @.channel == "recurring").grossCents') #>> '{}')::bigint, 15000::bigint, 'recurring revenue is grouped separately');

select is((jsonb_path_query_first(public.nz_owner_finance_rollup(), '$.escrow[*] ? (@.currency == "usd").deals') #>> '{}')::bigint, 3::bigint, 'funded USD deal count is exact');
select is((jsonb_path_query_first(public.nz_owner_finance_rollup(), '$.escrow[*] ? (@.currency == "usd").fundedCents') #>> '{}')::bigint, 23000::bigint, 'funded USD value is exact');
select is((jsonb_path_query_first(public.nz_owner_finance_rollup(), '$.escrow[*] ? (@.currency == "usd").heldCents') #>> '{}')::bigint, 5000::bigint, 'held funds are distinct');
select is((jsonb_path_query_first(public.nz_owner_finance_rollup(), '$.escrow[*] ? (@.currency == "usd").capturedCents') #>> '{}')::bigint, 18000::bigint, 'captured escrow includes later reversals');
select is((jsonb_path_query_first(public.nz_owner_finance_rollup(), '$.escrow[*] ? (@.currency == "usd").refundCents') #>> '{}')::bigint, 2500::bigint, 'negotiated partial refunds are included');
select is((jsonb_path_query_first(public.nz_owner_finance_rollup(), '$.escrow[*] ? (@.currency == "usd").disputeCents') #>> '{}')::bigint, 8000::bigint, 'negotiated disputes are distinct');
select is((jsonb_path_query_first(public.nz_owner_finance_rollup(), '$.escrow[*] ? (@.currency == "usd").outflowCents') #>> '{}')::bigint, 10500::bigint, 'negotiated refunds and disputes sum without cross-row undercounting');
select is((jsonb_path_query_first(public.nz_owner_finance_rollup(), '$.escrow[*] ? (@.currency == "usd").feeCents') #>> '{}')::bigint, 750::bigint, 'negotiated retained fee is proportional');
select is((jsonb_path_query_first(public.nz_owner_finance_rollup(), '$.escrow[*] ? (@.currency == "usd").netCents') #>> '{}')::bigint, 6750::bigint, 'negotiated seller net excludes held and disputed funds');
select is((jsonb_path_query_first(public.nz_owner_finance_rollup(), '$.escrow[*] ? (@.currency == "usd").partialRefunds') #>> '{}')::bigint, 1::bigint, 'negotiated partial refund count is explicit');
select is((jsonb_path_query_first(public.nz_owner_finance_rollup(), '$.escrow[*] ? (@.currency == "jpy").capturedCents') #>> '{}')::bigint, 1000::bigint, 'zero-decimal negotiated amounts convert to Stripe units');
select is((jsonb_path_query_first(public.nz_owner_finance_rollup(), '$.escrow[*] ? (@.currency == "jpy").feeCents') #>> '{}')::bigint, 60::bigint, 'zero-decimal fee stays in Stripe units');
select is((jsonb_path_query_first(public.nz_owner_finance_rollup(), '$.escrow[*] ? (@.currency == "jpy").netCents') #>> '{}')::bigint, 940::bigint, 'zero-decimal seller net is correct');
select is((jsonb_path_query_first(public.nz_owner_finance_rollup(), '$.escrow[*] ? (@.currency == "jpy").snapshotDeals') #>> '{}')::bigint, 1::bigint, 'stored commission terms count as immutable economics coverage');
select is((jsonb_path_query_first(public.nz_owner_finance_rollup(), '$.negotiatedWindow[*] ? (@.currency == "usd").deals') #>> '{}')::bigint, 3::bigint, 'windowed negotiation totals are exact');

select is((public.nz_owner_finance_rollup() #>> '{operations,openRequests}')::bigint, 2::bigint, 'open buyer recourse queue is exact');
select is((public.nz_owner_finance_rollup() #>> '{operations,disputedOrders}')::bigint, 1::bigint, 'direct disputes are counted');
select is((public.nz_owner_finance_rollup() #>> '{operations,disputedNegotiations}')::bigint, 1::bigint, 'negotiated disputes are counted');
select is((public.nz_owner_finance_rollup() #>> '{operations,heldNegotiations}')::bigint, 1::bigint, 'held negotiation count is exact');
select is((public.nz_owner_finance_rollup() #>> '{operations,staleHeldNegotiations}')::bigint, 1::bigint, 'stale held funds are surfaced');
select is((public.nz_owner_finance_rollup() #>> '{operations,estimatedEconomics}')::bigint, 0::bigint, 'covered records do not need estimated economics');

select ok(jsonb_array_length(public.nz_owner_finance_rollup() -> 'daily') >= 2, 'daily money series includes each active currency');
select ok(jsonb_array_length(public.nz_owner_finance_rollup() -> 'topOffers') >= 3, 'top offers are bounded and populated');
select is(jsonb_array_length(public.nz_owner_finance_rollup(now() + interval '1 day') -> 'currencies'), 0, 'future window has no settled orders');
select is(jsonb_array_length(public.nz_owner_finance_rollup(now() + interval '1 day') -> 'negotiatedWindow'), 0, 'future window has no negotiated flow');
select is(jsonb_array_length(public.nz_owner_finance_rollup(now() + interval '1 day') -> 'escrow'), 2, 'current escrow balances remain all-time');

select throws_ok(
  $$select public.nz_owner_finance_rollup('2026-08-22', '2026-08-21')$$,
  '22023', null, 'invalid date ranges are rejected'
);
select throws_ok(
  $$select public.nz_owner_finance_rollup(null, null, 1001)$$,
  '22023', null, 'invalid fallback commission is rejected'
);

select is((select count(*) from public.checkout_orders where owner_id = 'b1000000-0000-0000-0000-000000000002'), 0::bigint, 'RLS hides the other owner order');
select is((select count(*) from public.agent_negotiations where owner_id = 'b1000000-0000-0000-0000-000000000002'), 0::bigint, 'RLS hides the other owner negotiation');
select is((select count(*) from public.order_requests where owner_id = 'b1000000-0000-0000-0000-000000000002'), 0::bigint, 'RLS hides the other owner request');
select is(jsonb_array_length(public.nz_owner_finance_rollup() -> 'currencies'), 2, 'other owner money never enters the rollup');

select * from finish();
rollback;

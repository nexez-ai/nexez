begin;
set local search_path = public, extensions;

select plan(298);

-- ---------------------------------------------------------------------------
-- Fixtures: users have no confirmed email, so seller-growth automation cannot
-- issue incidental grants while the entitlement matrix is under test.
-- ---------------------------------------------------------------------------

insert into auth.users (id) values
  ('a0000000-0000-0000-0000-000000000001'), -- Free
  ('a0000000-0000-0000-0000-000000000002'), -- Launch
  ('a0000000-0000-0000-0000-000000000003'), -- Pro
  ('a0000000-0000-0000-0000-000000000004'), -- Scale
  ('a0000000-0000-0000-0000-000000000005'), -- Enterprise
  ('a0000000-0000-0000-0000-000000000006'), -- Admin with Free economics
  ('a0000000-0000-0000-0000-000000000007'), -- Competing promotions
  ('a0000000-0000-0000-0000-000000000008'), -- Non-conferring ended trial
  ('a0000000-0000-0000-0000-000000000009'), -- Finite trial
  ('a0000000-0000-0000-0000-000000000010'), -- Collaborator owner
  ('a0000000-0000-0000-0000-000000000011'), -- Listing downgrade
  ('a0000000-0000-0000-0000-000000000012'), -- Domain downgrade
  ('a0000000-0000-0000-0000-000000000013'), -- Analytics owner
  ('a0000000-0000-0000-0000-000000000014'), -- Expiring promotion
  ('a0000000-0000-0000-0000-000000000015'), -- Free domain denial
  ('a0000000-0000-0000-0000-000000000016'), -- Storefront downgrade
  ('a0000000-0000-0000-0000-000000000017'), -- Branding downgrade
  ('a0000000-0000-0000-0000-000000000018'), -- Free branding denial
  ('a0000000-0000-0000-0000-000000000020'), -- Developer-surface downgrade
  ('a0000000-0000-0000-0000-000000000021'), -- Free secret denial
  ('a0000000-0000-0000-0000-000000000022'), -- Custom-domain authoring downgrade
  ('a0000000-0000-0000-0000-000000000023'), -- Free custom-domain denial
  ('a0000000-0000-0000-0000-000000000024'), -- Calendar/AI configuration downgrade
  ('a0000000-0000-0000-0000-000000000025'), -- Calendar/AI direct denial
  ('b0000000-0000-0000-0000-000000000001'); -- Collaborator identity

insert into public.billing_subscriptions (
  owner_id,
  plan_id,
  status,
  trial_ends_at,
  account_origin
)
values
  ('a0000000-0000-0000-0000-000000000001', 'free',       'active',  null,                        'free'),
  ('a0000000-0000-0000-0000-000000000002', 'launch',     'active',  null,                        'legacy'),
  ('a0000000-0000-0000-0000-000000000003', 'pro',        'active',  null,                        'legacy'),
  ('a0000000-0000-0000-0000-000000000004', 'scale',      'active',  null,                        'legacy'),
  ('a0000000-0000-0000-0000-000000000005', 'enterprise', 'active',  null,                        'legacy'),
  ('a0000000-0000-0000-0000-000000000006', 'free',       'active',  null,                        'free'),
  ('a0000000-0000-0000-0000-000000000007', 'launch',     'active',  null,                        'legacy'),
  ('a0000000-0000-0000-0000-000000000008', 'pro',        'expired',  null,                       'trial'),
  ('a0000000-0000-0000-0000-000000000009', 'pro',        'trialing', statement_timestamp() + interval '1 day', 'trial'),
  ('a0000000-0000-0000-0000-000000000010', 'pro',        'active',  null,                        'legacy'),
  ('a0000000-0000-0000-0000-000000000011', 'scale',      'active',  null,                        'legacy'),
  ('a0000000-0000-0000-0000-000000000012', 'pro',        'active',  null,                        'legacy'),
  ('a0000000-0000-0000-0000-000000000013', 'free',       'active',  null,                        'free'),
  ('a0000000-0000-0000-0000-000000000014', 'free',       'active',  null,                        'free'),
  ('a0000000-0000-0000-0000-000000000015', 'free',       'active',  null,                        'free'),
  ('a0000000-0000-0000-0000-000000000016', 'scale',      'active',  null,                        'legacy'),
  ('a0000000-0000-0000-0000-000000000017', 'launch',     'active',  null,                        'legacy'),
  ('a0000000-0000-0000-0000-000000000018', 'free',       'active',  null,                        'free'),
  ('a0000000-0000-0000-0000-000000000020', 'pro',        'active',  null,                        'legacy'),
  ('a0000000-0000-0000-0000-000000000021', 'free',       'active',  null,                        'free'),
  ('a0000000-0000-0000-0000-000000000022', 'launch',     'active',  null,                        'legacy'),
  ('a0000000-0000-0000-0000-000000000023', 'free',       'active',  null,                        'free'),
  ('a0000000-0000-0000-0000-000000000024', 'pro',        'active',  null,                        'legacy'),
  ('a0000000-0000-0000-0000-000000000025', 'free',       'active',  null,                        'free');

insert into public.platform_admins (user_id, note)
values ('a0000000-0000-0000-0000-000000000006', 'pgTAP feature-only admin');

insert into public.owner_commercial_terms (
  owner_id,
  commission_bps,
  effective_from,
  contract_reference
)
values (
  'a0000000-0000-0000-0000-000000000005',
  150,
  statement_timestamp() - interval '1 day',
  'pgtap-enterprise-150'
);

insert into public.seller_growth_campaigns (
  id,
  campaign_key,
  name,
  status,
  grant_plan_id,
  starts_at
)
values
  ('c0000000-0000-0000-0000-000000000001', 'pgtap-plan-pro', 'pgTAP Pro grant', 'ended', 'pro', statement_timestamp() - interval '2 days'),
  ('c0000000-0000-0000-0000-000000000002', 'pgtap-plan-scale', 'pgTAP Scale grant', 'ended', 'scale', statement_timestamp() - interval '2 days'),
  ('c0000000-0000-0000-0000-000000000003', 'pgtap-plan-expiry', 'pgTAP expiry grant', 'ended', 'launch', statement_timestamp() - interval '2 days');

-- Pro ends later, but Scale must win because rank—not end date—is canonical.
insert into public.promotional_plan_grants (
  id,
  owner_id,
  campaign_id,
  plan_id,
  source,
  status,
  starts_at,
  ends_at
)
values
  ('c1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000007', 'c0000000-0000-0000-0000-000000000001', 'pro', 'admin', 'active', statement_timestamp() - interval '1 day', statement_timestamp() + interval '20 days'),
  ('c1000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000007', 'c0000000-0000-0000-0000-000000000002', 'scale', 'admin', 'active', statement_timestamp() - interval '1 day', statement_timestamp() + interval '5 days'),
  ('c1000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000014', 'c0000000-0000-0000-0000-000000000003', 'launch', 'admin', 'active', statement_timestamp() - interval '2 days', statement_timestamp() - interval '1 minute');

-- ---------------------------------------------------------------------------
-- Canonical catalog and privilege boundary.
-- ---------------------------------------------------------------------------

select is((select count(*) from private.plan_catalog), 5::bigint, 'catalog has exactly five plans');

select is(
  (
    select jsonb_agg(
      jsonb_build_object(
        'id', plan_id,
        'rank', plan_rank,
        'listings', listing_limit,
        'domains', custom_domain_limit,
        'seats', team_seat_limit,
        'storefronts', storefront_limit,
        'commissionBps', commission_bps
      ) order by plan_rank
    )
    from private.plan_catalog
  ),
  '[
    {"id":"free","rank":0,"listings":1,"domains":0,"seats":0,"storefronts":1,"commissionBps":900},
    {"id":"launch","rank":1,"listings":3,"domains":1,"seats":0,"storefronts":1,"commissionBps":700},
    {"id":"pro","rank":2,"listings":25,"domains":5,"seats":3,"storefronts":3,"commissionBps":500},
    {"id":"scale","rank":3,"listings":100,"domains":25,"seats":10,"storefronts":10,"commissionBps":300},
    {"id":"enterprise","rank":4,"listings":null,"domains":null,"seats":null,"storefronts":null,"commissionBps":200}
  ]'::jsonb,
  'catalog exactly matches the approved plan matrix'
);

select is((select count(*) from private.plan_feature_catalog), 12::bigint, 'feature catalog has exactly twelve product features');

select is(
  (select jsonb_object_agg(feature_key, min_plan_rank) from private.plan_feature_catalog),
  '{
    "customDomain":1,
    "aiFeatures":1,
    "removeBadge":1,
    "whiteLabel":1,
    "integrations":2,
    "outboundWebhooks":2,
    "apiAccess":2,
    "negotiation":2,
    "analyticsHistory":2,
    "teamCollaboration":2,
    "prioritySupport":3,
    "sso":4
  }'::jsonb,
  'feature allocations exactly match the approved cumulative matrix'
);

select ok(
  not exists (select 1 from private.plan_feature_catalog where feature_key = 'agenticCheckout'),
  'commerce readiness is absent from plan entitlements'
);
select ok(not has_table_privilege('anon', 'private.plan_catalog', 'select'), 'anon cannot read the private catalog');
select ok(not has_table_privilege('authenticated', 'private.plan_catalog', 'select'), 'authenticated cannot read the private catalog');
select ok(not has_table_privilege('authenticated', 'private.team_invite_entitlement_suspensions', 'select'), 'authenticated cannot inspect suspension state');
select ok(not has_function_privilege('anon', 'public.get_my_plan_entitlements()', 'execute'), 'anon cannot execute the entitlement RPC');
select ok(has_function_privilege('authenticated', 'public.get_my_plan_entitlements()', 'execute'), 'authenticated can execute the owner-only entitlement RPC');
select ok(not has_function_privilege('authenticated', 'public.owner_plan_rank(uuid)', 'execute'), 'arbitrary-owner rank wrapper is not a browser RPC');
select ok(not has_function_privilege('authenticated', 'private.nz_owner_plan_entitlements(uuid,timestamptz)', 'execute'), 'arbitrary-owner snapshot resolver is private');
select ok(not has_function_privilege('authenticated', 'private.nz_owner_analytics_rollup_unbounded_v1(timestamptz,timestamptz,uuid,text,text,text)', 'execute'), 'unbounded analytics implementation is private');
select ok(not has_column_privilege('authenticated', 'public.storefronts', 'plan_suspended_at', 'update'), 'browser sessions cannot forge storefront allocation state');
select ok(
  has_table_privilege('service_role', 'public.pages_public', 'select')
    and not has_table_privilege('service_role', 'public.pages_public', 'insert')
    and not has_table_privilege('service_role', 'public.pages_public', 'update')
    and not has_table_privilege('service_role', 'public.pages_public', 'delete'),
  'service role can read but never mutate the sanitized public projection'
);
select ok(
  has_table_privilege('service_role', 'public.pages', 'select')
    and has_table_privilege('service_role', 'public.pages', 'insert')
    and has_table_privilege('service_role', 'public.pages', 'update')
    and has_table_privilege('service_role', 'public.pages', 'delete'),
  'service role has the full page lifecycle operations used by trusted APIs and cleanup'
);
select ok(
  has_table_privilege('service_role', 'public.storefronts', 'select')
    and has_table_privilege('service_role', 'public.storefronts', 'delete')
    and not has_table_privilege('service_role', 'public.storefronts', 'insert')
    and not has_table_privilege('service_role', 'public.storefronts', 'update'),
  'service role storefront access is limited to trusted reads and account cleanup'
);
select ok(
  has_table_privilege('service_role', 'public.team_invites', 'select')
    and has_table_privilege('service_role', 'public.team_invites', 'update')
    and has_table_privilege('service_role', 'public.team_invites', 'delete')
    and not has_table_privilege('service_role', 'public.team_invites', 'insert'),
  'service role team access matches invite acceptance, authorization reads, and cleanup'
);
select ok(
  has_table_privilege('service_role', 'public.billing_subscriptions', 'select')
    and has_table_privilege('service_role', 'public.billing_subscriptions', 'insert')
    and has_table_privilege('service_role', 'public.billing_subscriptions', 'update')
    and has_table_privilege('service_role', 'public.billing_subscriptions', 'delete'),
  'service role billing access supports lifecycle reconciliation and account cleanup'
);
select ok(
  has_table_privilege('service_role', 'public.platform_admins', 'select')
    and has_table_privilege('service_role', 'public.platform_admins', 'delete')
    and not has_table_privilege('service_role', 'public.platform_admins', 'insert')
    and not has_table_privilege('service_role', 'public.platform_admins', 'update'),
  'service role platform-admin access is limited to entitlement reads and cleanup'
);
select ok(
  has_table_privilege('service_role', 'public.api_keys', 'select')
    and has_table_privilege('service_role', 'public.api_keys', 'update')
    and has_table_privilege('service_role', 'public.api_keys', 'delete')
    and not has_table_privilege('service_role', 'public.api_keys', 'insert'),
  'service role API-key access matches authentication bookkeeping and cleanup'
);
select ok(
  has_table_privilege('service_role', 'public.page_secrets', 'select')
    and has_table_privilege('service_role', 'public.page_secrets', 'insert')
    and has_table_privilege('service_role', 'public.page_secrets', 'update')
    and has_table_privilege('service_role', 'public.page_secrets', 'delete')
    and not has_column_privilege(
      'authenticated',
      'public.page_secrets',
      'calendly_pat_encrypted',
      'select'
    ),
  'service role can manage secrets while browser roles cannot read encrypted credentials'
);
select ok(
  has_table_privilege('service_role', 'public.shopify_installs', 'select')
    and has_table_privilege('service_role', 'public.shopify_installs', 'insert')
    and has_table_privilege('service_role', 'public.shopify_installs', 'update')
    and has_table_privilege('service_role', 'public.shopify_installs', 'delete')
    and not has_table_privilege('authenticated', 'public.shopify_installs', 'select')
    and not has_table_privilege('anon', 'public.shopify_installs', 'select'),
  'installed Shopify mappings are service-only with complete lifecycle authority'
);
select is(
  (
    select schedule
    from cron.job
    where jobname = 'nexez_reconcile_time_bound_plan_entitlements'
  ),
  '* * * * *',
  'time-bound entitlement reconciliation runs every minute'
);

-- ---------------------------------------------------------------------------
-- Atomic authenticated snapshots.
-- ---------------------------------------------------------------------------

set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.get_my_plan_entitlements() ->> 'featurePlanId', 'free', 'Free feature plan resolves');
select is(public.get_my_plan_entitlements() #> '{limits}', '{"listings":1,"customDomains":0,"teamSeats":0,"storefronts":1}'::jsonb, 'Free limits resolve exactly');
select is((public.get_my_plan_entitlements() ->> 'commissionBps')::integer, 900, 'Free commission is 900 bps');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is(public.get_my_plan_entitlements() ->> 'featurePlanId', 'launch', 'Launch feature plan resolves');
select is(public.get_my_plan_entitlements() #> '{limits}', '{"listings":3,"customDomains":1,"teamSeats":0,"storefronts":1}'::jsonb, 'Launch limits resolve exactly');
select is((public.get_my_plan_entitlements() ->> 'commissionBps')::integer, 700, 'Launch commission is 700 bps');
select ok((public.get_my_plan_entitlements() #>> '{features,whiteLabel}')::boolean, 'white-label unlocks on Launch');
select ok(not (public.get_my_plan_entitlements() #>> '{features,integrations}')::boolean, 'integrations remain locked on Launch');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is(public.get_my_plan_entitlements() ->> 'featurePlanId', 'pro', 'Pro feature plan resolves');
select is(public.get_my_plan_entitlements() #> '{limits}', '{"listings":25,"customDomains":5,"teamSeats":3,"storefronts":3}'::jsonb, 'Pro limits resolve exactly');
select is((public.get_my_plan_entitlements() ->> 'commissionBps')::integer, 500, 'Pro commission is 500 bps');
select ok((public.get_my_plan_entitlements() #>> '{features,analyticsHistory}')::boolean, 'full analytics unlocks on Pro');
select ok((public.get_my_plan_entitlements() #>> '{features,teamCollaboration}')::boolean, 'team collaboration unlocks on Pro');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is(public.get_my_plan_entitlements() #> '{limits}', '{"listings":100,"customDomains":25,"teamSeats":10,"storefronts":10}'::jsonb, 'Scale limits resolve exactly');
select is((public.get_my_plan_entitlements() ->> 'commissionBps')::integer, 300, 'Scale commission is 300 bps');
select ok((public.get_my_plan_entitlements() #>> '{features,prioritySupport}')::boolean, 'priority support unlocks on Scale');
select ok(not (public.get_my_plan_entitlements() #>> '{features,sso}')::boolean, 'SSO remains locked on Scale');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is(public.get_my_plan_entitlements() #> '{limits}', '{"listings":null,"customDomains":null,"teamSeats":null,"storefronts":null}'::jsonb, 'Enterprise limits are explicitly unlimited');
select is((public.get_my_plan_entitlements() ->> 'commissionBps')::integer, 150, 'active Enterprise commercial override is returned atomically');
select is(public.get_my_plan_entitlements() ->> 'commissionSource', 'enterprise_override', 'Enterprise override source is explicit');
select ok((public.get_my_plan_entitlements() #>> '{features,sso}')::boolean, 'SSO unlocks on Enterprise');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select is(public.get_my_plan_entitlements() ->> 'featurePlanId', 'enterprise', 'admin receives Enterprise feature plan');
select is(public.get_my_plan_entitlements() ->> 'featurePlanSource', 'admin', 'admin feature override source is explicit');
select is(public.get_my_plan_entitlements() ->> 'commercialPlanId', 'free', 'admin commercial plan remains real Free plan');
select is((public.get_my_plan_entitlements() ->> 'commissionBps')::integer, 900, 'admin does not receive Enterprise transaction economics');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000007","role":"authenticated"}', true);
select is(public.get_my_plan_entitlements() ->> 'commercialPlanId', 'scale', 'highest-ranked live promotion wins');
select is(public.get_my_plan_entitlements() #>> '{promotion,planId}', 'scale', 'promotion snapshot identifies the winning grant');
select is(public.get_my_plan_entitlements() ->> 'commercialPlanSource', 'promotion', 'promotion source is explicit');
select is((public.get_my_plan_entitlements() ->> 'commissionBps')::integer, 300, 'promotion uses the winning plan commission');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000008","role":"authenticated"}', true);
select is(public.get_my_plan_entitlements() ->> 'commercialPlanId', 'free', 'ended trial fails closed to Free');
select ok(not (public.get_my_plan_entitlements() #>> '{billing,confers}')::boolean, 'ended trial is non-conferring');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000009","role":"authenticated"}', true);
select is(public.get_my_plan_entitlements() ->> 'commercialPlanId', 'pro', 'finite future trial confers Pro');
select ok((public.get_my_plan_entitlements() #>> '{billing,confers}')::boolean, 'finite future trial is conferring');

reset role;
select set_config('request.jwt.claims', '', true);

select is(
  private.nz_owner_plan_entitlements(
    'a0000000-0000-0000-0000-000000000009',
    statement_timestamp() + interval '2 days'
  ) ->> 'commercialPlanId',
  'free',
  'finite trial stops conferring at the database boundary'
);

insert into public.pages (id, owner_id, name, slug, is_published) values
  ('d5000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000008', 'Expired trial Free listing', 'pgtap-expired-trial-free-listing', true),
  ('d5000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000009', 'Paused trial Free listing', 'pgtap-paused-trial-free-listing', true);

update public.billing_subscriptions
set status = 'paused'
where owner_id = 'a0000000-0000-0000-0000-000000000009';

select is(
  private.nz_owner_is_paused('a0000000-0000-0000-0000-000000000008'),
  false,
  'expired trial falls back to Free instead of billing-paused serving'
);
select is(
  private.nz_owner_is_paused('a0000000-0000-0000-0000-000000000009'),
  false,
  'paused subscription falls back to Free instead of billing-paused serving'
);
select ok(
  (select serving from public.pages_public where id = 'd5000000-0000-0000-0000-000000000001'),
  'expired-trial primary Free allocation remains marked serving'
);
select ok(
  (select serving from public.pages_public where id = 'd5000000-0000-0000-0000-000000000002'),
  'paused-trial primary Free allocation remains marked serving'
);

set local role anon;
select is(
  (select count(*) from public.pages_public where id = 'd5000000-0000-0000-0000-000000000001'),
  1::bigint,
  'anon can read the expired-trial primary Free listing'
);
select is(
  (select count(*) from public.pages_public where id = 'd5000000-0000-0000-0000-000000000002'),
  1::bigint,
  'anon can read the paused-trial primary Free listing'
);
reset role;

select throws_ok(
  $$update public.billing_subscriptions set status = 'mystery' where owner_id = 'a0000000-0000-0000-0000-000000000001'$$,
  '23514', null, 'unknown billing lifecycle states are rejected'
);
select throws_ok(
  $$update public.billing_subscriptions set status = 'trialing', trial_ends_at = null where owner_id = 'a0000000-0000-0000-0000-000000000008'$$,
  '23514', null, 'new null-ended trials are rejected'
);
select throws_ok(
  $$update public.billing_subscriptions set status = 'trialing', trial_ends_at = 'infinity' where owner_id = 'a0000000-0000-0000-0000-000000000008'$$,
  '23514', null, 'infinite trials are rejected'
);
select throws_ok(
  $$update public.promotional_plan_grants set ends_at = 'infinity' where id = 'c1000000-0000-0000-0000-000000000001'$$,
  '23514', null, 'active grants reject infinite end timestamps'
);
select throws_ok(
  $$update public.promotional_plan_grants set starts_at = '-infinity' where id = 'c1000000-0000-0000-0000-000000000001'$$,
  '23514', null, 'active grants reject infinite start timestamps'
);
select throws_ok(
  $$update public.seller_growth_campaigns set status = 'active', starts_at = '-infinity' where id = 'c0000000-0000-0000-0000-000000000001'$$,
  '23514', null, 'active campaigns reject infinite start timestamps'
);
select throws_ok(
  $$update public.seller_growth_campaigns set status = 'active', signup_closes_at = 'infinity' where id = 'c0000000-0000-0000-0000-000000000001'$$,
  '23514', null, 'active campaigns reject infinite signup windows'
);
select throws_ok(
  $$update public.owner_commercial_terms set commission_bps = 99 where owner_id = 'a0000000-0000-0000-0000-000000000005'$$,
  '23514', null, 'Enterprise override below 100 bps is rejected'
);
select throws_ok(
  $$update public.owner_commercial_terms set commission_bps = 201 where owner_id = 'a0000000-0000-0000-0000-000000000005'$$,
  '23514', null, 'Enterprise override above 200 bps is rejected'
);
select throws_ok(
  $$update public.owner_commercial_terms set effective_from = '-infinity' where owner_id = 'a0000000-0000-0000-0000-000000000005'$$,
  '23514', null, 'Enterprise overrides reject an infinite start timestamp'
);
select throws_ok(
  $$update public.owner_commercial_terms set effective_until = 'infinity' where owner_id = 'a0000000-0000-0000-0000-000000000005'$$,
  '23514', null, 'Enterprise overrides reject an infinite end timestamp'
);

-- NOT VALID lets a malformed pre-migration row survive deployment, so prove
-- the resolver itself still fails closed instead of applying its lower rate.
alter table public.owner_commercial_terms
  drop constraint owner_commercial_terms_effective_window_finite_check;
update public.owner_commercial_terms
set effective_until = 'infinity'
where owner_id = 'a0000000-0000-0000-0000-000000000005';
select is(
  (private.nz_owner_plan_entitlements(
    'a0000000-0000-0000-0000-000000000005',
    statement_timestamp()
  ) ->> 'commissionBps')::integer,
  200,
  'legacy infinite Enterprise window fails closed to the plan-default commission'
);
update public.owner_commercial_terms
set effective_until = null
where owner_id = 'a0000000-0000-0000-0000-000000000005';
alter table public.owner_commercial_terms
  add constraint owner_commercial_terms_effective_window_finite_check
  check (
    pg_catalog.isfinite(effective_from)
    and (
      effective_until is null
      or (
        pg_catalog.isfinite(effective_until)
        and effective_until > effective_from
      )
    )
  ) not valid;
select throws_ok(
  $$select private.nz_reconcile_time_bound_plan_entitlements(null)$$,
  '22023', null, 'lifecycle worker rejects a null batch size instead of running unbounded'
);

-- ---------------------------------------------------------------------------
-- Seller-growth issuance and invitation checks share one statement-time clock.
-- This transaction began before the grant is issued, reproducing the boundary
-- where transaction_timestamp() would incorrectly treat the new grant as future.
-- ---------------------------------------------------------------------------

update public.seller_growth_campaigns
set status = 'ended'
where status = 'active';

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
)
values (
  'c0000000-0000-0000-0000-000000000004',
  'pgtap-statement-time-growth',
  'pgTAP statement-time growth',
  'active',
  'launch',
  180,
  2,
  14,
  10,
  statement_timestamp()
);

update public.seller_growth_campaigns
set is_public_launch = true
where campaign_key = 'pgtap-statement-time-growth';

insert into auth.users (
  id,
  email,
  email_confirmed_at,
  created_at,
  updated_at
)
values (
  'a0000000-0000-0000-0000-000000000019',
  'statement-time-owner@example.test',
  statement_timestamp(),
  statement_timestamp(),
  statement_timestamp()
);

insert into public.pages (
  id,
  owner_id,
  name,
  slug,
  is_published,
  website_url,
  website_verified_at
)
values (
  'd5000000-0000-0000-0000-000000000003',
  'a0000000-0000-0000-0000-000000000019',
  'Statement-time growth listing',
  'pgtap-statement-time-growth-listing',
  true,
  'https://statement-time-growth.example.test',
  statement_timestamp()
);

select ok(
  exists (
    select 1
    from public.promotional_plan_grants as grant_row
    where grant_row.owner_id = 'a0000000-0000-0000-0000-000000000019'
      and grant_row.campaign_id = 'c0000000-0000-0000-0000-000000000004'
      and grant_row.status = 'active'
      and grant_row.starts_at > transaction_timestamp()
      and grant_row.starts_at <= statement_timestamp()
  ),
  'welcome grant starts after the transaction clock but is active at statement time'
);

select lives_ok(
  $$
    insert into public.seller_growth_invites (
      id,
      campaign_id,
      inviter_owner_id,
      inviter_business_name,
      invitee_email,
      token_hash,
      status,
      expires_at
    ) values (
      'e5000000-0000-0000-0000-000000000001',
      'c0000000-0000-0000-0000-000000000004',
      'a0000000-0000-0000-0000-000000000019',
      'Statement-time owner',
      'statement-time-invitee@example.test',
      repeat('5', 64),
      'pending',
      statement_timestamp() + interval '14 days'
    )
  $$,
  'same-transaction referral invite recognizes the statement-time grant'
);

select is(
  (
    select count(*)
    from public.seller_growth_invites
    where id = 'e5000000-0000-0000-0000-000000000001'
      and status = 'pending'
  ),
  1::bigint,
  'statement-time invite remains durably pending inside the transaction'
);

select is(
  (
    public.seller_growth_control_snapshot(
      'c0000000-0000-0000-0000-000000000004'
    ) ->> 'grants_active'
  )::integer,
  1,
  'Growth Control recognizes the same-transaction statement-time grant as active'
);

-- ---------------------------------------------------------------------------
-- The legacy page-embedded approval workflow is gated in PostgreSQL, not only
-- in the application route. Downgrades retain readable history, while a direct
-- authenticated/PostgREST update may only leave it unchanged or clear it.
-- ---------------------------------------------------------------------------

insert into public.pages (id, owner_id, name, slug)
values (
  'd5000000-0000-0000-0000-000000000004',
  'a0000000-0000-0000-0000-000000000001',
  'Team approval gate fixture',
  'pgtap-team-approval-gate'
);

insert into public.pages (id, owner_id, name, slug, created_at)
values (
  'd5000000-0000-0000-0000-000000000008',
  'a0000000-0000-0000-0000-000000000001',
  'Owner transfer authority fixture',
  'pgtap-owner-transfer-authority',
  '2026-08-20T00:00:00Z'::timestamptz
);

update public.billing_subscriptions
set plan_id = 'pro'
where owner_id = 'a0000000-0000-0000-0000-000000000001';

update public.pages
set team_collaboration = '{
  "retained": true,
  "approvals": [{
    "id": "approval-1",
    "approver": "owner@example.test",
    "status": "pending",
    "note": "retain after downgrade",
    "ts": "2026-08-22T00:00:00Z"
  }]
}'::jsonb
where id = 'd5000000-0000-0000-0000-000000000004';

insert into public.team_invites (
  id, owner_id, email, role, status
) values (
  'e5000000-0000-0000-0000-000000000004',
  'a0000000-0000-0000-0000-000000000001',
  'collaborator@example.test',
  'editor',
  'accepted'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"b0000000-0000-0000-0000-000000000001","role":"authenticated","email":"collaborator@example.test"}',
  true
);

select throws_ok(
  $$
    update public.pages
    set team_collaboration = jsonb_set(
      team_collaboration,
      '{approvals}',
      (team_collaboration -> 'approvals') ||
        '[{"id":"forged-request","approver":"editor","status":"pending","ts":"2026-08-22T00:01:00Z"}]'::jsonb
    )
    where id = 'd5000000-0000-0000-0000-000000000004'
  $$,
  '42501', null,
  'editor cannot forge a direct team approval request through PostgREST'
);

select throws_ok(
  $$
    update public.pages
    set team_collaboration = jsonb_set(
      team_collaboration,
      '{approvals,0,status}',
      '"approved"'::jsonb
    )
    where id = 'd5000000-0000-0000-0000-000000000004'
  $$,
  '42501', null,
  'editor cannot approve team workflow state through a direct page update'
);

select throws_ok(
  $$
    update public.pages
    set team_collaboration = jsonb_set(team_collaboration, '{approvals}', '[]'::jsonb)
    where id = 'd5000000-0000-0000-0000-000000000004'
  $$,
  '42501', null,
  'editor cannot clear owner team approval history through a direct page update'
);

select throws_ok(
  $$
    update public.pages
    set owner_id = 'b0000000-0000-0000-0000-000000000001',
        storefront_id = null
    where id = 'd5000000-0000-0000-0000-000000000008'
  $$,
  '42501', null,
  'accepted editor cannot seize a page by assigning owner_id to itself'
);

select throws_ok(
  $$
    update public.pages
    set created_at = '2020-01-01T00:00:00Z'::timestamptz
    where id = 'd5000000-0000-0000-0000-000000000008'
  $$,
  '42501', null,
  'accepted editor cannot backdate a page to manipulate oldest-first allocation'
);

select is(
  (
    select created_at
    from public.pages
    where id = 'd5000000-0000-0000-0000-000000000008'
  ),
  '2026-08-20T00:00:00Z'::timestamptz,
  'failed editor backdate leaves allocation ordering stable'
);

select throws_ok(
  $$
    update public.pages
    set embedding = array_fill(0.1::real, array[1536])::extensions.vector
    where id = 'd5000000-0000-0000-0000-000000000008'
  $$,
  '42501', null,
  'accepted editor cannot forge a semantic-search embedding'
);

select throws_ok(
  $$
    update public.pages
    set last_booking = '{"event_name":"Forged editor booking","at":"2026-08-22T00:00:00Z"}'::jsonb
    where id = 'd5000000-0000-0000-0000-000000000008'
  $$,
  '42501', null,
  'accepted editor cannot forge the last-booking trust signal'
);

reset role;
select set_config('request.jwt.claims', '', true);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

select throws_ok(
  $$
    update public.pages
    set owner_id = 'a0000000-0000-0000-0000-000000000002',
        storefront_id = null
    where id = 'd5000000-0000-0000-0000-000000000008'
  $$,
  '42501', null,
  'authenticated owner cannot transfer owner_id through a direct page update'
);

select throws_ok(
  $$
    update public.pages
    set embedding = array_fill(0.2::real, array[1536])::extensions.vector
    where id = 'd5000000-0000-0000-0000-000000000008'
  $$,
  '42501', null,
  'authenticated owner cannot forge a semantic-search embedding'
);

select throws_ok(
  $$
    update public.pages
    set last_booking = '{"event_name":"Forged owner booking","at":"2026-08-22T00:00:00Z"}'::jsonb
    where id = 'd5000000-0000-0000-0000-000000000008'
  $$,
  '42501', null,
  'authenticated owner cannot forge the last-booking trust signal'
);

select lives_ok(
  $$
    insert into public.pages (id, owner_id, name, slug, created_at)
    values (
      'd5000000-0000-0000-0000-000000000009',
      'a0000000-0000-0000-0000-000000000001',
      'Browser timestamp normalization',
      'pgtap-browser-timestamp-normalization',
      '2000-01-01T00:00:00Z'::timestamptz
    )
  $$,
  'authenticated owner may create a normal page even when a stale client supplies created_at'
);

select ok(
  (
    select created_at >= transaction_timestamp()
    from public.pages
    where id = 'd5000000-0000-0000-0000-000000000009'
  ),
  'authenticated page insert normalizes created_at to a trusted server timestamp'
);

select throws_ok(
  $$
    insert into public.pages (id, owner_id, name, slug, embedding)
    values (
      'd5000000-0000-0000-0000-000000000010',
      'a0000000-0000-0000-0000-000000000001',
      'Forged insert embedding',
      'pgtap-forged-insert-embedding',
      array_fill(0.4::real, array[1536])::extensions.vector
    )
  $$,
  '42501', null,
  'authenticated page insert cannot seed a semantic-search embedding'
);

select throws_ok(
  $$
    insert into public.pages (id, owner_id, name, slug, last_booking)
    values (
      'd5000000-0000-0000-0000-000000000011',
      'a0000000-0000-0000-0000-000000000001',
      'Forged insert booking',
      'pgtap-forged-insert-booking',
      '{"event_name":"Forged insert booking","at":"2026-08-22T00:00:00Z"}'::jsonb
    )
  $$,
  '42501', null,
  'authenticated page insert cannot seed the last-booking trust signal'
);

reset role;
select set_config('request.jwt.claims', '', true);

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select throws_ok(
  $$
    update public.pages
    set owner_id = 'a0000000-0000-0000-0000-000000000002',
        storefront_id = null
    where id = 'd5000000-0000-0000-0000-000000000008'
  $$,
  '42501', null,
  'service-role maintenance cannot bypass immutable page ownership'
);

select lives_ok(
  $$
    update public.pages
    set embedding = array_fill(0.3::real, array[1536])::extensions.vector
    where id = 'd5000000-0000-0000-0000-000000000008'
  $$,
  'service-role semantic reindex may write the trusted embedding signal'
);

select lives_ok(
  $$
    update public.pages
    set last_booking = '{"event_name":"Verified booking","at":"2026-08-22T00:00:00Z"}'::jsonb
    where id = 'd5000000-0000-0000-0000-000000000008'
  $$,
  'service-role webhook may write the trusted last-booking signal'
);

select lives_ok(
  $$
    insert into public.pages (
      id, owner_id, name, slug, created_at, embedding, last_booking
    ) values (
      'd5000000-0000-0000-0000-000000000012',
      'a0000000-0000-0000-0000-000000000001',
      'Trusted server import',
      'pgtap-trusted-server-import',
      '2019-01-01T00:00:00Z'::timestamptz,
      array_fill(0.5::real, array[1536])::extensions.vector,
      '{"event_name":"Imported verified booking","at":"2019-01-02T00:00:00Z"}'::jsonb
    )
  $$,
  'service-role controlled import may seed trusted page fields'
);
reset role;
select set_config('request.jwt.claims', '', true);

select ok(
  (
    select embedding is not null
      and last_booking ->> 'event_name' = 'Verified booking'
    from public.pages
    where id = 'd5000000-0000-0000-0000-000000000008'
  ),
  'only trusted server-authored ranking and activity signals persist'
);

select ok(
  (
    select created_at = '2019-01-01T00:00:00Z'::timestamptz
      and embedding is not null
      and last_booking ->> 'event_name' = 'Imported verified booking'
    from public.pages
    where id = 'd5000000-0000-0000-0000-000000000012'
  ),
  'service-role seeded timestamp, embedding, and activity signal are preserved exactly'
);

-- Direct page writes retain paid calendar/AI configuration after downgrade,
-- but cannot author or reactivate it below the feature threshold. Privacy-safe
-- disconnect and opt-out remain available on every plan.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000024","role":"authenticated"}',
  true
);
select lives_ok(
  $$
    insert into public.pages (
      id, owner_id, name, slug, google_calendar_id, llm_opt_in
    ) values (
      'd6000000-0000-0000-0000-000000000024',
      'a0000000-0000-0000-0000-000000000024',
      'Pro calendar and AI configuration',
      'pgtap-pro-calendar-ai',
      'calendar-pro@example.test',
      true
    )
  $$,
  'Pro owner may author calendar integration and AI opt-in configuration'
);
reset role;
select set_config('request.jwt.claims', '', true);
update public.billing_subscriptions
set plan_id = 'free'
where owner_id = 'a0000000-0000-0000-0000-000000000024';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000024","role":"authenticated"}',
  true
);
select lives_ok(
  $$
    update public.pages
    set name = 'Retained calendar and AI configuration'
    where id = 'd6000000-0000-0000-0000-000000000024'
  $$,
  'Free owner may edit core page content while paid calendar and AI config is retained'
);
select ok(
  (
    select google_calendar_id = 'calendar-pro@example.test' and llm_opt_in
    from public.pages
    where id = 'd6000000-0000-0000-0000-000000000024'
  ),
  'downgrade preserves calendar identity and AI consent for retained visibility'
);
select throws_ok(
  $$
    update public.pages
    set google_calendar_id = 'changed-calendar@example.test'
    where id = 'd6000000-0000-0000-0000-000000000024'
  $$,
  '23514', null,
  'Free owner cannot change a retained Google Calendar identity'
);
select lives_ok(
  $$
    update public.pages
    set google_calendar_id = null
    where id = 'd6000000-0000-0000-0000-000000000024'
  $$,
  'Free owner may disconnect a retained Google Calendar identity'
);
select throws_ok(
  $$
    update public.pages
    set google_calendar_id = 'reactivated-calendar@example.test'
    where id = 'd6000000-0000-0000-0000-000000000024'
  $$,
  '23514', null,
  'Free owner cannot reactivate Google Calendar after cleanup'
);
select lives_ok(
  $$
    update public.pages
    set llm_opt_in = false
    where id = 'd6000000-0000-0000-0000-000000000024'
  $$,
  'Free owner may always opt out of AI processing'
);
select throws_ok(
  $$
    update public.pages
    set llm_opt_in = true
    where id = 'd6000000-0000-0000-0000-000000000024'
  $$,
  '23514', null,
  'Free owner cannot opt back into AI processing'
);
reset role;
select set_config('request.jwt.claims', '', true);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000025","role":"authenticated"}',
  true
);
select throws_ok(
  $$
    insert into public.pages (
      owner_id, name, slug, google_calendar_id
    ) values (
      'a0000000-0000-0000-0000-000000000025',
      'Free calendar forgery',
      'pgtap-free-calendar-forgery',
      'free-calendar@example.test'
    )
  $$,
  '23514', null,
  'Free page insert cannot seed a Google Calendar identity'
);
select throws_ok(
  $$
    insert into public.pages (
      owner_id, name, slug, llm_opt_in
    ) values (
      'a0000000-0000-0000-0000-000000000025',
      'Free AI opt-in forgery',
      'pgtap-free-ai-opt-in-forgery',
      true
    )
  $$,
  '23514', null,
  'Free page insert cannot seed AI opt-in configuration'
);
reset role;
select set_config('request.jwt.claims', '', true);

update public.billing_subscriptions
set plan_id = 'launch'
where owner_id = 'a0000000-0000-0000-0000-000000000025';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000025","role":"authenticated"}',
  true
);
select lives_ok(
  $$
    insert into public.pages (
      id, owner_id, name, slug, llm_opt_in
    ) values (
      'd6000000-0000-0000-0000-000000000025',
      'a0000000-0000-0000-0000-000000000025',
      'Launch AI opt-in',
      'pgtap-launch-ai-opt-in',
      true
    )
  $$,
  'Launch owner may opt a page into AI processing'
);
select throws_ok(
  $$
    update public.pages
    set google_calendar_id = 'launch-calendar@example.test'
    where id = 'd6000000-0000-0000-0000-000000000025'
  $$,
  '23514', null,
  'Launch owner still cannot author Pro calendar integration configuration'
);
reset role;
select set_config('request.jwt.claims', '', true);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000025","role":"authenticated"}',
  true
);
select lives_ok(
  $$
    insert into public.agent_lab_research_runs (
      id,
      owner_id,
      kind,
      target_url,
      target_host,
      result,
      evidence
    ) values (
      'a6000000-0000-0000-0000-000000000025',
      'a0000000-0000-0000-0000-000000000025',
      'url_snapshot',
      'https://research.example.test/',
      'research.example.test',
      '{"summary":"Launch research"}'::jsonb,
      '{"source":"pgtap"}'::jsonb
    )
  $$,
  'Launch owner may save a private Agent Lab research report'
);
reset role;
select set_config('request.jwt.claims', '', true);
update public.billing_subscriptions
set plan_id = 'free'
where owner_id = 'a0000000-0000-0000-0000-000000000025';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000025","role":"authenticated"}',
  true
);
select is(
  (
    select count(*)
    from public.agent_lab_research_runs
    where owner_id = 'a0000000-0000-0000-0000-000000000025'
  ),
  1::bigint,
  'downgraded owner retains private read access to saved research history'
);
select throws_ok(
  $$
    insert into public.agent_lab_research_runs (
      owner_id,
      kind,
      target_url,
      target_host,
      result,
      evidence
    ) values (
      'a0000000-0000-0000-0000-000000000025',
      'competitor_benchmark',
      'https://blocked-research.example.test/',
      'blocked-research.example.test',
      '{"summary":"Forged Free research"}'::jsonb,
      '{"source":"pgtap"}'::jsonb
    )
  $$,
  '23514', null,
  'Free owner cannot save a new private Agent Lab research report'
);
select lives_ok(
  $$
    delete from public.agent_lab_research_runs
    where id = 'a6000000-0000-0000-0000-000000000025'
  $$,
  'downgraded owner may delete retained saved research'
);
select is(
  (
    select count(*)
    from public.agent_lab_research_runs
    where owner_id = 'a0000000-0000-0000-0000-000000000025'
  ),
  0::bigint,
  'research cleanup leaves no hidden retained row'
);
reset role;
select set_config('request.jwt.claims', '', true);

update public.billing_subscriptions
set plan_id = 'free'
where owner_id = 'a0000000-0000-0000-0000-000000000001';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

select is(
  (
    select team_collaboration #>> '{approvals,0,status}'
    from public.pages
    where id = 'd5000000-0000-0000-0000-000000000004'
  ),
  'pending',
  'Free owner retains read access to historical team approval state'
);

select throws_ok(
  $$
    update public.pages
    set team_collaboration = jsonb_set(
      team_collaboration,
      '{approvals,0,status}',
      '"approved"'::jsonb
    )
    where id = 'd5000000-0000-0000-0000-000000000004'
  $$,
  '23514', null,
  'direct Free page update cannot mutate a retained approval status'
);

select throws_ok(
  $$
    update public.pages
    set team_collaboration = jsonb_set(
      team_collaboration,
      '{approvals}',
      (team_collaboration -> 'approvals') ||
        '[{"id":"approval-2","approver":"other@example.test","status":"pending","ts":"2026-08-22T00:01:00Z"}]'::jsonb
    )
    where id = 'd5000000-0000-0000-0000-000000000004'
  $$,
  '23514', null,
  'direct Free page update cannot append an approval'
);

select lives_ok(
  $$
    update public.pages
    set team_collaboration = jsonb_set(
      team_collaboration,
      '{approvals}',
      '[]'::jsonb
    )
    where id = 'd5000000-0000-0000-0000-000000000004'
  $$,
  'direct Free page update may explicitly clear retained approvals'
);

select is(
  (
    select team_collaboration
    from public.pages
    where id = 'd5000000-0000-0000-0000-000000000004'
  ),
  '{"retained":true,"approvals":[]}'::jsonb,
  'approval cleanup preserves unrelated collaboration metadata'
);

select lives_ok(
  $$
    update public.pages
    set team_collaboration = jsonb_set(
      team_collaboration,
      '{approvals}',
      'null'::jsonb
    )
    where id = 'd5000000-0000-0000-0000-000000000004'
  $$,
  'direct Free page update may express approval cleanup as JSON null'
);

select is(
  (
    select team_collaboration
    from public.pages
    where id = 'd5000000-0000-0000-0000-000000000004'
  ),
  '{"retained":true,"approvals":[]}'::jsonb,
  'null approval cleanup is normalized to the canonical empty array'
);

reset role;
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- Embedded services/products and staged draft negotiation JSON are
-- DB-authoritative. Only open-to-offers posture and the six paid
-- pricing/automation keys are gated. Core booking/scope and unknown
-- forward-compatible rules remain authorable on every plan.
-- ---------------------------------------------------------------------------

update public.billing_subscriptions
set plan_id = 'pro'
where owner_id = 'a0000000-0000-0000-0000-000000000001';

insert into public.pages (id, owner_id, name, slug, services, products)
values (
  'd5000000-0000-0000-0000-000000000005',
  'a0000000-0000-0000-0000-000000000001',
  'Negotiation gate fixture',
  'pgtap-negotiation-gate',
  '[
    {
      "name":"Retained Service",
      "description":"Original copy",
      "price":"$1,000",
      "url":"",
      "offerType":"negotiable",
      "rules":{
        "minPrice":"$800",
        "maxDiscountPercent":15,
        "autoAccept":true,
        "autoAcceptWithinPercent":5,
        "autoCounter":true,
        "autoSettleMax":"$900",
        "minNoticeHours":24,
        "includedScope":"Planning",
        "futureCoreRule":"retained"
      }
    },
    {"name":"Fixed Service","description":"Fixed","price":"$100","url":""}
  ]'::jsonb,
  '[{
    "name":"Retained Product",
    "description":"Existing product",
    "price":"$500",
    "url":"",
    "offerType":"negotiable",
    "rules":{"minPrice":"$450","includedScope":"Delivery"}
  }]'::jsonb
);

insert into public.pages (id, owner_id, name, slug, services, products)
values (
  'd5000000-0000-0000-0000-000000000006',
  'a0000000-0000-0000-0000-000000000001',
  'Retained live to draft fixture',
  'pgtap-retained-live-to-draft',
  '[{
    "name":"Retained Draft Service",
    "description":"Live copy",
    "offerType":"negotiable",
    "rules":{"minPrice":"$700","includedScope":"Setup"}
  }]'::jsonb,
  '[]'::jsonb
);

insert into public.pages (id, owner_id, name, slug, services, products)
values (
  'd5000000-0000-0000-0000-000000000007',
  'a0000000-0000-0000-0000-000000000001',
  'Retained rename and kind move fixture',
  'pgtap-retained-rename-kind-move',
  '[{
    "name":"Original retained name",
    "description":"Live copy",
    "offerType":"negotiable",
    "rules":{"minPrice":"$600"}
  }]'::jsonb,
  '[]'::jsonb
);

update public.billing_subscriptions
set plan_id = 'free'
where owner_id = 'a0000000-0000-0000-0000-000000000001';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

select is(
  (
    select services #>> '{0,rules,minPrice}'
    from public.pages
    where id = 'd5000000-0000-0000-0000-000000000005'
  ),
  '$800',
  'Free owner retains read access to historical negotiation rules'
);

select lives_ok(
  $$
    update public.pages
    set services = jsonb_set(services, '{0,name}', '"Renamed retained offer"'::jsonb)
    where id = 'd5000000-0000-0000-0000-000000000007'
  $$,
  'downgraded owner may rename an offer without changing its paid projection'
);

select lives_ok(
  $$
    update public.pages
    set products = services,
        services = '[]'::jsonb
    where id = 'd5000000-0000-0000-0000-000000000007'
  $$,
  'downgraded owner may move a retained paid offer between services and products'
);

select lives_ok(
  $$
    update public.pages
    set services = jsonb_set(services, '{0,description}', '"Updated copy"'::jsonb)
    where id = 'd5000000-0000-0000-0000-000000000005'
  $$,
  'ordinary offer copy remains editable while retained negotiation config is unchanged'
);

select lives_ok(
  $$
    update public.pages
    set services = jsonb_set(
      jsonb_set(services, '{0,rules,minNoticeHours}', '48'::jsonb),
      '{0,rules,futureCoreRule}',
      '"changed"'::jsonb
    )
    where id = 'd5000000-0000-0000-0000-000000000005'
  $$,
  'Free may edit core and unknown rules while retained paid projection is unchanged'
);

select is(
  (
    select jsonb_build_object(
      'minNoticeHours', services #> '{0,rules,minNoticeHours}',
      'futureCoreRule', services #> '{0,rules,futureCoreRule}'
    )
    from public.pages
    where id = 'd5000000-0000-0000-0000-000000000005'
  ),
  '{"minNoticeHours":48,"futureCoreRule":"changed"}'::jsonb,
  'core-rule edits persist below Pro'
);

select throws_ok(
  $$
    update public.pages
    set services = jsonb_set(services, '{0,rules,minPrice}', '"$700"'::jsonb)
    where id = 'd5000000-0000-0000-0000-000000000005'
  $$,
  '23514', null,
  'direct Free page update cannot mutate a retained minimum price'
);

select throws_ok(
  $$
    update public.pages
    set services = jsonb_set(services, '{0,rules,maxDiscountPercent}', '20'::jsonb)
    where id = 'd5000000-0000-0000-0000-000000000005'
  $$,
  '23514', null,
  'direct Free page update cannot mutate another paid pricing key'
);

select throws_ok(
  $$
    update public.pages
    set services = jsonb_set(services, '{0,rules,autoAccept}', 'false'::jsonb)
    where id = 'd5000000-0000-0000-0000-000000000005'
  $$,
  '23514', null,
  'direct Free page update cannot mutate retained auto-accept status'
);

select throws_ok(
  $$
    update public.pages
    set services = jsonb_set(
      services,
      '{0,rules}',
      (services #> '{0,rules}') - 'minPrice'
    )
    where id = 'd5000000-0000-0000-0000-000000000005'
  $$,
  '23514', null,
  'partial paid-rule removal is rejected so downgrade cleanup stays atomic'
);

select throws_ok(
  $$
    update public.pages
    set services = jsonb_set(services, '{0,offerType}', '"fixed"'::jsonb)
    where id = 'd5000000-0000-0000-0000-000000000005'
  $$,
  '23514', null,
  'Fixed posture cannot retain paid rules as a partial cleanup bypass'
);

select throws_ok(
  $$
    update public.pages
    set services = services || '[{
      "name":"Added Negotiable",
      "description":"New",
      "price":"$200",
      "url":"",
      "offerType":"negotiable",
      "rules":{"minPrice":"$150"}
    }]'::jsonb
    where id = 'd5000000-0000-0000-0000-000000000005'
  $$,
  '23514', null,
  'direct Free page update cannot append a negotiable service'
);

select lives_ok(
  $$
    update public.pages
    set services = jsonb_set(
      services,
      '{1,rules}',
      '{"minNoticeHours":48,"blackoutDates":["2026-12-25"],"futureCoreRule":"allowed"}'::jsonb
    )
    where id = 'd5000000-0000-0000-0000-000000000005'
  $$,
  'direct Free page update may add core and unknown rules to a fixed service'
);

select lives_ok(
  $$
    update public.pages
    set services = jsonb_set(services, '{1,rules,minNoticeHours}', '72'::jsonb)
    where id = 'd5000000-0000-0000-0000-000000000005'
  $$,
  'direct Free page update may change core rules on a fixed service'
);

select is(
  (
    select services #> '{1,rules}'
    from public.pages
    where id = 'd5000000-0000-0000-0000-000000000005'
  ),
  '{"minNoticeHours":72,"blackoutDates":["2026-12-25"],"futureCoreRule":"allowed"}'::jsonb,
  'new Free core rules persist exactly'
);

select throws_ok(
  $$
    update public.pages
    set services = jsonb_set(services, '{1,rules,autoCounter}', 'true'::jsonb)
    where id = 'd5000000-0000-0000-0000-000000000005'
  $$,
  '23514', null,
  'direct Free page update cannot add a paid automation key to a fixed service'
);

select throws_ok(
  $$
    update public.pages
    set products = products || (products -> 0)
    where id = 'd5000000-0000-0000-0000-000000000005'
  $$,
  '23514', null,
  'direct Free page update cannot duplicate retained product negotiation config'
);

select lives_ok(
  $$
    update public.pages
    set services = services || '[{
      "name":"Added Fixed",
      "description":"Allowed baseline",
      "price":"$200",
      "url":"",
      "offerType":"fixed",
      "rules":{"maxProjectWeeks":6,"futureCoreRule":"new"}
    }]'::jsonb
    where id = 'd5000000-0000-0000-0000-000000000005'
  $$,
  'direct Free page update may append a fixed offer with core and unknown rules'
);

select lives_ok(
  $$
    update public.pages
    set services = jsonb_set(
      jsonb_set(services, '{0,offerType}', '"fixed"'::jsonb),
      '{0,rules}',
      (services #> '{0,rules}') - array[
        'minPrice', 'maxDiscountPercent', 'autoAccept',
        'autoAcceptWithinPercent', 'autoCounter', 'autoSettleMax'
      ]
    )
    where id = 'd5000000-0000-0000-0000-000000000005'
  $$,
  'direct Free page update may set Fixed and clear only retained paid rules'
);

select is(
  (
    select jsonb_build_object(
      'offerType', services #> '{0,offerType}',
      'rules', services #> '{0,rules}'
    )
    from public.pages
    where id = 'd5000000-0000-0000-0000-000000000005'
  ),
  '{"offerType":"fixed","rules":{"minNoticeHours":48,"includedScope":"Planning","futureCoreRule":"changed"}}'::jsonb,
  'negotiation cleanup preserves every core and unknown rule'
);

select lives_ok(
  $$
    update public.pages
    set products = jsonb_set(
      jsonb_set(products, '{0,offerType}', '"fixed"'::jsonb),
      '{0,rules}',
      (products #> '{0,rules}') - 'minPrice'
    )
    where id = 'd5000000-0000-0000-0000-000000000005'
  $$,
  'direct Free page update may remove paid product config while retaining core scope'
);

select is(
  (
    select products #> '{0,rules}'
    from public.pages
    where id = 'd5000000-0000-0000-0000-000000000005'
  ),
  '{"includedScope":"Delivery"}'::jsonb,
  'product cleanup preserves core scope rules'
);

select throws_ok(
  $$
    insert into public.pages (owner_id, name, slug, services)
    values (
      'a0000000-0000-0000-0000-000000000001',
      'Free forged negotiation',
      'pgtap-free-forged-negotiation',
      '[{"name":"Forged","description":"","price":"$10","url":"","offerType":"negotiable"}]'::jsonb
    )
  $$,
  '23514', null,
  'direct Free page insert cannot author negotiable configuration'
);

select lives_ok(
  $$
    insert into public.pages (owner_id, name, slug, services)
    values (
      'a0000000-0000-0000-0000-000000000001',
      'Free fixed listing',
      'pgtap-free-fixed-listing',
      '[{
        "name":"Fixed",
        "description":"",
        "price":"$10",
        "url":"",
        "offerType":"fixed",
        "rules":{"maxRevisions":2,"excludedScope":"Travel","futureCoreRule":"ok"}
      }]'::jsonb
    )
  $$,
  'direct Free page insert may author fixed offers with core and unknown rules'
);

select throws_ok(
  $$
    insert into public.pages (owner_id, name, slug, services)
    values (
      'a0000000-0000-0000-0000-000000000001',
      'Free paid-rule forgery',
      'pgtap-free-paid-rule-forgery',
      '[{"name":"Fixed","description":"","price":"$10","url":"","offerType":"fixed","rules":{"autoSettleMax":"$10"}}]'::jsonb
    )
  $$,
  '23514', null,
  'direct Free page insert cannot hide a paid key on a fixed offer'
);

select lives_ok(
  $$
    update public.pages
    set draft = jsonb_build_object(
      'name', 'Unrelated draft title',
      'services', services,
      'products', products
    )
    where id = 'd5000000-0000-0000-0000-000000000006'
  $$,
  'first Save Draft after downgrade may copy byte-equivalent paid live configuration'
);

select lives_ok(
  $$
    update public.pages
    set draft = jsonb_set(
      draft,
      '{services,0,rules,includedScope}',
      '"Setup and delivery"'::jsonb
    )
    where id = 'd5000000-0000-0000-0000-000000000006'
  $$,
  'Free may edit core rules in the retained initial draft'
);

select throws_ok(
  $$
    update public.pages
    set draft = jsonb_set(draft, '{services,0,rules,minPrice}', '"$600"'::jsonb)
    where id = 'd5000000-0000-0000-0000-000000000006'
  $$,
  '23514', null,
  'initial pages.draft cannot mutate paid configuration retained in live'
);

select throws_ok(
  $$
    update public.pages
    set draft = jsonb_set(
      draft,
      '{services}',
      (draft -> 'services') ||
        '[{"name":"Forged draft offer","offerType":"negotiable","rules":{"minPrice":"$10"}}]'::jsonb
    )
    where id = 'd5000000-0000-0000-0000-000000000006'
  $$,
  '23514', null,
  'initial pages.draft cannot add a new paid configuration below Pro'
);

select lives_ok(
  $$
    update public.pages
    set name = draft ->> 'name',
        services = draft -> 'services',
        products = draft -> 'products',
        draft = null,
        draft_updated_at = null
    where id = 'd5000000-0000-0000-0000-000000000006'
  $$,
  'publishing a draft with unchanged paid projection and core edits remains allowed after downgrade'
);

reset role;
select set_config('request.jwt.claims', '', true);

alter table public.pages disable trigger trg_enforce_page_negotiation_plan;
update public.pages
set draft = '{
  "services":[{
    "name":"Legacy forged draft",
    "offerType":"negotiable",
    "rules":{"minPrice":"$1"}
  }],
  "products":[]
}'::jsonb
where id = 'd5000000-0000-0000-0000-000000000006';
alter table public.pages enable trigger trg_enforce_page_negotiation_plan;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

select throws_ok(
  $$
    update public.pages
    set services = draft -> 'services',
        products = draft -> 'products',
        draft = null
    where id = 'd5000000-0000-0000-0000-000000000006'
  $$,
  '23514', null,
  'publishing a legacy forged draft cannot smuggle new paid configuration below Pro'
);

reset role;
select set_config('request.jwt.claims', '', true);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);

select lives_ok(
  $$
    insert into public.pages (owner_id, name, slug, services)
    values (
      'a0000000-0000-0000-0000-000000000002',
      'Launch core rules',
      'pgtap-launch-core-rules',
      '[{"name":"Launch fixed","offerType":"fixed","rules":{"minNoticeHours":24,"maxProjectWeeks":8}}]'::jsonb
    )
  $$,
  'Launch may create core booking and scope rules'
);

select lives_ok(
  $$
    update public.pages
    set services = jsonb_set(services, '{0,rules,maxProjectWeeks}', '10'::jsonb)
    where slug = 'pgtap-launch-core-rules'
  $$,
  'Launch may change core rules'
);

reset role;
select set_config('request.jwt.claims', '', true);

update public.billing_subscriptions
set plan_id = 'pro'
where owner_id = 'a0000000-0000-0000-0000-000000000001';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

select lives_ok(
  $$
    update public.pages
    set services = jsonb_set(services, '{1,rules,autoSettleMax}', '"$95"'::jsonb)
    where id = 'd5000000-0000-0000-0000-000000000005'
  $$,
  'Pro may author paid automation rules through the direct page path'
);

select lives_ok(
  $$
    update public.pages
    set draft = '{
      "services":[{
        "name":"Retained Draft",
        "offerType":"negotiable",
        "rules":{"minPrice":"$700","autoCounter":true,"includedScope":"Setup"}
      }],
      "products":[]
    }'::jsonb
    where id = 'd5000000-0000-0000-0000-000000000005'
  $$,
  'Pro may author paid negotiation configuration in pages.draft'
);

reset role;
select set_config('request.jwt.claims', '', true);

update public.billing_subscriptions
set plan_id = 'free'
where owner_id = 'a0000000-0000-0000-0000-000000000001';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

select lives_ok(
  $$
    update public.pages
    set draft = jsonb_set(draft, '{services,0,rules,includedScope}', '"Setup and delivery"'::jsonb)
    where id = 'd5000000-0000-0000-0000-000000000005'
  $$,
  'downgraded owner may edit core rules in a retained paid draft'
);

select throws_ok(
  $$
    update public.pages
    set draft = jsonb_set(draft, '{services,0,rules,minPrice}', '"$600"'::jsonb)
    where id = 'd5000000-0000-0000-0000-000000000005'
  $$,
  '23514', null,
  'downgraded owner cannot mutate retained paid draft configuration'
);

select lives_ok(
  $$
    update public.pages
    set draft = jsonb_set(
      jsonb_set(draft, '{services,0,offerType}', '"fixed"'::jsonb),
      '{services,0,rules}',
      (draft #> '{services,0,rules}') - array['minPrice', 'autoCounter']
    )
    where id = 'd5000000-0000-0000-0000-000000000005'
  $$,
  'downgraded owner may clean paid draft config while preserving core rules'
);

select is(
  (
    select jsonb_build_object(
      'offerType', draft #> '{services,0,offerType}',
      'rules', draft #> '{services,0,rules}'
    )
    from public.pages
    where id = 'd5000000-0000-0000-0000-000000000005'
  ),
  '{"offerType":"fixed","rules":{"includedScope":"Setup and delivery"}}'::jsonb,
  'draft cleanup strips only paid keys and retains core configuration'
);

reset role;
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- Developer and manual-connector authoring is gated in PostgreSQL. Downgrades
-- retain rows for visibility and cleanup, while direct table writes cannot
-- mint, reconfigure, or reactivate paid credentials and delivery endpoints.
-- ---------------------------------------------------------------------------

insert into public.pages (id, owner_id, name, slug) values
  (
    'd7000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000020',
    'Developer surface downgrade',
    'pgtap-developer-surface-downgrade'
  ),
  (
    'd7000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-000000000021',
    'Free secret boundary',
    'pgtap-free-secret-boundary'
  );

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000020","role":"authenticated"}',
  true
);

select lives_ok(
  $$
    insert into public.api_keys (
      id, owner_id, name, key_hash, prefix
    ) values (
      'a7000000-0000-0000-0000-000000000001',
      'a0000000-0000-0000-0000-000000000020',
      'Retained API key',
      repeat('a', 64),
      'nz_live_'
    )
  $$,
  'Pro may create an API key through the direct owner table path'
);

select throws_ok(
  $$
    insert into public.outbound_webhooks (
      id, owner_id, url, secret, active
    ) values (
      'b7000000-0000-0000-0000-000000000001',
      'a0000000-0000-0000-0000-000000000020',
      'https://hooks.example.test/retained',
      'whsec_retained',
      true
    )
  $$,
  '42501', null,
  'Authenticated Pro clients cannot access account webhook secrets through the direct table path'
);

select lives_ok(
  $$
    insert into public.page_secrets (
      page_id,
      owner_id,
      calendly_webhook_secret,
      outbound_webhooks,
      domain_verification_token,
      calendly_pat_encrypted,
      shopify_credentials_encrypted,
      square_credentials_encrypted,
      acuity_credentials_encrypted
    ) values (
      'd7000000-0000-0000-0000-000000000001',
      'a0000000-0000-0000-0000-000000000020',
      'calendly-hook-retained',
      '[{"url":"https://hooks.example.test/page-retained"}]'::jsonb,
      'keep-safe-domain-token',
      'enc:calendly-retained',
      'enc:manual-shopify-retained',
      'enc:square-retained',
      'enc:acuity-retained'
    )
  $$,
  'Pro may store per-page outbound endpoints and manual connector credentials'
);

reset role;
select set_config('request.jwt.claims', '', true);

insert into public.outbound_webhooks (
  id, owner_id, url, secret, active
) values (
  'b7000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000020',
  'https://hooks.example.test/retained',
  'whsec_retained',
  true
);

update public.billing_subscriptions
set plan_id = 'free'
where owner_id = 'a0000000-0000-0000-0000-000000000020';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000020","role":"authenticated"}',
  true
);

select lives_ok(
  $$
    update public.api_keys
    set name = name
    where id = 'a7000000-0000-0000-0000-000000000001'
  $$,
  'Free downgrade may retain an API key unchanged'
);

select throws_ok(
  $$
    update public.api_keys
    set name = 'Reconfigured below Pro'
    where id = 'a7000000-0000-0000-0000-000000000001'
  $$,
  '23514', null,
  'Free downgrade cannot reconfigure a retained API key'
);

select lives_ok(
  $$
    update public.api_keys
    set revoked_at = statement_timestamp()
    where id = 'a7000000-0000-0000-0000-000000000001'
  $$,
  'Free downgrade may revoke a retained API key'
);

select throws_ok(
  $$
    update public.api_keys
    set revoked_at = null
    where id = 'a7000000-0000-0000-0000-000000000001'
  $$,
  '23514', null,
  'Free downgrade cannot reactivate a revoked API key'
);

select throws_ok(
  $$
    insert into public.api_keys (owner_id, name, key_hash, prefix)
    values (
      'a0000000-0000-0000-0000-000000000020',
      'Forged Free key',
      repeat('b', 64),
      'nz_free_'
    )
  $$,
  '23514', null,
  'Free owner cannot mint an API key through PostgREST'
);

select throws_ok(
  $$
    update public.outbound_webhooks
    set url = url,
        secret = secret,
        active = active
    where id = 'b7000000-0000-0000-0000-000000000001'
  $$,
  '42501', null,
  'Authenticated Free clients cannot touch retained account webhook secrets'
);

select throws_ok(
  $$
    update public.outbound_webhooks
    set url = 'https://hooks.example.test/changed'
    where id = 'b7000000-0000-0000-0000-000000000001'
  $$,
  '42501', null,
  'Authenticated Free clients cannot reconfigure a retained account webhook'
);

select throws_ok(
  $$
    update public.outbound_webhooks
    set active = false
    where id = 'b7000000-0000-0000-0000-000000000001'
  $$,
  '42501', null,
  'Authenticated Free clients cannot disable a retained account webhook directly'
);

select throws_ok(
  $$
    update public.outbound_webhooks
    set active = true
    where id = 'b7000000-0000-0000-0000-000000000001'
  $$,
  '42501', null,
  'Authenticated Free clients cannot re-enable a retained account webhook directly'
);

select throws_ok(
  $$
    insert into public.outbound_webhooks (owner_id, url, secret)
    values (
      'a0000000-0000-0000-0000-000000000020',
      'https://hooks.example.test/free-forged',
      'whsec_free_forged'
    )
  $$,
  '42501', null,
  'Authenticated Free clients cannot register an account webhook through PostgREST'
);

select lives_ok(
  $$
    update public.page_secrets
    set outbound_webhooks = '[{"url":"https://hooks.example.test/page-retained"}]'::jsonb,
        calendly_webhook_secret = 'calendly-hook-retained',
        calendly_pat_encrypted = 'enc:calendly-retained',
        shopify_credentials_encrypted = 'enc:manual-shopify-retained',
        square_credentials_encrypted = 'enc:square-retained',
        acuity_credentials_encrypted = 'enc:acuity-retained'
    where page_id = 'd7000000-0000-0000-0000-000000000001'
  $$,
  'Free downgrade may retain existing page endpoints and credentials unchanged'
);

select throws_ok(
  $$
    update public.page_secrets
    set outbound_webhooks = '[{"url":"https://hooks.example.test/page-changed"}]'::jsonb
    where page_id = 'd7000000-0000-0000-0000-000000000001'
  $$,
  '23514', null,
  'Free downgrade cannot mutate retained per-page outbound endpoints'
);

select throws_ok(
  $$
    update public.page_secrets
    set calendly_pat_encrypted = 'enc:changed-below-pro'
    where page_id = 'd7000000-0000-0000-0000-000000000001'
  $$,
  '23514', null,
  'Free downgrade cannot replace a retained manual connector credential'
);

select lives_ok(
  $$
    update public.page_secrets
    set outbound_webhooks = '[]'::jsonb
    where page_id = 'd7000000-0000-0000-0000-000000000001'
  $$,
  'Free downgrade may clear retained per-page outbound endpoints'
);

select lives_ok(
  $$
    update public.page_secrets
    set calendly_webhook_secret = null,
        calendly_pat_encrypted = null,
        shopify_credentials_encrypted = null,
        square_credentials_encrypted = null,
        acuity_credentials_encrypted = null
    where page_id = 'd7000000-0000-0000-0000-000000000001'
  $$,
  'Free downgrade may disconnect all retained manual connector credentials'
);

reset role;
select set_config('request.jwt.claims', '', true);

select ok(
  (
    select outbound_webhooks = '[]'::jsonb
      and calendly_webhook_secret is null
      and calendly_pat_encrypted is null
      and shopify_credentials_encrypted is null
      and square_credentials_encrypted is null
      and acuity_credentials_encrypted is null
      and domain_verification_token = 'keep-safe-domain-token'
    from public.page_secrets
    where page_id = 'd7000000-0000-0000-0000-000000000001'
  ),
  'credential cleanup preserves non-paid page-secret state'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000020","role":"authenticated"}',
  true
);

select throws_ok(
  $$
    update public.page_secrets
    set shopify_credentials_encrypted = 'enc:manual-shopify-readded'
    where page_id = 'd7000000-0000-0000-0000-000000000001'
  $$,
  '23514', null,
  'Free owner cannot re-add manual Shopify Admin credentials after cleanup'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000021","role":"authenticated"}',
  true
);

select throws_ok(
  $$
    insert into public.page_secrets (
      page_id, owner_id, calendly_pat_encrypted
    ) values (
      'd7000000-0000-0000-0000-000000000002',
      'a0000000-0000-0000-0000-000000000021',
      'enc:free-forged-calendly'
    )
  $$,
  '23514', null,
  'new Free page-secret row cannot seed a manual connector credential'
);

select throws_ok(
  $$
    insert into public.page_secrets (
      page_id, owner_id, outbound_webhooks
    ) values (
      'd7000000-0000-0000-0000-000000000002',
      'a0000000-0000-0000-0000-000000000021',
      '[{"url":"https://hooks.example.test/free-page-forged"}]'::jsonb
    )
  $$,
  '23514', null,
  'new Free page-secret row cannot seed a per-page outbound endpoint'
);

select lives_ok(
  $$
    insert into public.page_secrets (
      page_id, owner_id, domain_verification_token, website_verification_token
    ) values (
      'd7000000-0000-0000-0000-000000000002',
      'a0000000-0000-0000-0000-000000000021',
      'free-domain-token',
      'free-website-token'
    )
  $$,
  'Free owner may persist non-paid verification state in page_secrets'
);

reset role;
select set_config('request.jwt.claims', '', true);

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select lives_ok(
  $$
    insert into public.shopify_installs (
      shop_domain, owner_id, page_id, offline_token_encrypted, scope
    ) values (
      'all-plan-installed-app.myshopify.com',
      'a0000000-0000-0000-0000-000000000021',
      'd7000000-0000-0000-0000-000000000002',
      'enc:installed-app-token',
      'read_products'
    )
  $$,
  'installed Shopify OAuth app remains available to a Free owner through its service-only table'
);
reset role;
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- Launch branding is retention-aware at the database boundary. Downgrades
-- preserve configured brands for management, but direct PostgREST writes may
-- only leave paid keys unchanged or explicitly clear them.
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000017","role":"authenticated"}',
  true
);

select lives_ok(
  $$
    insert into public.pages (id, owner_id, name, slug, branding)
    values (
      'd6000000-0000-0000-0000-000000000001',
      'a0000000-0000-0000-0000-000000000017',
      'Launch branded page',
      'pgtap-launch-branded-page',
      '{
        "brand_name":"Retained Brand",
        "accent_color":"#123456",
        "logo_url":"https://cdn.example.test/retained.svg",
        "hide_nexez_badge":true,
        "layout":"editorial"
      }'::jsonb
    )
  $$,
  'Launch may create page branding through the direct page path'
);

select lives_ok(
  $$
    insert into public.storefronts (
      owner_id, handle, display_name, logo_url, accent_color
    ) values (
      'a0000000-0000-0000-0000-000000000017',
      'pgtap-launch-branded-store',
      'Launch branded store',
      'https://cdn.example.test/store-retained.svg',
      '#654321'
    )
  $$,
  'Launch may create storefront branding through the direct storefront path'
);

reset role;
select set_config('request.jwt.claims', '', true);

update public.billing_subscriptions
set plan_id = 'free'
where owner_id = 'a0000000-0000-0000-0000-000000000017';

select ok(
  (
    select branding ->> 'brand_name' = 'Retained Brand'
      and branding ->> 'layout' = 'editorial'
    from public.pages
    where id = 'd6000000-0000-0000-0000-000000000001'
  )
  and (
    select logo_url = 'https://cdn.example.test/store-retained.svg'
      and accent_color = '#654321'
    from public.storefronts
    where handle = 'pgtap-launch-branded-store'
  ),
  'downgrade retains page and storefront branding without destructive rewrites'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000017","role":"authenticated"}',
  true
);

select lives_ok(
  $$
    update public.pages
    set branding = branding
    where id = 'd6000000-0000-0000-0000-000000000001'
  $$,
  'Free downgrade may retain page branding byte-for-byte during unrelated saves'
);

select lives_ok(
  $$
    update public.pages
    set branding = jsonb_set(branding, '{layout}', '"compact"'::jsonb)
    where id = 'd6000000-0000-0000-0000-000000000001'
  $$,
  'Free downgrade may edit unknown or core branding JSON keys'
);

select throws_ok(
  $$
    update public.pages
    set branding = jsonb_set(branding, '{brand_name}', '"Changed Brand"'::jsonb)
    where id = 'd6000000-0000-0000-0000-000000000001'
  $$,
  '23514', null,
  'Free downgrade cannot mutate retained page brand name'
);

select throws_ok(
  $$
    update public.pages
    set branding = jsonb_set(branding, '{accent_color}', '"#abcdef"'::jsonb)
    where id = 'd6000000-0000-0000-0000-000000000001'
  $$,
  '23514', null,
  'Free downgrade cannot mutate retained page accent color'
);

select throws_ok(
  $$
    update public.pages
    set branding = jsonb_set(
      branding,
      '{logo_url}',
      '"https://cdn.example.test/changed.svg"'::jsonb
    )
    where id = 'd6000000-0000-0000-0000-000000000001'
  $$,
  '23514', null,
  'Free downgrade cannot mutate retained page logo'
);

select lives_ok(
  $$
    update public.pages
    set branding = jsonb_set(
      branding - array['brand_name', 'accent_color', 'logo_url'],
      '{hide_nexez_badge}',
      'false'::jsonb,
      true
    )
    where id = 'd6000000-0000-0000-0000-000000000001'
  $$,
  'Free downgrade may clear all paid page-branding keys in one explicit cleanup'
);

select is(
  (
    select branding
    from public.pages
    where id = 'd6000000-0000-0000-0000-000000000001'
  ),
  '{"hide_nexez_badge":false,"layout":"compact"}'::jsonb,
  'page branding cleanup preserves unknown configuration and removes only paid values'
);

select throws_ok(
  $$
    update public.pages
    set branding = jsonb_set(branding, '{hide_nexez_badge}', 'true'::jsonb)
    where id = 'd6000000-0000-0000-0000-000000000001'
  $$,
  '23514', null,
  'Free owner cannot hide the Nexez badge after cleanup'
);

select throws_ok(
  $$
    update public.pages
    set branding = jsonb_set(branding, '{brand_name}', '"Re-added Brand"'::jsonb)
    where id = 'd6000000-0000-0000-0000-000000000001'
  $$,
  '23514', null,
  'Free owner cannot re-add white-label page branding after cleanup'
);

select lives_ok(
  $$
    update public.storefronts
    set logo_url = logo_url,
        accent_color = accent_color
    where handle = 'pgtap-launch-branded-store'
  $$,
  'Free downgrade may retain storefront branding byte-for-byte'
);

select throws_ok(
  $$
    update public.storefronts
    set logo_url = 'https://cdn.example.test/store-changed.svg'
    where handle = 'pgtap-launch-branded-store'
  $$,
  '23514', null,
  'Free downgrade cannot mutate retained storefront logo'
);

select throws_ok(
  $$
    update public.storefronts
    set accent_color = '#fedcba'
    where handle = 'pgtap-launch-branded-store'
  $$,
  '23514', null,
  'Free downgrade cannot mutate retained storefront accent color'
);

select lives_ok(
  $$
    update public.storefronts
    set logo_url = '   ',
        accent_color = null
    where handle = 'pgtap-launch-branded-store'
  $$,
  'Free downgrade may explicitly clear retained storefront branding'
);

select ok(
  (
    select logo_url is null and accent_color is null
    from public.storefronts
    where handle = 'pgtap-launch-branded-store'
  ),
  'storefront cleanup canonicalizes blank values to null'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000018","role":"authenticated"}',
  true
);

select throws_ok(
  $$
    insert into public.pages (owner_id, name, slug, branding)
    values (
      'a0000000-0000-0000-0000-000000000018',
      'Free forged brand',
      'pgtap-free-forged-brand',
      '{"brand_name":"Not allocated","hide_nexez_badge":true}'::jsonb
    )
  $$,
  '23514', null,
  'new Free page cannot seed paid branding configuration'
);

select lives_ok(
  $$
    insert into public.pages (owner_id, name, slug, branding)
    values (
      'a0000000-0000-0000-0000-000000000018',
      'Free core brand metadata',
      'pgtap-free-core-brand-metadata',
      '{"layout":"minimal","announcement":"Welcome"}'::jsonb
    )
  $$,
  'Free page may preserve forward-compatible non-paid branding metadata'
);

select throws_ok(
  $$
    insert into public.storefronts (
      owner_id, handle, logo_url, accent_color
    ) values (
      'a0000000-0000-0000-0000-000000000018',
      'pgtap-free-forged-branded-store',
      'https://cdn.example.test/not-allocated.svg',
      '#112233'
    )
  $$,
  '23514', null,
  'new Free storefront cannot seed paid logo or accent configuration'
);

select lives_ok(
  $$
    insert into public.storefronts (owner_id, handle, display_name)
    values (
      'a0000000-0000-0000-0000-000000000018',
      'pgtap-free-unbranded-store',
      'Free unbranded store'
    )
  $$,
  'Free owner may create the normal unbranded storefront allocation'
);

reset role;
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- Serialized quota triggers and non-destructive downgrade reconciliation.
-- ---------------------------------------------------------------------------

insert into public.storefronts (owner_id, handle)
values ('a0000000-0000-0000-0000-000000000001', 'pgtap-free-store');
select is((select count(*) from public.storefronts where owner_id = 'a0000000-0000-0000-0000-000000000001'), 1::bigint, 'Free receives one storefront');
select throws_ok(
  $$insert into public.storefronts (owner_id, handle) values ('a0000000-0000-0000-0000-000000000001', 'pgtap-free-store-two')$$,
  '23514', null, 'Free cannot create a second storefront'
);

insert into public.storefronts (owner_id, handle) values
  ('a0000000-0000-0000-0000-000000000003', 'pgtap-pro-store-one'),
  ('a0000000-0000-0000-0000-000000000003', 'pgtap-pro-store-two'),
  ('a0000000-0000-0000-0000-000000000003', 'pgtap-pro-store-three');
select is((select count(*) from public.storefronts where owner_id = 'a0000000-0000-0000-0000-000000000003'), 3::bigint, 'Pro receives three storefronts');
select throws_ok(
  $$insert into public.storefronts (owner_id, handle) values ('a0000000-0000-0000-0000-000000000003', 'pgtap-pro-store-four')$$,
  '23514', null, 'Pro cannot create a fourth storefront'
);

insert into public.storefronts (id, owner_id, handle, created_at) values
  ('f1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000016', 'pgtap-scale-store-one', statement_timestamp() - interval '4 minutes'),
  ('f1000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000016', 'pgtap-scale-store-two', statement_timestamp() - interval '3 minutes'),
  ('f1000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000016', 'pgtap-scale-store-three', statement_timestamp() - interval '2 minutes'),
  ('f1000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000016', 'pgtap-scale-store-four', statement_timestamp() - interval '1 minute');

insert into public.pages (id, owner_id, storefront_id, name, slug, is_published) values
  ('d4000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000016', 'f1000000-0000-0000-0000-000000000001', 'Storefront listing 1', 'pgtap-storefront-listing-1', true),
  ('d4000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000016', 'f1000000-0000-0000-0000-000000000002', 'Storefront listing 2', 'pgtap-storefront-listing-2', true),
  ('d4000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000016', 'f1000000-0000-0000-0000-000000000003', 'Storefront listing 3', 'pgtap-storefront-listing-3', true),
  ('d4000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000016', 'f1000000-0000-0000-0000-000000000004', 'Storefront listing 4', 'pgtap-storefront-listing-4', true);

select is(
  (select count(*) from public.storefronts where owner_id = 'a0000000-0000-0000-0000-000000000016' and plan_suspended_at is null),
  4::bigint,
  'Scale initially allocates all four storefronts'
);

update public.billing_subscriptions
set plan_id = 'pro'
where owner_id = 'a0000000-0000-0000-0000-000000000016';

select is(
  (select count(*) from public.storefronts where owner_id = 'a0000000-0000-0000-0000-000000000016'),
  4::bigint,
  'storefront downgrade preserves every brand row'
);
select is(
  (select count(*) from public.storefronts where owner_id = 'a0000000-0000-0000-0000-000000000016' and plan_suspended_at is null),
  3::bigint,
  'Pro downgrade keeps exactly three storefronts allocated'
);
select ok(
  (select plan_suspended_at is not null from public.storefronts where id = 'f1000000-0000-0000-0000-000000000004'),
  'deterministic newest storefront is suspended first'
);
select is(
  (select storefront_id from public.pages where id = 'd4000000-0000-0000-0000-000000000004'),
  'f1000000-0000-0000-0000-000000000004'::uuid,
  'downgrade preserves an existing suspended-storefront assignment'
);
select is(
  (select count(*) from public.pages_public where id in (
    'd4000000-0000-0000-0000-000000000001',
    'd4000000-0000-0000-0000-000000000002',
    'd4000000-0000-0000-0000-000000000003',
    'd4000000-0000-0000-0000-000000000004'
  ) and serving),
  3::bigint,
  'projection marks only allocated storefront listings as serving'
);

insert into public.team_invites (id, owner_id, email, role, status)
values (
  'e5000000-0000-0000-0000-000000000016',
  'a0000000-0000-0000-0000-000000000016',
  'storefront-editor@example.test',
  'editor',
  'accepted'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"b0000000-0000-0000-0000-000000000001","role":"authenticated","email":"storefront-editor@example.test"}',
  true
);
select throws_ok(
  $$
    update public.pages
    set storefront_id = 'f1000000-0000-0000-0000-000000000002'
    where id = 'd4000000-0000-0000-0000-000000000001'
  $$,
  '42501', null,
  'accepted editor cannot move an owner listing between account storefronts'
);
select is(
  (select storefront_id from public.pages where id = 'd4000000-0000-0000-0000-000000000001'),
  'f1000000-0000-0000-0000-000000000001'::uuid,
  'rejected editor move preserves the owner storefront assignment'
);
reset role;
select set_config('request.jwt.claims', '', true);

set local role anon;
select is(
  (select count(*) from public.pages_public where id in (
    'd4000000-0000-0000-0000-000000000001',
    'd4000000-0000-0000-0000-000000000002',
    'd4000000-0000-0000-0000-000000000003',
    'd4000000-0000-0000-0000-000000000004'
  )),
  3::bigint,
  'anon serving RLS hides suspended-storefront listings'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000016","role":"authenticated"}', true);
select lives_ok(
  $$
    update public.pages
    set storefront_id = 'f1000000-0000-0000-0000-000000000002'
    where id = 'd4000000-0000-0000-0000-000000000001'
  $$,
  'authenticated owner may move its listing between active storefronts'
);
select is(
  (select count(*) from public.storefronts where owner_id = 'a0000000-0000-0000-0000-000000000016'),
  4::bigint,
  'owner management reads retain suspended storefronts'
);
select throws_ok(
  $$update public.storefronts set plan_suspended_at = null where id = 'f1000000-0000-0000-0000-000000000004'$$,
  '42501', null, 'owner cannot clear the system storefront suspension marker'
);
reset role;
select set_config('request.jwt.claims', '', true);

select throws_ok(
  $$insert into public.pages (owner_id, storefront_id, name, slug) values ('a0000000-0000-0000-0000-000000000016', 'f1000000-0000-0000-0000-000000000004', 'Suspended assignment', 'pgtap-suspended-assignment')$$,
  '23514', null, 'new page cannot target a suspended storefront'
);
select throws_ok(
  $$update public.pages set storefront_id = 'f1000000-0000-0000-0000-000000000004' where id = 'd4000000-0000-0000-0000-000000000001'$$,
  '23514', null, 'existing page cannot move into a suspended storefront'
);
select lives_ok(
  $$update public.pages set name = 'Storefront listing 4 retained' where id = 'd4000000-0000-0000-0000-000000000004'$$,
  'existing suspended-storefront assignment remains editable'
);
select ok(
  not (select serving from public.pages_public where id = 'd4000000-0000-0000-0000-000000000004'),
  'editing an existing suspended assignment cannot restore public serving'
);

insert into public.pages (id, owner_id, name, slug)
values ('d4000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000016', 'Implicit active storefront', 'pgtap-implicit-active-storefront');
select is(
  (select storefront_id from public.pages where id = 'd4000000-0000-0000-0000-000000000005'),
  'f1000000-0000-0000-0000-000000000001'::uuid,
  'implicit page assignment chooses the oldest active storefront'
);

update public.billing_subscriptions
set plan_id = 'scale'
where owner_id = 'a0000000-0000-0000-0000-000000000016';
select is(
  (select count(*) from public.storefronts where owner_id = 'a0000000-0000-0000-0000-000000000016' and plan_suspended_at is null),
  4::bigint,
  'upgrade restores every newly eligible storefront without recreation'
);
select is(
  (select count(*) from public.pages_public where id in (
    'd4000000-0000-0000-0000-000000000001',
    'd4000000-0000-0000-0000-000000000002',
    'd4000000-0000-0000-0000-000000000003',
    'd4000000-0000-0000-0000-000000000004'
  ) and serving),
  4::bigint,
  'upgrade restores public serving for retained assignments'
);

update public.billing_subscriptions
set plan_id = 'pro'
where owner_id = 'a0000000-0000-0000-0000-000000000016';
select is(
  (select count(*) from public.storefronts where owner_id = 'a0000000-0000-0000-0000-000000000016' and plan_suspended_at is not null),
  1::bigint,
  'a later downgrade reapplies the exact storefront allocation'
);
delete from public.storefronts
where id = 'f1000000-0000-0000-0000-000000000001';
select is(
  (select count(*) from public.storefronts where owner_id = 'a0000000-0000-0000-0000-000000000016' and plan_suspended_at is null),
  3::bigint,
  'deleting an active storefront reconciles the remaining allocation immediately'
);
select ok(
  (select plan_suspended_at is null from public.storefronts where id = 'f1000000-0000-0000-0000-000000000004'),
  'deletion restores the oldest retained storefront now inside the limit'
);

-- Direct page writes cannot stage or reactivate paid domain routing below
-- Launch. Downgrades retain existing configuration until explicit cleanup.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000022","role":"authenticated"}',
  true
);
select lives_ok(
  $$
    insert into public.pages (
      id, owner_id, name, slug, custom_domain, domain_path
    ) values (
      'd9000000-0000-0000-0000-000000000001',
      'a0000000-0000-0000-0000-000000000022',
      'Launch retained domain',
      'pgtap-launch-retained-domain',
      'retained-launch.example.test',
      '/pricing'
    )
  $$,
  'Launch owner may author an unverified custom domain and routing path'
);
reset role;
select set_config('request.jwt.claims', '', true);

update public.pages
set custom_domain_verified = statement_timestamp()
where id = 'd9000000-0000-0000-0000-000000000001';
update public.billing_subscriptions
set plan_id = 'free'
where owner_id = 'a0000000-0000-0000-0000-000000000022';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000022","role":"authenticated"}',
  true
);
select lives_ok(
  $$
    update public.pages
    set name = 'Retained domain after downgrade'
    where id = 'd9000000-0000-0000-0000-000000000001'
  $$,
  'Free owner may edit core page content while retained domain routing stays unchanged'
);
select ok(
  (
    select custom_domain = 'retained-launch.example.test'
      and domain_path = '/pricing'
      and custom_domain_verified is not null
    from public.pages
    where id = 'd9000000-0000-0000-0000-000000000001'
  ),
  'downgrade retains the configured domain, path, and verification proof'
);
select throws_ok(
  $$
    update public.pages
    set domain_path = '/forged'
    where id = 'd9000000-0000-0000-0000-000000000001'
  $$,
  '23514', null,
  'Free owner cannot change a retained paid routing path'
);
select throws_ok(
  $$
    update public.pages
    set custom_domain = 'changed-below-launch.example.test'
    where id = 'd9000000-0000-0000-0000-000000000001'
  $$,
  '23514', null,
  'Free owner cannot replace a retained custom domain'
);
select lives_ok(
  $$
    update public.pages
    set custom_domain_verified = null
    where id = 'd9000000-0000-0000-0000-000000000001'
  $$,
  'Free owner may destructively clear a retained domain proof'
);
reset role;
select set_config('request.jwt.claims', '', true);

select throws_ok(
  $$
    update public.pages
    set custom_domain_verified = statement_timestamp()
    where id = 'd9000000-0000-0000-0000-000000000001'
  $$,
  '23514', null,
  'trusted verification cannot reactivate a retained domain below Launch'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000023","role":"authenticated"}',
  true
);
select throws_ok(
  $$
    insert into public.pages (
      owner_id, name, slug, custom_domain, domain_path
    ) values (
      'a0000000-0000-0000-0000-000000000023',
      'Free conflicting domain',
      'pgtap-free-conflicting-domain',
      'retained-launch.example.test',
      '/'
    )
  $$,
  '23514', null,
  'Free direct claim is rejected before stale-domain reclaim can run'
);
reset role;
select set_config('request.jwt.claims', '', true);
select ok(
  exists (
    select 1
    from public.pages
    where id = 'd9000000-0000-0000-0000-000000000001'
      and custom_domain = 'retained-launch.example.test'
  ),
  'denied Free claim leaves the competing unverified domain untouched'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000023","role":"authenticated"}',
  true
);
select throws_ok(
  $$
    insert into public.pages (
      owner_id, name, slug, custom_domain, domain_path
    ) values (
      'a0000000-0000-0000-0000-000000000023',
      'Free staged domain',
      'pgtap-free-staged-domain',
      'free-staged.example.test',
      '/offers'
    )
  $$,
  '23514', null,
  'Free owner cannot stage an unverified custom domain or dormant path'
);
reset role;
select set_config('request.jwt.claims', '', true);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000022","role":"authenticated"}',
  true
);
select lives_ok(
  $$
    update public.pages
    set custom_domain = null
    where id = 'd9000000-0000-0000-0000-000000000001'
  $$,
  'Free owner may explicitly disconnect retained domain routing'
);
select ok(
  (
    select custom_domain is null
      and custom_domain_verified is null
      and domain_path = '/'
    from public.pages
    where id = 'd9000000-0000-0000-0000-000000000001'
  ),
  'domain disconnect clears the proof and resets the routing path'
);
select throws_ok(
  $$
    update public.pages
    set custom_domain = 'reactivated.example.test', domain_path = '/pricing'
    where id = 'd9000000-0000-0000-0000-000000000001'
  $$,
  '23514', null,
  'Free owner cannot re-add domain routing after cleanup'
);
reset role;
select set_config('request.jwt.claims', '', true);

insert into public.pages (
  id, owner_id, name, slug, custom_domain, custom_domain_verified, domain_path
) values
  ('d0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002', 'Launch domain root', 'pgtap-launch-domain-root', 'launch.example.test', statement_timestamp(), '/'),
  ('d0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', 'Launch domain path', 'pgtap-launch-domain-path', 'launch.example.test', statement_timestamp(), '/second');
select is(
  (select count(distinct lower(btrim(custom_domain))) from public.pages where owner_id = 'a0000000-0000-0000-0000-000000000002' and custom_domain_verified is not null),
  1::bigint,
  'multiple listing paths share one verified-domain allocation'
);
select throws_ok(
  $$insert into public.pages (owner_id, name, slug, custom_domain, custom_domain_verified, domain_path) values ('a0000000-0000-0000-0000-000000000002', 'Launch second domain', 'pgtap-launch-second-domain', 'second-launch.example.test', statement_timestamp(), '/')$$,
  '23514', null, 'Launch cannot verify a second distinct domain'
);
select throws_ok(
  $$insert into public.pages (owner_id, name, slug, custom_domain, custom_domain_verified, domain_path) values ('a0000000-0000-0000-0000-000000000015', 'Free domain', 'pgtap-free-domain', 'free.example.test', statement_timestamp(), '/')$$,
  '23514', null, 'Free cannot activate a verified custom domain'
);

select throws_ok(
  $$insert into public.team_invites (owner_id, email, role, status) values ('a0000000-0000-0000-0000-000000000002', 'launch-collaborator@example.test', 'editor', 'accepted')$$,
  '23514', null, 'Launch cannot allocate a team seat'
);

insert into public.team_invites (id, owner_id, email, role, status) values
  ('e1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000003', 'pro-one@example.test', 'editor', 'accepted'),
  ('e1000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000003', 'pro-two@example.test', 'viewer', 'accepted'),
  ('e1000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000003', 'pro-three@example.test', 'viewer', 'pending');
select is((select count(*) from public.team_invites where owner_id = 'a0000000-0000-0000-0000-000000000003' and status <> 'revoked'), 3::bigint, 'Pro receives three team seats');

update public.billing_subscriptions
set plan_id = 'launch'
where owner_id = 'a0000000-0000-0000-0000-000000000003';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}',
  true
);
select throws_ok(
  $$
    update public.team_invites
    set role = 'viewer'
    where id = 'e1000000-0000-0000-0000-000000000001'
  $$,
  '23514', null,
  'downgraded owner cannot rewrite a retained collaborator role'
);
select throws_ok(
  $$
    update public.team_invites
    set email = 'forged-collaborator@example.test'
    where id = 'e1000000-0000-0000-0000-000000000002'
  $$,
  '23514', null,
  'downgraded owner cannot rewrite a retained invite identity'
);
select throws_ok(
  $$
    update public.team_invites
    set status = 'accepted'
    where id = 'e1000000-0000-0000-0000-000000000003'
  $$,
  '23514', null,
  'downgraded owner cannot advance a pending invite to accepted'
);
select lives_ok(
  $$
    update public.team_invites
    set status = 'revoked'
    where id = 'e1000000-0000-0000-0000-000000000001'
  $$,
  'downgraded owner may revoke retained collaborator access'
);
select ok(
  (select role = 'editor' and status = 'revoked' from public.team_invites where id = 'e1000000-0000-0000-0000-000000000001')
    and (select email = 'pro-two@example.test' and status = 'accepted' from public.team_invites where id = 'e1000000-0000-0000-0000-000000000002')
    and (select status = 'pending' from public.team_invites where id = 'e1000000-0000-0000-0000-000000000003'),
  'failed mutations preserve retained invite configuration while revocation persists'
);
reset role;
select set_config('request.jwt.claims', '', true);
select throws_ok(
  $$
    update public.team_invites
    set status = 'accepted'
    where id = 'e1000000-0000-0000-0000-000000000003'
  $$,
  '23514', null,
  'trusted accept worker cannot grant retained pending access below Pro'
);
update public.billing_subscriptions
set plan_id = 'pro'
where owner_id = 'a0000000-0000-0000-0000-000000000003';
update public.team_invites
set status = 'accepted'
where id = 'e1000000-0000-0000-0000-000000000001';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}',
  true
);
select throws_ok(
  $$
    update public.team_invites
    set created_at = '2020-01-01T00:00:00Z'::timestamptz
    where id = 'e1000000-0000-0000-0000-000000000003'
  $$,
  '42501', null,
  'team owner cannot backdate an invite to reorder retained seat allocation'
);
reset role;
select set_config('request.jwt.claims', '', true);

select is(
  (
    select id
    from public.team_invites
    where owner_id = 'a0000000-0000-0000-0000-000000000003'
      and status <> 'revoked'
    order by created_at, id
    limit 1
  ),
  'e1000000-0000-0000-0000-000000000001'::uuid,
  'failed invite backdate preserves deterministic oldest-first seat order'
);

insert into public.team_invites (id, owner_id, email, role, status)
values ('e1000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000003', 'pro-revoked@example.test', 'viewer', 'revoked');
select ok(exists (select 1 from public.team_invites where id = 'e1000000-0000-0000-0000-000000000004' and status = 'revoked'), 'revoked rows remain manageable at the seat cap');
select throws_ok(
  $$update public.team_invites set status = 'accepted' where id = 'e1000000-0000-0000-0000-000000000004'$$,
  '23514', null, 'revoked invite cannot bypass the Pro seat cap by reactivation'
);

insert into public.team_invites (id, owner_id, email, role, status)
values ('e2000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000010', 'collaborator@example.test', 'editor', 'accepted');
insert into public.pages (id, owner_id, name, slug)
values ('d0000000-0000-0000-0000-000000000010', 'a0000000-0000-0000-0000-000000000010', 'Collaborated listing', 'pgtap-collaborated-listing');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-000000000001","role":"authenticated","email":"collaborator@example.test"}', true);
select is((select count(*) from public.pages where id = 'd0000000-0000-0000-0000-000000000010'), 1::bigint, 'accepted collaborator can read a Pro owner listing');
reset role;
select set_config('request.jwt.claims', '', true);

update public.billing_subscriptions
set plan_id = 'launch'
where owner_id = 'a0000000-0000-0000-0000-000000000010';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-000000000001","role":"authenticated","email":"collaborator@example.test"}', true);
select is((select count(*) from public.pages where id = 'd0000000-0000-0000-0000-000000000010'), 0::bigint, 'downgrade suspends collaborator RLS access');
reset role;
select set_config('request.jwt.claims', '', true);

update public.billing_subscriptions
set plan_id = 'pro'
where owner_id = 'a0000000-0000-0000-0000-000000000010';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-000000000001","role":"authenticated","email":"collaborator@example.test"}', true);
select is((select count(*) from public.pages where id = 'd0000000-0000-0000-0000-000000000010'), 1::bigint, 'upgrade restores collaborator access without recreating the invite');
reset role;
select set_config('request.jwt.claims', '', true);

-- Simulate time passing without firing the materialization trigger. Dynamic RLS
-- must resolve the finite trial boundary itself instead of trusting a stale
-- suspension ledger until the bounded lifecycle worker catches up.
update public.billing_subscriptions
set status = 'trialing', trial_ends_at = statement_timestamp() + interval '1 day'
where owner_id = 'a0000000-0000-0000-0000-000000000010';
select ok(
  not exists (
    select 1
    from private.team_invite_entitlement_suspensions
    where invite_id = 'e2000000-0000-0000-0000-000000000001'
  ),
  'live Pro trial leaves the collaborator allocation unsuspended'
);

alter table public.billing_subscriptions
  disable trigger trg_growth_and_entitlements_on_billing;
update public.billing_subscriptions
set trial_ends_at = statement_timestamp() - interval '1 second'
where owner_id = 'a0000000-0000-0000-0000-000000000010';
alter table public.billing_subscriptions
  enable trigger trg_growth_and_entitlements_on_billing;

select ok(
  not exists (
    select 1
    from private.team_invite_entitlement_suspensions
    where invite_id = 'e2000000-0000-0000-0000-000000000001'
  ),
  'natural expiry fixture intentionally leaves the materialized ledger stale'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-000000000001","role":"authenticated","email":"collaborator@example.test"}', true);
select is(
  (select count(*) from public.pages where id = 'd0000000-0000-0000-0000-000000000010'),
  0::bigint,
  'dynamic collaborator RLS fails closed immediately at natural trial expiry'
);
reset role;
select set_config('request.jwt.claims', '', true);

update public.billing_subscriptions
set status = 'active', trial_ends_at = null
where owner_id = 'a0000000-0000-0000-0000-000000000010';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-000000000001","role":"authenticated","email":"collaborator@example.test"}', true);
select is(
  (select count(*) from public.pages where id = 'd0000000-0000-0000-0000-000000000010'),
  1::bigint,
  'restored entitlement rematerializes and restores collaborator access'
);
reset role;
select set_config('request.jwt.claims', '', true);

insert into public.pages (id, owner_id, name, slug, is_published) values
  ('d1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000011', 'Scale listing 1', 'pgtap-scale-listing-1', true),
  ('d1000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000011', 'Scale listing 2', 'pgtap-scale-listing-2', true),
  ('d1000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000011', 'Scale listing 3', 'pgtap-scale-listing-3', true),
  ('d1000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000011', 'Scale listing 4', 'pgtap-scale-listing-4', true);
select is((select count(*) from public.pages where owner_id = 'a0000000-0000-0000-0000-000000000011' and is_published), 4::bigint, 'Scale can publish beyond the Launch limit');
update public.billing_subscriptions set plan_id = 'launch' where owner_id = 'a0000000-0000-0000-0000-000000000011';
select is((select count(*) from public.pages where owner_id = 'a0000000-0000-0000-0000-000000000011' and is_published), 3::bigint, 'paid-tier downgrade drafts deterministic listing overflow');
select is((select count(*) from public.pages where owner_id = 'a0000000-0000-0000-0000-000000000011'), 4::bigint, 'listing downgrade preserves every listing row');

insert into public.pages (
  id, owner_id, name, slug, is_published, custom_domain, custom_domain_verified, domain_path
) values
  ('d2000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000012', 'Pro domain 1', 'pgtap-pro-domain-1', true, 'pro-one.example.test', statement_timestamp() - interval '3 minutes', '/'),
  ('d2000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000012', 'Pro domain 2', 'pgtap-pro-domain-2', true, 'pro-two.example.test', statement_timestamp() - interval '2 minutes', '/'),
  ('d2000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000012', 'Pro domain 3', 'pgtap-pro-domain-3', true, 'pro-three.example.test', statement_timestamp() - interval '1 minute', '/');
select is((select count(*) from public.pages_public where id in ('d2000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000002','d2000000-0000-0000-0000-000000000003') and custom_domain_verified is not null), 3::bigint, 'Pro projection exposes every allocated verified domain');
update public.billing_subscriptions set plan_id = 'launch' where owner_id = 'a0000000-0000-0000-0000-000000000012';
select is((select count(*) from public.pages where owner_id = 'a0000000-0000-0000-0000-000000000012' and custom_domain_verified is not null), 3::bigint, 'domain downgrade preserves base configuration and proof');
select is((select count(*) from public.pages_public where id in ('d2000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000002','d2000000-0000-0000-0000-000000000003') and custom_domain_verified is not null), 1::bigint, 'domain downgrade masks projection overflow');
update public.pages
set custom_domain_verified = null
where id = 'd2000000-0000-0000-0000-000000000001';
select ok(
  (select custom_domain_verified is not null from public.pages_public where id = 'd2000000-0000-0000-0000-000000000002'),
  'unverifying the allocated domain immediately restores the oldest retained domain projection'
);
delete from public.pages
where id = 'd2000000-0000-0000-0000-000000000002';
select ok(
  (select custom_domain_verified is not null from public.pages_public where id = 'd2000000-0000-0000-0000-000000000003'),
  'deleting the allocated domain immediately restores the next retained domain projection'
);

-- ---------------------------------------------------------------------------
-- Analytics history cannot bypass the plan through raw RLS or the RPC.
-- ---------------------------------------------------------------------------

insert into public.pages (id, owner_id, name, slug)
values ('d3000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000013', 'Analytics listing', 'pgtap-analytics-listing');

insert into public.checkout_events (
  id, page_id, owner_id, slug, offer_key, offer_name, offer_kind, event_type,
  trust_level, ingestion_source, created_at
) values
  ('e3000000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000013', 'pgtap-analytics-listing', 'services-0', 'Recent', 'services', 'checkout_attempt', 'verified_server', 'pgtap', statement_timestamp() - interval '1 day'),
  ('e3000000-0000-0000-0000-000000000002', 'd3000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000013', 'pgtap-analytics-listing', 'services-0', 'Old', 'services', 'checkout_attempt', 'verified_server', 'pgtap', statement_timestamp() - interval '45 days');

insert into public.agent_visits (
  id, page_id, owner_id, slug, path, is_ai_agent, agent_type,
  trust_level, ingestion_source, created_at
) values
  ('f3000000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000013', 'pgtap-analytics-listing', '/recent', true, 'pgTAP', 'verified_server', 'pgtap', statement_timestamp() - interval '1 day'),
  ('f3000000-0000-0000-0000-000000000002', 'd3000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000013', 'pgtap-analytics-listing', '/old', true, 'pgTAP', 'verified_server', 'pgtap', statement_timestamp() - interval '45 days');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000013","role":"authenticated"}', true);
select is((select count(*) from public.checkout_events), 1::bigint, 'Free raw checkout-event RLS exposes only 30 days');
select is((select count(*) from public.agent_visits), 1::bigint, 'Free raw visit RLS exposes only 30 days');
select is((public.nz_owner_analytics_rollup('2000-01-01') #>> '{counts,events}')::bigint, 1::bigint, 'Free analytics RPC clamps an epoch request');
select is((public.nz_owner_analytics_rollup('2000-01-01') #>> '{counts,visits}')::bigint, 1::bigint, 'Free analytics visit rollup clamps an epoch request');
select is(
  public.nz_owner_analytics_rollup(
    statement_timestamp() - interval '60 days',
    statement_timestamp() - interval '45 days'
  ),
  '{
    "schemaVersion": 1,
    "counts": {
      "events": 0,
      "visits": 0,
      "aiVisits": 0,
      "humanVisits": 0,
      "discoveryClicks": 0,
      "checkoutAttempts": 0,
      "checkoutHandoffs": 0,
      "checkoutStarts": 0,
      "paidOrders": 0,
      "paidDirectOrders": 0,
      "retainedDirectOrders": 0,
      "negotiations": 0,
      "openNegotiations": 0,
      "completedNegotiations": 0
    },
    "trust": {
      "events": {"total": 0, "verified": 0, "legacy": 0, "unverified": 0},
      "visits": {"total": 0, "verified": 0, "legacy": 0, "unverified": 0}
    },
    "daily": [],
    "channels": [],
    "currencies": [],
    "agentTypes": [],
    "topPages": [],
    "topOffers": [],
    "topQueries": [],
    "topReferrers": [],
    "activePageIds": []
  }'::jsonb,
  'Free analytics returns a canonical empty rollup for a valid entirely pre-cutoff range'
);
select throws_ok(
  $$select public.nz_owner_analytics_rollup(statement_timestamp() - interval '45 days', statement_timestamp() - interval '60 days')$$,
  '22023', null, 'invalid original analytics range still fails before plan clamping'
);
reset role;
select set_config('request.jwt.claims', '', true);

update public.billing_subscriptions set plan_id = 'pro' where owner_id = 'a0000000-0000-0000-0000-000000000013';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000013","role":"authenticated"}', true);
select is((select count(*) from public.checkout_events), 2::bigint, 'Pro raw checkout-event RLS exposes full history');
select is((select count(*) from public.agent_visits), 2::bigint, 'Pro raw visit RLS exposes full history');
select is((public.nz_owner_analytics_rollup('2000-01-01') #>> '{counts,events}')::bigint, 2::bigint, 'Pro analytics RPC exposes full event history');
select is((public.nz_owner_analytics_rollup('2000-01-01') #>> '{counts,visits}')::bigint, 2::bigint, 'Pro analytics RPC exposes full visit history');
reset role;
select set_config('request.jwt.claims', '', true);

-- A future-start grant dynamically confers at its start boundary, but time does
-- not fire its row trigger. Build a suspended fourth storefront, then move the
-- grant across that boundary without firing materialization so the lifecycle
-- worker must claim and reconcile it.
update public.billing_subscriptions
set plan_id = 'scale'
where owner_id = 'a0000000-0000-0000-0000-000000000016';

insert into public.storefronts (id, owner_id, handle, created_at)
values (
  'f1000000-0000-0000-0000-000000000005',
  'a0000000-0000-0000-0000-000000000016',
  'pgtap-future-activation-store',
  statement_timestamp()
);

update public.billing_subscriptions
set plan_id = 'pro'
where owner_id = 'a0000000-0000-0000-0000-000000000016';

insert into public.seller_growth_campaigns (
  id,
  campaign_key,
  name,
  status,
  grant_plan_id,
  starts_at
)
values (
  'c0000000-0000-0000-0000-000000000005',
  'pgtap-future-activation',
  'pgTAP future activation',
  'ended',
  'scale',
  statement_timestamp() - interval '1 day'
);

insert into public.promotional_plan_grants (
  id,
  owner_id,
  campaign_id,
  plan_id,
  source,
  status,
  starts_at,
  ends_at
)
values (
  'c1000000-0000-0000-0000-000000000004',
  'a0000000-0000-0000-0000-000000000016',
  'c0000000-0000-0000-0000-000000000005',
  'scale',
  'admin',
  'active',
  statement_timestamp() + interval '1 day',
  statement_timestamp() + interval '10 days'
);

select ok(
  (
    select entitlement_activated_at is null
    from public.promotional_plan_grants
    where id = 'c1000000-0000-0000-0000-000000000004'
  ),
  'future-start grant remains unclaimed before its activation boundary'
);

select ok(
  (
    select plan_suspended_at is not null
    from public.storefronts
    where id = 'f1000000-0000-0000-0000-000000000005'
  ),
  'future grant does not prematurely restore a Pro-overflow storefront'
);

alter table public.promotional_plan_grants
  disable trigger trg_01_stamp_plan_grant_activation;
alter table public.promotional_plan_grants
  disable trigger trg_growth_entitlements_on_grant;
update public.promotional_plan_grants
set starts_at = statement_timestamp() - interval '1 second'
where id = 'c1000000-0000-0000-0000-000000000004';
alter table public.promotional_plan_grants
  enable trigger trg_growth_entitlements_on_grant;
alter table public.promotional_plan_grants
  enable trigger trg_01_stamp_plan_grant_activation;

-- The shared batch size is a global cardinality bound. Expiry has the older
-- effective boundary and consumes the first one-row batch; activation remains
-- queued for the next bounded call.
select is(
  private.nz_reconcile_time_bound_plan_entitlements(1),
  '{
    "trialsExpired": 0,
    "grantsExpired": 1,
    "grantsActivated": 0,
    "rowsProcessed": 1
  }'::jsonb,
  'one-row lifecycle batch expires exactly one grant and cannot overrun into activation'
);
select ok(
  (
    select entitlement_activated_at is null
    from public.promotional_plan_grants
    where id = 'c1000000-0000-0000-0000-000000000004'
  ),
  'future-start activation remains queued after the expiry batch exhausts its budget'
);
select is(
  (select status from public.promotional_plan_grants where id = 'c1000000-0000-0000-0000-000000000003'),
  'expired',
  'ended promotion is durably stamped expired'
);
select is(
  (select count(*) from public.seller_growth_events where grant_id = 'c1000000-0000-0000-0000-000000000003' and event_type = 'grant_expired'),
  1::bigint,
  'database expiry writes one grant-expired audit event'
);

select is(
  private.nz_reconcile_time_bound_plan_entitlements(1),
  '{
    "trialsExpired": 0,
    "grantsExpired": 0,
    "grantsActivated": 1,
    "rowsProcessed": 1
  }'::jsonb,
  'next one-row lifecycle batch claims exactly one newly live grant'
);
select ok(
  (
    select entitlement_activated_at is not null
      and entitlement_activated_at >= starts_at
      and entitlement_activated_at < ends_at
    from public.promotional_plan_grants
    where id = 'c1000000-0000-0000-0000-000000000004'
  ),
  'activation worker writes a finite marker inside the grant window'
);
select ok(
  (
    select plan_suspended_at is null
    from public.storefronts
    where id = 'f1000000-0000-0000-0000-000000000005'
  ),
  'future grant activation reconciles and restores the newly eligible storefront'
);

select * from finish();
rollback;

-- Separate organization scan entitlements share this required CI entry point.
\ir organization_workspace_foundation.sql
\ir organization_scan_execution.sql
\ir organization_scan_operations.sql
\ir merchant_report_inputs.sql
\ir merchant_website_baselines.sql

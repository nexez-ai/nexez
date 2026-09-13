-- Live-schema seller activation certification.
--
-- This script intentionally runs every fixture in one transaction and rolls it
-- back. It sends no email, calls no external service, creates no Stripe object,
-- and leaves no seller, page, grant, invitation, or audit row behind.

begin;
set local statement_timeout = '30s';
set local lock_timeout = '5s';

create temporary table growth_gauntlet_results (
  sequence bigint generated always as identity,
  scenario text not null,
  passed boolean not null,
  detail text not null
) on commit drop;

do $gauntlet$
declare
  v_suffix text := replace(gen_random_uuid()::text, '-', '');
  v_campaign uuid := gen_random_uuid();
  v_canary_campaign uuid := gen_random_uuid();
  v_canary_owner_1 uuid := gen_random_uuid();
  v_canary_owner_2 uuid := gen_random_uuid();
  v_canary_fingerprint text;
  v_owner uuid := gen_random_uuid();
  v_duplicate uuid := gen_random_uuid();
  v_paid uuid := gen_random_uuid();
  v_referral uuid := gen_random_uuid();
  v_paused uuid := gen_random_uuid();
  v_overcap uuid := gen_random_uuid();
  v_ended uuid := gen_random_uuid();
  v_owner_email text;
  v_duplicate_email text;
  v_paid_email text;
  v_referral_email text;
  v_paused_email text;
  v_overcap_email text;
  v_ended_email text;
  v_shared_website text;
  v_owner_page_1 uuid := gen_random_uuid();
  v_owner_page_2 uuid := gen_random_uuid();
  v_owner_page_3 uuid := gen_random_uuid();
  v_invite uuid := gen_random_uuid();
  v_wrong_invite uuid := gen_random_uuid();
  v_owner_grant uuid;
  v_metrics jsonb;
  v_count integer;
  v_guarded boolean;
  v_reason_bound boolean := false;
  v_target_bound boolean := false;
begin
  -- A clean replay seeds the live launch campaign. Isolate this certification
  -- from that production fixture so the campaign under test is the only active
  -- issuance target; the enclosing transaction restores every prior row.
  update public.seller_growth_campaigns
  set status = 'ended'
  where status = 'active';

  v_owner_email := 'growth-owner-' || v_suffix || '@example.test';
  v_duplicate_email := 'growth-duplicate-' || v_suffix || '@example.test';
  v_paid_email := 'growth-paid-' || v_suffix || '@example.test';
  v_referral_email := 'growth-referral-' || v_suffix || '@example.test';
  v_paused_email := 'growth-paused-' || v_suffix || '@example.test';
  v_overcap_email := 'growth-overcap-' || v_suffix || '@example.test';
  v_ended_email := 'growth-ended-' || v_suffix || '@example.test';
  v_shared_website := 'https://growth-' || v_suffix || '.example.test';

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
    starts_at,
    is_public_launch
  )
  values (
    v_campaign,
    'gauntlet-' || v_suffix,
    'Growth activation gauntlet',
    'active',
    'launch',
    180,
    2,
    14,
    3,
    now() - interval '10 minutes',
    true
  );

  -- Reproduce the production regression: a newer active internal campaign is
  -- full, while the explicitly public Launch campaign still has capacity.
  -- Omitting is_public_launch must fail closed even with enrollment_mode=open.
  insert into public.seller_growth_campaigns (
    id, campaign_key, name, status, grant_plan_id, grant_duration_days,
    invite_slots, max_grants, starts_at
  ) values (
    v_canary_campaign, 'canary-' || v_suffix, 'Internal certification',
    'active', 'pro', 365, 0, 2, now() - interval '5 minutes'
  );
  insert into auth.users (id) values (v_canary_owner_1), (v_canary_owner_2);
  insert into public.promotional_plan_grants (
    owner_id, campaign_id, plan_id, source, starts_at, ends_at
  ) values
    (v_canary_owner_1, v_canary_campaign, 'pro', 'admin', now(), now() + interval '365 days'),
    (v_canary_owner_2, v_canary_campaign, 'pro', 'admin', now(), now() + interval '365 days');
  select md5(jsonb_agg(to_jsonb(g) order by g.id)::text)
  into v_canary_fingerprint
  from public.promotional_plan_grants g where g.campaign_id = v_canary_campaign;

  insert into growth_gauntlet_results (scenario, passed, detail)
  select 'new campaigns default to internal-only', not is_public_launch,
    'An active open-enrollment canary must not become public by default.'
  from public.seller_growth_campaigns where id = v_canary_campaign;

  v_guarded := false;
  begin
    update public.seller_growth_campaigns
    set is_public_launch = true where id = v_canary_campaign;
  exception when check_violation then
    v_guarded := true;
  end;
  insert into growth_gauntlet_results (scenario, passed, detail)
  values ('public Launch scope rejects a non-Launch plan', v_guarded,
    'A Pro certification campaign cannot be misclassified as public Launch.');

  insert into growth_gauntlet_results (scenario, passed, detail)
  values ('public campaign designation remains service-only',
    not has_column_privilege('anon', 'public.seller_growth_campaigns', 'is_public_launch', 'UPDATE')
      and not has_column_privilege('authenticated', 'public.seller_growth_campaigns', 'is_public_launch', 'UPDATE'),
    'The new flag does not widen browser-role access to campaign controls.');

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
  )
  values
    ('00000000-0000-0000-0000-000000000000', v_owner, 'authenticated', 'authenticated', v_owner_email, '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_duplicate, 'authenticated', 'authenticated', v_duplicate_email, '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_paid, 'authenticated', 'authenticated', v_paid_email, '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_referral, 'authenticated', 'authenticated', v_referral_email, '', now(), '{"provider":"email","providers":["email"]}', '{}', now() - interval '1 day', now()),
    ('00000000-0000-0000-0000-000000000000', v_paused, 'authenticated', 'authenticated', v_paused_email, '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_overcap, 'authenticated', 'authenticated', v_overcap_email, '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_ended, 'authenticated', 'authenticated', v_ended_email, '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

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
    v_owner_page_1,
    v_owner,
    'Gauntlet owner',
    'growth-owner-' || v_suffix,
    true,
    v_shared_website,
    now()
  );

  select g.id
  into v_owner_grant
  from public.promotional_plan_grants g
  where g.owner_id = v_owner
    and g.campaign_id = v_campaign
    and g.source = 'welcome'
    and g.status = 'active'
    and g.ends_at between now() + interval '179 days' and now() + interval '181 days';

  insert into growth_gauntlet_results (scenario, passed, detail)
  values (
    'verified new seller receives Launch despite newer exhausted canary',
    v_owner_grant is not null and public.owner_plan_rank(v_owner) = 1,
    'Expected one 180-day welcome grant and Launch rank.'
  );

  -- Give the internal campaign spare capacity for the remaining referral,
  -- cohort, paused, exhausted and ended scenarios. It must never be a fallback.
  update public.seller_growth_campaigns
  set max_grants = 100 where id = v_canary_campaign;

  insert into public.pages (id, owner_id, name, slug, is_published)
  values
    (v_owner_page_2, v_owner, 'Gauntlet owner second', 'growth-owner-second-' || v_suffix, true),
    (v_owner_page_3, v_owner, 'Gauntlet owner third', 'growth-owner-third-' || v_suffix, true);

  insert into public.pages (
    owner_id,
    name,
    slug,
    is_published,
    website_url,
    website_verified_at
  )
  values (
    v_duplicate,
    'Duplicate business',
    'growth-duplicate-' || v_suffix,
    true,
    v_shared_website,
    now()
  );

  insert into growth_gauntlet_results (scenario, passed, detail)
  select
    'verified business identity cannot claim twice',
    not exists (
      select 1
      from public.promotional_plan_grants
      where owner_id = v_duplicate
        and campaign_id = v_campaign
    ),
    'A second account using the same verified website must stay on Free.';

  insert into public.billing_subscriptions (owner_id, plan_id, status, account_origin)
  values (v_paid, 'launch', 'active', 'growth_gauntlet')
  on conflict (owner_id) do update
  set plan_id = excluded.plan_id,
      status = excluded.status,
      account_origin = excluded.account_origin;

  insert into public.pages (
    owner_id,
    name,
    slug,
    is_published,
    website_url,
    website_verified_at
  )
  values (
    v_paid,
    'Paid business',
    'growth-paid-' || v_suffix,
    true,
    'https://growth-paid-' || v_suffix || '.example.test',
    now()
  );

  insert into growth_gauntlet_results (scenario, passed, detail)
  select
    'paid plan remains authoritative',
    public.owner_plan_rank(v_paid) = 1
      and not exists (
        select 1
        from public.promotional_plan_grants
        where owner_id = v_paid
          and campaign_id = v_campaign
      ),
    'An active paid subscription must not receive a promotional grant.';

  insert into public.seller_growth_invites (
    id,
    campaign_id,
    inviter_owner_id,
    inviter_business_name,
    invitee_email,
    token_hash,
    status,
    expires_at
  )
  values (
    v_invite,
    v_campaign,
    v_owner,
    'Gauntlet owner',
    v_referral_email,
    md5('referral-' || v_suffix) || md5('referral-2-' || v_suffix),
    'pending',
    now() + interval '14 days'
  );

  update public.seller_growth_invites
  set status = 'claimed',
      accepted_by_owner_id = v_referral,
      accepted_at = now()
  where id = v_invite;

  insert into public.pages (
    owner_id,
    name,
    slug,
    is_published,
    website_url,
    website_verified_at
  )
  values (
    v_referral,
    'Referral business',
    'growth-referral-' || v_suffix,
    true,
    'https://growth-referral-' || v_suffix || '.example.test',
    now()
  );

  insert into growth_gauntlet_results (scenario, passed, detail)
  select
    'email-bound referral activates after business verification',
    exists (
      select 1
      from public.promotional_plan_grants
      where owner_id = v_referral
        and campaign_id = v_campaign
        and source = 'referral'
        and source_invite_id = v_invite
    )
      and exists (
        select 1
        from public.seller_growth_invites
        where id = v_invite
          and status = 'qualified'
          and accepted_by_owner_id = v_referral
      ),
    'An older account should qualify only through its exact invitation and verified business.'
  ;

  v_guarded := false;
  begin
    insert into public.seller_growth_invites (
      campaign_id,
      inviter_owner_id,
      inviter_business_name,
      invitee_email,
      token_hash,
      status,
      expires_at
    )
    values (
      v_campaign,
      v_owner,
      'Gauntlet owner',
      v_owner_email,
      md5('self-' || v_suffix) || md5('self-2-' || v_suffix),
      'pending',
      now() + interval '14 days'
    );
  exception when check_violation then
    v_guarded := true;
  end;
  insert into growth_gauntlet_results (scenario, passed, detail)
  values (
    'self-invitation is rejected',
    v_guarded,
    'The sender email cannot consume a referral pass.'
  );

  insert into public.seller_growth_invites (
    id,
    campaign_id,
    inviter_owner_id,
    inviter_business_name,
    invitee_email,
    token_hash,
    status,
    expires_at
  )
  values (
    v_wrong_invite,
    v_campaign,
    v_owner,
    'Gauntlet owner',
    'growth-wrong-' || v_suffix || '@example.test',
    md5('wrong-' || v_suffix) || md5('wrong-2-' || v_suffix),
    'pending',
    now() + interval '14 days'
  );

  v_guarded := false;
  begin
    update public.seller_growth_invites
    set status = 'claimed',
        accepted_by_owner_id = v_duplicate,
        accepted_at = now()
    where id = v_wrong_invite;
  exception when check_violation then
    v_guarded := true;
  end;
  insert into growth_gauntlet_results (scenario, passed, detail)
  values (
    'wrong-email claim is rejected',
    v_guarded,
    'Claiming requires the exact verified invitation email.'
  );

  v_guarded := false;
  begin
    insert into public.seller_growth_invites (
      campaign_id,
      inviter_owner_id,
      inviter_business_name,
      invitee_email,
      token_hash,
      status,
      expires_at
    )
    values (
      v_campaign,
      v_owner,
      'Gauntlet owner',
      'growth-third-' || v_suffix || '@example.test',
      md5('third-' || v_suffix) || md5('third-2-' || v_suffix),
      'pending',
      now() + interval '14 days'
    );
  exception when check_violation then
    v_guarded := true;
  end;
  insert into growth_gauntlet_results (scenario, passed, detail)
  values (
    'two-pass concurrency cap is enforced',
    v_guarded,
    'One qualified and one pending pass must block a third active pass.'
  );

  perform public.apply_seller_growth_campaign_control(
    v_campaign,
    v_owner,
    'pause',
    'Gauntlet pause proof',
    'pause-' || v_suffix
  );
  perform public.apply_seller_growth_campaign_control(
    v_campaign,
    v_owner,
    'pause',
    'Gauntlet pause proof',
    'pause-' || v_suffix
  );

  begin
    perform public.apply_seller_growth_campaign_control(
      v_campaign,
      v_owner,
      'pause',
      'A different replay reason',
      'pause-' || v_suffix
    );
  exception when unique_violation then
    v_reason_bound := true;
  end;

  insert into public.pages (
    owner_id,
    name,
    slug,
    is_published,
    website_url,
    website_verified_at
  )
  values (
    v_paused,
    'Paused business',
    'growth-paused-' || v_suffix,
    true,
    'https://growth-paused-' || v_suffix || '.example.test',
    now()
  );

  select count(*)
  into v_count
  from public.seller_growth_campaign_admin_events
  where campaign_id = v_campaign
    and action = 'pause';

  insert into growth_gauntlet_results (scenario, passed, detail)
  select
    'pause is immediate and idempotent',
    v_count = 1
      and not exists (
        select 1
        from public.promotional_plan_grants
        where owner_id = v_paused
          and campaign_id = v_campaign
      ),
    'A replay must create one audit row, and publishing while paused must not activate Launch.';

  perform public.apply_seller_growth_campaign_control(
    v_campaign,
    v_owner,
    'resume',
    'Gauntlet resume proof',
    'resume-' || v_suffix
  );
  perform public.refresh_seller_growth_grant(v_paused);

  insert into growth_gauntlet_results (scenario, passed, detail)
  select
    'resume restores activation',
    exists (
      select 1
      from public.promotional_plan_grants
      where owner_id = v_paused
        and campaign_id = v_campaign
        and status = 'active'
    ),
    'An already-qualified seller can activate after operations resume the campaign.';

  insert into public.pages (
    owner_id,
    name,
    slug,
    is_published,
    website_url,
    website_verified_at
  )
  values (
    v_overcap,
    'Capacity business',
    'growth-capacity-' || v_suffix,
    true,
    'https://growth-capacity-' || v_suffix || '.example.test',
    now()
  );

  insert into growth_gauntlet_results (scenario, passed, detail)
  select
    'campaign issuance stops at capacity',
    not exists (
      select 1
      from public.promotional_plan_grants
      where owner_id = v_overcap
        and campaign_id = v_campaign
    ),
    'The fourth qualified seller must stay on Free while capacity is three.';

  v_guarded := false;
  begin
    perform public.apply_seller_growth_campaign_control(
      v_campaign,
      v_owner,
      'set_capacity',
      'Gauntlet below-issued proof',
      'capacity-low-' || v_suffix,
      2
    );
  exception when check_violation then
    v_guarded := true;
  end;

  perform public.apply_seller_growth_campaign_control(
    v_campaign,
    v_owner,
    'set_capacity',
    'Gauntlet controlled expansion',
    'capacity-up-' || v_suffix,
    4
  );

  begin
    perform public.apply_seller_growth_campaign_control(
      v_campaign,
      v_owner,
      'set_capacity',
      'Gauntlet controlled expansion',
      'capacity-up-' || v_suffix,
      5
    );
  exception when unique_violation then
    v_target_bound := true;
  end;

  perform public.refresh_seller_growth_grant(v_overcap);

  insert into growth_gauntlet_results (scenario, passed, detail)
  select
    'capacity cannot shrink below issuance and expands deliberately',
    v_guarded
      and exists (
        select 1
        from public.promotional_plan_grants
        where owner_id = v_overcap
          and campaign_id = v_campaign
          and status = 'active'
      ),
    'Unsafe shrink must fail; audited expansion should permit exactly the next qualified seller.';

  insert into growth_gauntlet_results (scenario, passed, detail)
  values (
    'idempotency keys bind the exact request',
    v_reason_bound and v_target_bound,
    'A reused key with a different reason or target value must fail closed.'
  );

  insert into public.billing_subscriptions (owner_id, plan_id, status, account_origin)
  values (v_paused, 'pro', 'active', 'growth_gauntlet')
  on conflict (owner_id) do update
  set plan_id = excluded.plan_id,
      status = excluded.status,
      account_origin = excluded.account_origin;

  update public.promotional_plan_grants
  set fallback_page_id = v_owner_page_2
  where id = v_owner_grant;

  update public.promotional_plan_grants
  set status = 'expired'
  where id = v_owner_grant;

  insert into growth_gauntlet_results (scenario, passed, detail)
  select
    'expired promotion preserves one selected Free listing',
    (
      select count(*)
      from public.pages
      where owner_id = v_owner
        and is_published is true
    ) = 1
      and (
        select is_published
        from public.pages
        where id = v_owner_page_2
      ) is true
      and public.owner_plan_rank(v_owner) = 0,
    'The selected fallback remains public while excess listings become drafts.'
  ;

  v_metrics := public.seller_growth_control_snapshot(v_campaign);
  insert into growth_gauntlet_results (scenario, passed, detail)
  values (
    'Growth Control snapshot reconciles ledgers',
    (v_metrics ->> 'grants_total')::integer = 4
      and (v_metrics ->> 'grants_active')::integer = 3
      and (v_metrics ->> 'welcome_grants')::integer = 3
      and (v_metrics ->> 'referral_grants')::integer = 1
      and (v_metrics ->> 'paid_conversions')::integer = 1
      and (v_metrics ->> 'invites_total')::integer = 2
      and (v_metrics ->> 'invites_qualified')::integer = 1,
    'Aggregate totals must match the synthetic welcome, referral, paid, invite, and expiry lifecycle.'
  );

  perform public.apply_seller_growth_campaign_control(
    v_campaign,
    v_owner,
    'end',
    'Gauntlet terminal-state proof',
    'end-' || v_suffix
  );

  v_guarded := false;
  begin
    perform public.apply_seller_growth_campaign_control(
      v_campaign,
      v_owner,
      'set_capacity',
      'Gauntlet ended immutability proof',
      'ended-change-' || v_suffix,
      5
    );
  exception when check_violation then
    v_guarded := true;
  end;

  insert into public.pages (
    owner_id,
    name,
    slug,
    is_published,
    website_url,
    website_verified_at
  )
  values (
    v_ended,
    'Ended business',
    'growth-ended-' || v_suffix,
    true,
    'https://growth-ended-' || v_suffix || '.example.test',
    now()
  );

  insert into growth_gauntlet_results (scenario, passed, detail)
  select
    'ended campaign is terminal',
    v_guarded
      and (
        select status = 'ended'
        from public.seller_growth_campaigns
        where id = v_campaign
      )
      and not exists (
        select 1
        from public.promotional_plan_grants
        where owner_id = v_ended
          and campaign_id = v_campaign
      ),
    'Ended campaigns reject further controls and new activations while existing grants remain fixed.';

  insert into growth_gauntlet_results (scenario, passed, detail)
  select 'internal grants and principals are preserved',
    count(*) = 2
      and md5(jsonb_agg(to_jsonb(g) order by g.id)::text) = v_canary_fingerprint
      and public.owner_plan_rank(v_canary_owner_1) = 2
      and public.owner_plan_rank(v_canary_owner_2) = 2,
    'Internal campaign never issues to public sellers; its existing Pro grants remain unchanged.'
  from public.promotional_plan_grants g where g.campaign_id = v_canary_campaign;
end
$gauntlet$;

select scenario, passed, detail
from growth_gauntlet_results
order by sequence;

do $assertions$
begin
  if exists (
    select 1
    from growth_gauntlet_results
    where passed is not true
  ) then
    raise exception 'seller-growth gauntlet failed';
  end if;
end
$assertions$;

rollback;

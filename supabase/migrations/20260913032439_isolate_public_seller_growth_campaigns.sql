-- Public acquisition must not select internal/certification campaigns merely
-- because they have a newer start date. New campaigns fail closed until an
-- operator explicitly designates them for public Launch acquisition.
alter table public.seller_growth_campaigns
  add column is_public_launch boolean not null default false;

alter table public.seller_growth_campaigns
  add constraint seller_growth_campaigns_public_launch_plan_check
  check (not is_public_launch or grant_plan_id = 'launch');

comment on column public.seller_growth_campaigns.is_public_launch is
  'Explicit public Launch acquisition scope. False for internal/certification campaigns; does not affect existing promotional grants.';

-- Scope changes participate in the same campaign lock ordering as status and
-- window changes. The locked issuance read below revalidates this flag.
drop trigger if exists trg_00_lock_growth_campaign_write
  on public.seller_growth_campaigns;
create trigger trg_00_lock_growth_campaign_write
  before insert or delete or update of status, starts_at, signup_closes_at, is_public_launch
  on public.seller_growth_campaigns
  for each row execute function private.nz_lock_growth_campaign_write();

-- Stable business key, not an environment-specific generated ID. Preserve
-- campaign status, dates, capacity, and all existing grant/identity rows.
update public.seller_growth_campaigns
set is_public_launch = true
where campaign_key = 'launch-six-month-2026'
  and grant_plan_id = 'launch';

-- Keep the established lock order, statement-time boundaries, identity gates,
-- invitation eligibility, capacity checks, and function privileges unchanged.
-- Apply the scope predicate both before and after acquiring the campaign lock.

create or replace function private.nz_maybe_issue_seller_growth_grant(p_owner uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth
as $$
declare
  v_campaign_id uuid;
  v_campaign public.seller_growth_campaigns%rowtype;
  v_invite public.seller_growth_invites%rowtype;
  v_user_created_at timestamptz;
  v_email_confirmed_at timestamptz;
  v_identity_keys text[];
  v_grant_id uuid;
  v_grant_count integer;
  v_is_new_account boolean;
  v_grant_source text;
  v_now timestamptz := statement_timestamp();
begin
  if p_owner is null then
    return null;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('nexez:quota:listings:' || p_owner::text, 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended('nexez:quota:domains:' || p_owner::text, 0)
  );

  select u.created_at, u.email_confirmed_at
  into v_user_created_at, v_email_confirmed_at
  from auth.users u
  where u.id = p_owner;

  if v_email_confirmed_at is null then
    return null;
  end if;

  if not exists (
    select 1
    from public.pages p
    where p.owner_id = p_owner
      and p.is_published is true
  ) then
    return null;
  end if;

  -- Discover without a row lock, acquire the ordered advisory campaign lock,
  -- then revalidate under the row lock. If operations changed the winning
  -- campaign in between, fail closed and let the next qualifying write retry.
  select c.id
  into v_campaign_id
  from public.seller_growth_campaigns c
  where c.is_public_launch is true
    and c.status = 'active'
    and pg_catalog.isfinite(c.starts_at)
    and c.starts_at <= v_now
    and (
      c.signup_closes_at is null
      or (
        pg_catalog.isfinite(c.signup_closes_at)
        and c.signup_closes_at >= v_now
      )
    )
  order by c.starts_at desc, c.id
  limit 1;

  if v_campaign_id is null then
    return null;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('nexez:growth:campaign:' || v_campaign_id::text, 0)
  );

  select c.*
  into v_campaign
  from public.seller_growth_campaigns c
  where c.id = v_campaign_id
    and c.is_public_launch is true
    and c.status = 'active'
    and pg_catalog.isfinite(c.starts_at)
    and c.starts_at <= v_now
    and (
      c.signup_closes_at is null
      or (
        pg_catalog.isfinite(c.signup_closes_at)
        and c.signup_closes_at >= v_now
      )
    )
  for update;

  if v_campaign.id is null then
    return null;
  end if;

  select i.*
  into v_invite
  from public.seller_growth_invites i
  where i.campaign_id = v_campaign.id
    and i.accepted_by_owner_id = p_owner
    and i.status = 'claimed'
  order by i.accepted_at desc nulls last
  limit 1;

  v_is_new_account :=
    v_user_created_at >= v_campaign.starts_at
    and (
      v_campaign.signup_closes_at is null
      or v_user_created_at <= v_campaign.signup_closes_at
    );

  if v_invite.id is null and (
    v_campaign.enrollment_mode = 'invite_only'
    or not v_is_new_account
  ) then
    return null;
  end if;

  -- A currently paid/trialing plan is already better served by Stripe billing.
  -- Malformed legacy trials never confer and are repaired by the worker below.
  if exists (
    select 1
    from public.billing_subscriptions s
    where s.owner_id = p_owner
      and private.nz_plan_rank(s.plan_id) >= 1
      and (
        s.status in ('active', 'past_due', 'unpaid')
        or (
          s.status = 'trialing'
          and s.trial_ends_at is not null
          and pg_catalog.isfinite(s.trial_ends_at)
          and s.trial_ends_at > v_now
        )
      )
  ) then
    return null;
  end if;

  select g.id into v_grant_id
  from public.promotional_plan_grants g
  where g.owner_id = p_owner
    and g.campaign_id = v_campaign.id;

  if v_grant_id is not null then
    if v_invite.id is not null then
      update public.seller_growth_invites
      set
        status = 'qualified',
        qualified_at = coalesce(qualified_at, v_now),
        invitee_grant_id = v_grant_id
      where id = v_invite.id
        and status = 'claimed';
    end if;
    return v_grant_id;
  end if;

  v_identity_keys := private.nz_seller_growth_identity_keys(p_owner);
  if coalesce(cardinality(v_identity_keys), 0) = 0 then
    return null;
  end if;

  select count(*) into v_grant_count
  from public.promotional_plan_grants g
  where g.campaign_id = v_campaign.id;

  if v_grant_count >= v_campaign.max_grants then
    return null;
  end if;

  if exists (
    select 1
    from public.seller_growth_business_claims c
    where c.campaign_id = v_campaign.id
      and c.identity_key = any(v_identity_keys)
  ) then
    return null;
  end if;

  v_grant_source := case
    when v_invite.id is null or v_invite.invite_kind = 'cohort' then 'welcome'
    else 'referral'
  end;

  insert into public.promotional_plan_grants (
    owner_id,
    campaign_id,
    plan_id,
    source,
    source_invite_id,
    starts_at,
    ends_at,
    metadata
  )
  values (
    p_owner,
    v_campaign.id,
    v_campaign.grant_plan_id,
    v_grant_source,
    v_invite.id,
    v_now,
    v_now + make_interval(days => v_campaign.grant_duration_days),
    jsonb_build_object(
      'campaign_key', v_campaign.campaign_key,
      'invite_kind', case when v_invite.id is null then null else v_invite.invite_kind end
    )
  )
  returning id into v_grant_id;

  insert into public.seller_growth_business_claims (
    campaign_id,
    grant_id,
    identity_key
  )
  select v_campaign.id, v_grant_id, identity.identity_key
  from unnest(v_identity_keys) as identity(identity_key);

  insert into public.seller_growth_events (
    campaign_id,
    owner_id,
    invite_id,
    grant_id,
    event_type,
    metadata
  )
  values (
    v_campaign.id,
    p_owner,
    v_invite.id,
    v_grant_id,
    'grant_issued',
    jsonb_build_object(
      'plan_id', v_campaign.grant_plan_id,
      'duration_days', v_campaign.grant_duration_days,
      'source', v_grant_source,
      'invite_kind', case when v_invite.id is null then null else v_invite.invite_kind end
    )
  );

  if v_invite.id is not null then
    update public.seller_growth_invites
    set
      status = 'qualified',
      qualified_at = v_now,
      invitee_grant_id = v_grant_id
    where id = v_invite.id
      and status = 'claimed';

    insert into public.seller_growth_events (
      campaign_id,
      owner_id,
      invite_id,
      grant_id,
      event_type,
      metadata
    )
    values (
      v_campaign.id,
      p_owner,
      v_invite.id,
      v_grant_id,
      'invite_qualified',
      jsonb_build_object('invite_kind', v_invite.invite_kind)
    );
  end if;

  return v_grant_id;
exception
  when unique_violation then
    return null;
end;
$$;

revoke all on function private.nz_maybe_issue_seller_growth_grant(uuid)
  from public, anon, authenticated, service_role;

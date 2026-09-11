-- Owner-only report inputs. No pilot or collection coverage is enabled here.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table private.merchant_report_access (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  expires_at timestamptz not null check (isfinite(expires_at))
);
alter table private.merchant_report_access enable row level security;

-- A reviewed collection interval, never inferred from the presence of events.
-- Only an operator with database privileges may attest or withdraw coverage.
-- This is collection evidence, not a website snapshot or agency consent grant.
create table private.merchant_report_coverage (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  listing_id uuid references public.pages(id) on delete cascade,
  metric text not null check (metric in ('traffic', 'orders')),
  period_start date not null check (isfinite(period_start) and extract(day from period_start) = 1),
  covered_from timestamptz not null,
  covered_to_exclusive timestamptz not null,
  attested_at timestamptz not null default statement_timestamp(),
  evidence_sha256 text not null check (evidence_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  check ((metric = 'traffic' and listing_id is not null) or (metric = 'orders' and listing_id is null)),
  check (isfinite(covered_from) and isfinite(covered_to_exclusive) and isfinite(attested_at)),
  check (covered_from >= (period_start::timestamp at time zone 'UTC')
    and covered_to_exclusive <= ((period_start + interval '1 month') at time zone 'UTC')
    and covered_from < covered_to_exclusive and covered_to_exclusive <= attested_at),
  unique nulls not distinct (owner_id, metric, listing_id, period_start)
);
alter table private.merchant_report_coverage enable row level security;
create index merchant_report_coverage_listing_idx on private.merchant_report_coverage (listing_id) where listing_id is not null;

revoke all on private.merchant_report_access, private.merchant_report_coverage
  from public, anon, authenticated, service_role;

-- Both ownership and the time window participate in the visit lookup, including
-- after a page transfer. Orders already have checkout_orders_owner_created_idx.
create index agent_visits_owner_page_created_idx
  on public.agent_visits (owner_id, page_id, created_at);

create function private.read_merchant_report_inputs(p_listing_id uuid, p_month date)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_observed timestamptz := statement_timestamp();
  v_current_month date := date_trunc('month', statement_timestamp() at time zone 'UTC')::date;
  v_page record;
  v_coverage private.merchant_report_coverage%rowtype;
  v_counts jsonb;
  v_total bigint;
  v_traffic jsonb := '{"state":"no_coverage"}';
  v_orders jsonb := '{"state":"no_coverage"}';
  v_listing jsonb;
  v_metric text;
begin
  -- Check the actual user row and current owner in this statement's snapshot.
  -- Organization membership and page collaboration do not authorize this read.
  if v_owner is null or not exists (
    select 1 from auth.users u where u.id = v_owner
      and u.is_anonymous is not true and u.deleted_at is null
      and (u.banned_until is null or u.banned_until <= v_observed)
  ) then return null; end if;
  select p.name, p.slug, p.description, p.is_published, p.website_url, p.cta_url,
    p.audience, p.industry, p.location, p.contact_email, p.products, p.services, p.faqs
  into v_page from public.pages p where p.id = p_listing_id and p.owner_id = v_owner;
  if not found then return null; end if;
  if not exists (select 1 from private.merchant_report_access a
    where a.owner_id = v_owner and a.enabled and a.expires_at > v_observed)
  then raise exception 'merchant_reports_unavailable' using errcode = 'PT503'; end if;

  -- At most one of the previous twelve completed UTC calendar months.
  if p_month is null or not isfinite(p_month) then
    raise exception 'invalid_report_month' using errcode = 'PT400';
  end if;
  if p_month < (v_current_month - interval '12 months')::date or p_month >= v_current_month
    or extract(day from p_month) <> 1 then
    raise exception 'invalid_report_month' using errcode = 'PT400';
  end if;

  -- Only presence signals leave SQL for readiness. No offers, contact details,
  -- URLs, drafts or private configuration enter the report input response.
  -- Signal order is the nexez.agent-ready / 2026.1 contract, parity-tested with
  -- getReadinessCriteria. Malformed collection JSON is not a readiness score.
  if char_length(coalesce(v_page.name, '')) > 500 or char_length(coalesce(v_page.description, '')) > 20000
    or coalesce(jsonb_typeof(v_page.products), 'null') not in ('array', 'null')
    or coalesce(jsonb_typeof(v_page.services), 'null') not in ('array', 'null')
    or coalesce(jsonb_typeof(v_page.faqs), 'null') not in ('array', 'null') then
    v_listing := '{"state":"calculation_failed"}';
  else
    v_listing := jsonb_build_object('state', 'available',
      'name', coalesce(v_page.name, ''), 'description', v_page.description,
      'isPublished', coalesce(v_page.is_published, false),
      'standardVersion', '2026.1',
      'readinessSignals', jsonb_build_array(
        coalesce(v_page.name <> '', false), coalesce(v_page.slug <> '', false),
        coalesce(v_page.description <> '', false), coalesce(v_page.website_url <> '', false),
        coalesce(v_page.cta_url <> '', false), coalesce(v_page.audience <> '', false),
        coalesce(v_page.industry <> '', false), coalesce(v_page.location <> '' or v_page.contact_email <> '', false),
        coalesce(jsonb_array_length(nullif(v_page.products, 'null'::jsonb)), 0)
          + coalesce(jsonb_array_length(nullif(v_page.services, 'null'::jsonb)), 0) > 0,
        coalesce(jsonb_array_length(nullif(v_page.faqs, 'null'::jsonb)), 0) > 0,
        coalesce(v_page.is_published, false)));
  end if;

  foreach v_metric in array array['traffic', 'orders'] loop
    select c.* into v_coverage from private.merchant_report_coverage c
    where c.owner_id = v_owner and c.metric = v_metric and c.period_start = p_month
      and c.listing_id is not distinct from (case when v_metric = 'traffic' then p_listing_id else null end)
      and c.attested_at <= v_observed;
    if not found then continue; end if;
    if v_metric = 'traffic' then
      select count(*), jsonb_build_object(
        'totalVisits', count(*), 'detectedAiVisits', count(*) filter (where is_ai_agent),
        'verifiedServerVisits', count(*) filter (where trust_level = 'verified_server'),
        'unverifiedClientVisits', count(*) filter (where trust_level = 'unverified_client'),
        'legacyUnverifiedVisits', count(*) filter (where trust_level = 'legacy_unverified'))
      into v_total, v_counts
      from (select v.is_ai_agent, v.trust_level from public.agent_visits v
        where v.owner_id = v_owner and v.page_id = p_listing_id
          and v.created_at >= v_coverage.covered_from and v.created_at < v_coverage.covered_to_exclusive
        limit 100001) bounded;
    else
      -- Mode first, then payment status. These exclusion groups cannot overlap.
      -- Account scope deliberately includes other, deleted and transferred pages
      -- only when the durable order still belongs to this owner.
      select count(*), jsonb_build_object(
        'eligibleLiveOrders', count(*) filter (where stripe_livemode is true and status in ('paid','refunded','disputed','dispute_won')),
        'byPaymentStatus', jsonb_build_object(
          'paid', count(*) filter (where stripe_livemode is true and status = 'paid'),
          'refunded', count(*) filter (where stripe_livemode is true and status = 'refunded'),
          'disputed', count(*) filter (where stripe_livemode is true and status = 'disputed'),
          'dispute_won', count(*) filter (where stripe_livemode is true and status = 'dispute_won')),
        'excludedTestOrders', count(*) filter (where stripe_livemode is false),
        'excludedUnknownModeOrders', count(*) filter (where stripe_livemode is null),
        'excludedUnsupportedStatusOrders', count(*) filter (where stripe_livemode is true and (status is null or status not in ('paid','refunded','disputed','dispute_won'))))
      into v_total, v_counts
      from (select o.stripe_livemode, o.status from public.checkout_orders o
        where o.owner_id = v_owner
          and o.created_at >= v_coverage.covered_from and o.created_at < v_coverage.covered_to_exclusive
        limit 100001) bounded;
    end if;
    if v_total > 100000 then
      v_counts := '{"state":"calculation_failed"}';
    else
      v_counts := jsonb_build_object('state', 'available', 'value', v_counts,
        'coverage', jsonb_build_object(
          'state', case when v_coverage.covered_from = (p_month::timestamp at time zone 'UTC')
            and v_coverage.covered_to_exclusive = ((p_month + interval '1 month') at time zone 'UTC')
            then 'complete' else 'partial' end,
          'from', v_coverage.covered_from, 'toExclusive', v_coverage.covered_to_exclusive),
        'evidenceId', v_coverage.id, 'evidenceSha256', v_coverage.evidence_sha256);
    end if;
    if v_metric = 'traffic' then v_traffic := v_counts; else v_orders := v_counts; end if;
  end loop;

  return jsonb_build_object('ownerId', v_owner, 'listingId', p_listing_id,
    'observedAt', v_observed, 'month', to_char(p_month, 'YYYY-MM'),
    'listing', v_listing, 'traffic', v_traffic, 'orders', v_orders);
end;
$$;

-- The privileged reader remains in the non-exposed schema. The API wrapper is
-- an invoker and accepts no owner ID, coverage claim, report body or org context.
create function public.read_merchant_report_inputs(p_listing_id uuid, p_month date)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.read_merchant_report_inputs(p_listing_id, p_month); $$;

revoke all on function private.read_merchant_report_inputs(uuid, date),
  public.read_merchant_report_inputs(uuid, date) from public, anon, authenticated, service_role;
grant usage on schema private to authenticated;
grant execute on function private.read_merchant_report_inputs(uuid, date),
  public.read_merchant_report_inputs(uuid, date) to authenticated;

comment on table private.merchant_report_coverage is
  'Operator-reviewed collection evidence. Empty by default. Events, account age and pilot enrollment do not establish coverage. Withdrawal affects the next read.';
comment on function public.read_merchant_report_inputs(uuid, date) is
  'Owner-only bounded report inputs. Pilot access required. Stable statement snapshot; subsequent reads recheck current ownership, account status, pilot expiry and coverage. No agency consent or financial amounts.';

commit;

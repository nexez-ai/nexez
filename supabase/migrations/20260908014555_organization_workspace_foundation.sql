-- Stage 1, Group A: an organization is a separate workspace identity. It never
-- substitutes for pages.owner_id or confers access to merchant data.
begin;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (
    char_length(slug) between 3 and 63
    and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  ),
  name text not null check (
    char_length(name) between 1 and 120
    and name = btrim(name) and name !~ '[[:cntrl:]]'
  ),
  status text not null default 'disabled' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now()
);

create table public.organization_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'operator')),
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  unique (org_id, user_id),
  -- Future jobs reference (org_id, membership_id), preventing mixed-org parents.
  unique (org_id, id)
);

create index organization_members_user_org_idx
  on public.organization_members (user_id, org_id);
create unique index organization_members_one_owner_idx
  on public.organization_members (org_id) where role = 'owner';

create schema if not exists private;

create table private.organization_scan_entitlements (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  enabled boolean not null default false,
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  max_targets_per_batch integer not null default 50
    check (max_targets_per_batch between 1 and 50),
  max_targets_per_day integer not null default 250
    check (max_targets_per_day between 1 and 250),
  max_concurrent_targets integer not null default 3
    check (max_concurrent_targets between 1 and 3),
  check (isfinite(starts_at) and isfinite(expires_at)),
  check (expires_at > starts_at and expires_at <= starts_at + interval '90 days'),
  check (max_targets_per_batch <= max_targets_per_day),
  check (max_concurrent_targets <= max_targets_per_batch)
);

-- Missing control or entitlement rows deny access. The creating migration never
-- enables a workspace or a scan. Entitlements describe limits, not reservations.
create table private.organization_runtime_controls (
  singleton boolean primary key default true check (singleton),
  workspace_enabled boolean not null default false,
  scan_submission_enabled boolean not null default false
);
insert into private.organization_runtime_controls (singleton) values (true);

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table private.organization_scan_entitlements enable row level security;
alter table private.organization_runtime_controls enable row level security;

-- Provisioning is an explicit database-operator transaction during the pilot.
-- Even service_role receives no base-table grants in this release. Later worker
-- commands must get their own bounded, freshly authorized RPC contracts.
revoke all on table public.organizations, public.organization_members,
  private.organization_scan_entitlements, private.organization_runtime_controls
  from public, anon, authenticated, service_role;

create function public.list_my_organizations(p_after_slug text default null)
returns table (org_id uuid, org_slug text, org_name text, membership_id uuid, member_role text)
language sql stable security definer
set search_path = ''
rows 51
as $$
  select o.id, o.slug, o.name, m.id, m.role
  from public.organization_members m
  join public.organizations o on o.id = m.org_id
  join auth.users u on u.id = m.user_id
  join private.organization_runtime_controls c on c.singleton
  where m.user_id = (select auth.uid())
    and m.status = 'active' and o.status = 'active' and c.workspace_enabled
    and u.is_anonymous is not true
    and (u.banned_until is null or u.banned_until <= statement_timestamp())
    and (
      p_after_slug is null or (
        char_length(p_after_slug) between 3 and 63
        and p_after_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
        and o.slug > p_after_slug
      )
    )
  order by o.slug
  limit 51;
$$;

-- Identity checks and the entitlement projection share one statement snapshot.
-- A suspension committed before the statement is visible immediately; an
-- already-authorized bounded read may finish. This read is not a scan permit.
create function public.get_organization_context(
  p_org_id uuid default null,
  p_org_slug text default null
)
returns table (
  org_id uuid, org_slug text, org_name text, membership_id uuid, member_role text,
  scan_access text, scan_starts_at timestamptz, scan_expires_at timestamptz,
  max_targets_per_batch integer, max_targets_per_day integer,
  max_concurrent_targets integer
)
language sql stable security definer
set search_path = ''
rows 1
as $$
  select o.id, o.slug, o.name, m.id, m.role,
    case
      when not c.scan_submission_enabled then 'paused'
      when e.org_id is null or not e.enabled then 'unconfigured'
      when e.starts_at > statement_timestamp() then 'scheduled'
      when e.expires_at <= statement_timestamp() then 'expired'
      else 'available'
    end,
    e.starts_at, e.expires_at, e.max_targets_per_batch,
    e.max_targets_per_day, e.max_concurrent_targets
  from public.organization_members m
  join public.organizations o on o.id = m.org_id
  join auth.users u on u.id = m.user_id
  join private.organization_runtime_controls c on c.singleton
  left join private.organization_scan_entitlements e on e.org_id = o.id
  where m.user_id = (select auth.uid())
    and m.status = 'active' and o.status = 'active' and c.workspace_enabled
    and u.is_anonymous is not true
    and (u.banned_until is null or u.banned_until <= statement_timestamp())
    and (
      (p_org_id is not null and p_org_slug is null and o.id = p_org_id)
      or (p_org_id is null and p_org_slug is not null and o.slug = p_org_slug)
    )
  limit 1;
$$;

revoke all on function public.list_my_organizations(text),
  public.get_organization_context(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.list_my_organizations(text),
  public.get_organization_context(uuid, text) to authenticated;

comment on function public.get_organization_context(uuid, text) is
  'Bounded member-only workspace projection. Informational scan limits, never a reusable authorization or quota reservation.';

-- Reserve the new top-level route in both public naming namespaces. An existing
-- merchant claim must stop deployment, never be stolen by a routing change.
insert into private.public_identifier_claims (namespace, identifier, kind) values
  ('page_slug', 'console', 'system'),
  ('storefront_handle', 'console', 'system')
on conflict (namespace, identifier) do nothing;
do $$
begin
  if exists (
    select 1 from private.public_identifier_claims
    where identifier = 'console' and kind <> 'system'
  ) or exists (select 1 from public.pages where lower(btrim(slug)) = 'console')
    or exists (select 1 from public.storefronts where lower(btrim(handle)) = 'console') then
    raise exception 'The console route conflicts with an existing public identifier. Resolve the claim before deployment.';
  end if;
end $$;

commit;

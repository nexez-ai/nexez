-- Stage 1, Group B. Public prospect work has no merchant authority.
begin;

alter table private.organization_runtime_controls
  add column scan_policy_approved boolean not null default false;

create table public.organization_scan_batches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  membership_id uuid,
  initiated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  deadline_at timestamptz not null default clock_timestamp() + interval '20 minutes',
  expires_at timestamptz not null default clock_timestamp() + interval '90 days',
  cancelled_at timestamptz,
  dispatch_after timestamptz not null default clock_timestamp(),
  policy_version text not null default 'public-scanner-v1' check (policy_version = 'public-scanner-v1'),
  unique (org_id, id),
  foreign key (org_id, membership_id) references public.organization_members(org_id, id)
    on delete set null (membership_id)
);
create index organization_scan_batches_initiator_idx on public.organization_scan_batches(initiated_by);
create index organization_scan_batches_member_idx on public.organization_scan_batches(org_id, membership_id);
create index organization_scan_batches_recent_idx on public.organization_scan_batches(org_id, created_at desc, id);
create index organization_scan_batches_dispatch_idx on public.organization_scan_batches(dispatch_after);
create index organization_scan_batches_expiry_idx on public.organization_scan_batches(expires_at);

create table public.organization_scan_batch_targets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  batch_id uuid not null,
  origin text not null check (char_length(origin) <= 263 and origin ~ '^https?://[a-z0-9.-]+$'),
  state text not null default 'queued' check (state in ('queued','running','succeeded','failed','cancelled')),
  attempts integer not null default 0 check (attempts between 0 and 3),
  lease_token uuid,
  lease_until timestamptz,
  available_at timestamptz not null default clock_timestamp(),
  started_at timestamptz,
  finished_at timestamptz,
  result jsonb,
  failure_code text check (failure_code in ('unsafe_target','robots_denied','target_unavailable','network_error','expired','access_revoked','cancelled','attempts_exhausted')),
  elapsed_ms integer not null default 0 check (elapsed_ms between 0 and 60000),
  bytes_read integer not null default 0 check (bytes_read between 0 and 3145728),
  probe_count integer not null default 0 check (probe_count between 0 and 40),
  follow_up boolean not null default false,
  foreign key (org_id, batch_id) references public.organization_scan_batches(org_id, id) on delete cascade,
  unique (batch_id, origin),
  check ((state = 'running' and lease_token is not null and lease_until is not null)
    or (state <> 'running' and lease_token is null and lease_until is null)),
  check (result is null or (state = 'succeeded' and jsonb_typeof(result) = 'object' and octet_length(result::text) <= 8192))
);
create index organization_scan_targets_parent_idx on public.organization_scan_batch_targets(org_id,batch_id);
create index organization_scan_targets_claim_idx on public.organization_scan_batch_targets(org_id,state,available_at);

-- Receipts survive batch deletion, preventing replay from recreating its targets.
-- Accepted targets consume quota even when cancelled or unsuccessful. Retries
-- and exact request replay never consume another unit. No quota refunds.
create table private.organization_scan_receipts (
  org_id uuid not null references public.organizations(id) on delete cascade,
  idempotency_key uuid not null,
  digest text not null,
  batch_id uuid not null,
  reserved integer not null check (reserved between 1 and 50),
  expires_at timestamptz not null default clock_timestamp() + interval '90 days',
  primary key (org_id,idempotency_key)
);
create table private.organization_scan_daily_usage (
  org_id uuid not null references public.organizations(id) on delete cascade,
  day date not null,
  reserved integer not null check (reserved between 0 and 250),
  primary key (org_id,day)
);
create table private.organization_scan_actor_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  reserved integer not null check (reserved between 0 and 250),
  primary key (user_id,day)
);

-- Only pseudonymous identifiers, closed event codes and bounded counters. No
-- prospect names, URLs, fetched text, tokens, receipts or raw errors in telemetry.
create table private.organization_scan_events (
  id bigint generated always as identity primary key,
  org_subject uuid not null,
  batch_subject uuid not null,
  actor_subject uuid default auth.uid(),
  event text not null check (event in ('submitted','claimed','succeeded','failed','retry','cancelled','deleted','expired','access_revoked','pressure_deferred','follow_up_changed')),
  units integer not null default 0 check (units between 0 and 50),
  elapsed_ms integer not null default 0 check (elapsed_ms between 0 and 60000),
  bytes_read integer not null default 0 check (bytes_read between 0 and 3145728),
  probe_count integer not null default 0 check (probe_count between 0 and 40),
  queue_wait_ms integer not null default 0 check (queue_wait_ms between 0 and 1200000),
  created_at timestamptz not null default clock_timestamp(),
  retain_until timestamptz not null
);
create index organization_scan_events_retention_idx on private.organization_scan_events(retain_until);

create table private.scan_network_controls (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default true,
  hash_salt uuid not null default gen_random_uuid(),
  max_concurrent integer not null default 8 check (max_concurrent between 1 and 16)
);
insert into private.scan_network_controls(singleton) values(true);
create table private.scan_target_denylist (domain text primary key check (domain ~ '^[a-z0-9.-]{3,253}$'));
create table private.scan_network_windows (
  domain_key text primary key,
  window_start timestamptz not null,
  starts integer not null check (starts between 1 and 30)
);
create table private.scan_network_leases (
  token uuid not null,
  domain_key text not null,
  expires_at timestamptz not null,
  primary key(token,domain_key)
);
create index scan_network_leases_domain_idx on private.scan_network_leases(domain_key,expires_at);

-- Stable lock order for commands: runtime, organization, membership,
-- entitlement, then job rows. Locks are held only by short database commands.
create function private.lock_organization_scan_access(p_org uuid,p_user uuid,p_scan boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare c private.organization_runtime_controls; o public.organizations;
  m public.organization_members; e private.organization_scan_entitlements;
begin
  select * into c from private.organization_runtime_controls where singleton for update;
  select * into o from public.organizations where id=p_org for update;
  select * into m from public.organization_members where org_id=p_org and user_id=p_user for update;
  select * into e from private.organization_scan_entitlements where org_id=p_org for update;
  if c.workspace_enabled is not true or o.status is distinct from 'active' or m.status is distinct from 'active'
    or not exists(select 1 from auth.users u where u.id=p_user and u.is_anonymous is not true
      and (u.banned_until is null or u.banned_until <= clock_timestamp()) and u.deleted_at is null) then return null; end if;
  if p_scan and (c.scan_submission_enabled is not true or c.scan_policy_approved is not true
    or e.enabled is not true or e.starts_at > clock_timestamp() or e.expires_at <= clock_timestamp()) then return null; end if;
  return m.id;
end $$;

create function private.organization_scan_event(p_org uuid,p_batch uuid,p_event text,p_units integer default 0,
  p_ms integer default 0,p_bytes integer default 0,p_probes integer default 0,p_queue_ms integer default 0)
returns void language sql security definer set search_path = '' as $$
  insert into private.organization_scan_events(org_subject,batch_subject,event,units,elapsed_ms,bytes_read,probe_count,queue_wait_ms,retain_until)
  values(p_org,p_batch,p_event,p_units,p_ms,p_bytes,p_probes,p_queue_ms,clock_timestamp() +
    case when p_event in ('submitted','cancelled','deleted','access_revoked','follow_up_changed') then interval '24 months' else interval '30 days' end);
$$;

create function public.submit_organization_scan_batch(p_org_id uuid,p_idempotency_key uuid,p_targets text[],p_attested boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare m uuid; targets text[]; digest text; receipt private.organization_scan_receipts;
  b uuid; total integer; used integer; actor_used integer; limits private.organization_scan_entitlements;
  today date;
begin
  m := private.lock_organization_scan_access(p_org_id,auth.uid(),false);
  if m is null then raise sqlstate 'PT404' using message='workspace_not_found'; end if;
  if p_attested is not true or p_idempotency_key is null or p_targets is null or array_ndims(p_targets)<>1
    or cardinality(p_targets) not between 1 and 50 or exists(select 1 from unnest(p_targets) t where t is null
      or char_length(t)>263 or t !~ '^https?://([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$'
      or t ~ '\.(localhost|local|internal|test|invalid|example|onion|home|lan)$')
    then raise sqlstate 'PT400' using message='invalid_targets'; end if;
  select array_agg(t order by t) into targets from (select distinct unnest(p_targets) t) s;
  digest := encode(sha256(convert_to(array_to_string(targets,E'\n'),'UTF8')),'hex');
  select * into receipt from private.organization_scan_receipts where org_id=p_org_id and idempotency_key=p_idempotency_key;
  if found then
    if receipt.digest<>digest then raise sqlstate 'PT409' using message='idempotency_conflict'; end if;
    if not exists(select 1 from public.organization_scan_batches where org_id=p_org_id and id=receipt.batch_id and expires_at>clock_timestamp())
      then raise sqlstate 'PT410' using message='batch_deleted'; end if;
    return jsonb_build_object('batch_id',receipt.batch_id,'replayed',true,'reserved',receipt.reserved);
  end if;
  if private.lock_organization_scan_access(p_org_id,auth.uid(),true) is null
    then raise sqlstate 'PT409' using message='scanning_unavailable'; end if;
  select * into limits from private.organization_scan_entitlements where org_id=p_org_id;
  today := (clock_timestamp() at time zone 'UTC')::date;
  total := cardinality(targets);
  if total>limits.max_targets_per_batch then raise sqlstate 'PT400' using message='batch_limit'; end if;
  insert into private.organization_scan_daily_usage values(p_org_id,today,0) on conflict do nothing;
  insert into private.organization_scan_actor_usage values(auth.uid(),today,0) on conflict do nothing;
  select reserved into used from private.organization_scan_daily_usage where org_id=p_org_id and day=today for update;
  select reserved into actor_used from private.organization_scan_actor_usage where user_id=auth.uid() and day=today for update;
  if used+total>limits.max_targets_per_day or actor_used+total>250 then raise sqlstate 'PT429' using message='daily_limit'; end if;
  insert into public.organization_scan_batches(org_id,membership_id,initiated_by) values(p_org_id,m,auth.uid()) returning id into b;
  insert into public.organization_scan_batch_targets(org_id,batch_id,origin) select p_org_id,b,t from unnest(targets) t;
  insert into private.organization_scan_receipts(org_id,idempotency_key,digest,batch_id,reserved) values(p_org_id,p_idempotency_key,digest,b,total);
  update private.organization_scan_daily_usage set reserved=reserved+total where org_id=p_org_id and day=today;
  update private.organization_scan_actor_usage set reserved=reserved+total where user_id=auth.uid() and day=today;
  perform private.organization_scan_event(p_org_id,b,'submitted',total);
  return jsonb_build_object('batch_id',b,'replayed',false,'reserved',total);
end $$;

create function private.organization_scan_projection(p_org uuid,p_batch uuid,p_detail boolean)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id',b.id,'org_id',b.org_id,'created_at',b.created_at,'expires_at',b.expires_at,
    'cancelled',b.cancelled_at is not null,'total',count(t.id),
    'queued',count(t.id) filter(where t.state='queued'),'running',count(t.id) filter(where t.state='running'),
    'succeeded',count(t.id) filter(where t.state='succeeded'),'failed',count(t.id) filter(where t.state='failed'),
    'cancelled_targets',count(t.id) filter(where t.state='cancelled'),
    'targets',case when p_detail then jsonb_agg(jsonb_build_object('id',t.id,'origin',t.origin,'state',t.state,
      'attempts',t.attempts,'failure_code',t.failure_code,'result',t.result,'elapsed_ms',t.elapsed_ms,
      'follow_up',t.follow_up,'finished_at',t.finished_at) order by t.origin) else '[]'::jsonb end)
  from public.organization_scan_batches b join public.organization_scan_batch_targets t on t.org_id=b.org_id and t.batch_id=b.id
  where b.org_id=p_org and b.id=p_batch and b.expires_at>statement_timestamp() group by b.id;
$$;

-- Lookup precedes fresh DNS work so retrying an accepted request does not depend
-- on the target still being online, the runner being configured, or quota left.
create function public.find_organization_scan_receipt(p_org_id uuid,p_idempotency_key uuid,p_targets text[])
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r private.organization_scan_receipts; digest text;
begin
  if not exists(select 1 from public.get_organization_context(p_org_id,null)) then raise sqlstate 'PT404' using message='workspace_not_found'; end if;
  if p_targets is null or cardinality(p_targets) not between 1 and 50 or array_ndims(p_targets)<>1
    or exists(select 1 from unnest(p_targets) t where t is null or char_length(t)>263) then raise sqlstate 'PT400' using message='invalid_targets'; end if;
  select encode(sha256(convert_to(array_to_string(array_agg(t order by t),E'\n'),'UTF8')),'hex') into digest from (select distinct unnest(p_targets) t) s;
  select * into r from private.organization_scan_receipts where org_id=p_org_id and idempotency_key=p_idempotency_key;
  if not found then return null; end if;
  if r.digest<>digest then raise sqlstate 'PT409' using message='idempotency_conflict'; end if;
  if not exists(select 1 from public.organization_scan_batches where org_id=p_org_id and id=r.batch_id and expires_at>statement_timestamp())
    then raise sqlstate 'PT410' using message='batch_deleted'; end if;
  return jsonb_build_object('batch_id',r.batch_id,'replayed',true,'reserved',r.reserved);
end $$;

create function public.read_organization_scan_batches(p_org_id uuid,p_batch_id uuid default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('batches',coalesce((select jsonb_agg(private.organization_scan_projection(p_org_id,b.id,p_batch_id is not null) order by b.created_at desc,b.id)
    from (select id,created_at from public.organization_scan_batches where org_id=p_org_id and expires_at>statement_timestamp()
      and (p_batch_id is null or id=p_batch_id) order by created_at desc,id limit 20) b),'[]'::jsonb),
    'used_today',coalesce((select reserved from private.organization_scan_daily_usage where org_id=p_org_id and day=(statement_timestamp() at time zone 'UTC')::date),0),
    'can_submit',c.scan_submission_enabled and c.scan_policy_approved and coalesce(e.enabled and e.starts_at<=statement_timestamp() and e.expires_at>statement_timestamp(),false))
  from public.get_organization_context(p_org_id,null) ctx
  join private.organization_runtime_controls c on c.singleton
  left join private.organization_scan_entitlements e on e.org_id=ctx.org_id;
$$;

create function public.change_organization_scan_batch(p_org_id uuid,p_batch_id uuid,p_action text,p_target_id uuid default null,p_follow_up boolean default false)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if private.lock_organization_scan_access(p_org_id,auth.uid(),false) is null then raise sqlstate 'PT404' using message='workspace_not_found'; end if;
  perform 1 from public.organization_scan_batches where org_id=p_org_id and id=p_batch_id and expires_at>clock_timestamp() for update;
  if not found then raise sqlstate 'PT404' using message='batch_not_found'; end if;
  if p_action='cancel' then
    update public.organization_scan_batches set cancelled_at=coalesce(cancelled_at,clock_timestamp()) where org_id=p_org_id and id=p_batch_id;
    update public.organization_scan_batch_targets set state='cancelled',failure_code='cancelled',lease_token=null,lease_until=null,finished_at=clock_timestamp()
      where org_id=p_org_id and batch_id=p_batch_id and state in ('queued','running');
    perform private.organization_scan_event(p_org_id,p_batch_id,'cancelled');
  elsif p_action='delete' then
    delete from public.organization_scan_batches where org_id=p_org_id and id=p_batch_id;
    perform private.organization_scan_event(p_org_id,p_batch_id,'deleted');
  elsif p_action='follow_up' and p_follow_up is not null then
    update public.organization_scan_batch_targets set follow_up=p_follow_up where org_id=p_org_id and batch_id=p_batch_id and id=p_target_id and state='succeeded';
    if not found then raise sqlstate 'PT404' using message='target_not_found'; end if;
    perform private.organization_scan_event(p_org_id,p_batch_id,'follow_up_changed');
  else raise sqlstate 'PT400' using message='invalid_action'; end if;
  return true;
end $$;

create table private.organization_scan_cooldowns (
  org_id uuid not null references public.organizations(id) on delete cascade,
  domain_key text not null,
  expires_at timestamptz not null,
  primary key(org_id,domain_key)
);

-- Shared by anonymous and organization scans. Domain keys use a private salt;
-- the transient limiter is not a second plaintext prospect list. Capacity
-- responses disclose no organization identity or previous result.
create function public.acquire_scan_network_slot(p_domain text,p_token uuid,p_org_id uuid default null)
returns text language plpgsql security definer set search_path = '' as $$
declare c private.scan_network_controls; k text; w private.scan_network_windows;
begin
  select * into c from private.scan_network_controls where singleton for update;
  if c.enabled is not true or p_token is null or p_domain is null or p_domain !~ '^[a-z0-9.-]{3,253}$' then return 'denied'; end if;
  if exists(select 1 from private.scan_target_denylist where domain=p_domain or p_domain like '%.'||domain) then return 'denied'; end if;
  k := encode(sha256(convert_to(c.hash_salt::text||p_domain,'UTF8')),'hex');
  if p_org_id is not null and exists(select 1 from private.organization_scan_cooldowns where org_id=p_org_id and domain_key=k and expires_at>clock_timestamp()) then return 'cooldown'; end if;
  delete from private.scan_network_leases where expires_at<=clock_timestamp();
  if exists(select 1 from private.scan_network_leases where token=p_token and domain_key=k) then return 'allowed'; end if;
  if (select count(*) from private.scan_network_leases where token=p_token)>=4 then return 'denied'; end if;
  if exists(select 1 from private.scan_network_leases where domain_key=k)
    or (not exists(select 1 from private.scan_network_leases where token=p_token)
      and (select count(distinct token) from private.scan_network_leases)>=c.max_concurrent) then return 'busy'; end if;
  select * into w from private.scan_network_windows where domain_key=k;
  if w.window_start>clock_timestamp()-interval '1 minute' and w.starts>=30 then return 'busy'; end if;
  insert into private.scan_network_windows values(k,clock_timestamp(),1) on conflict(domain_key) do update
    set starts=case when scan_network_windows.window_start<=clock_timestamp()-interval '1 minute' then 1 else scan_network_windows.starts+1 end,
      window_start=case when scan_network_windows.window_start<=clock_timestamp()-interval '1 minute' then clock_timestamp() else scan_network_windows.window_start end;
  insert into private.scan_network_leases values(p_token,k,clock_timestamp()+interval '50 seconds');
  return 'allowed';
end $$;

create function public.release_scan_network_slot(p_token uuid)
returns void language sql security definer set search_path = '' as $$
  delete from private.scan_network_leases where token=p_token;
$$;

create function public.claim_organization_scan_target(p_org_id uuid,p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.organization_scan_batches; t public.organization_scan_batch_targets; m uuid; cap integer;
begin
  -- Read only enough to locate the stored initiator, then acquire authority locks.
  select * into b from public.organization_scan_batches where org_id=p_org_id and id=p_batch_id;
  if not found then return null; end if;
  m := private.lock_organization_scan_access(p_org_id,b.initiated_by,true);
  select * into b from public.organization_scan_batches where org_id=p_org_id and id=p_batch_id for update;
  if not found then return null; end if;
  if m is null or m is distinct from b.membership_id or b.cancelled_at is not null or b.deadline_at<=clock_timestamp() or b.expires_at<=clock_timestamp() then
    update public.organization_scan_batch_targets set state='cancelled',failure_code=case when b.deadline_at<=clock_timestamp() then 'expired' else 'access_revoked' end,
      lease_token=null,lease_until=null,finished_at=clock_timestamp() where org_id=p_org_id and batch_id=p_batch_id and state in ('queued','running');
    if found then perform private.organization_scan_event(p_org_id,p_batch_id,case when b.deadline_at<=clock_timestamp() then 'expired' else 'access_revoked' end); end if;
    return null;
  end if;
  update public.organization_scan_batch_targets set state=case when attempts>=3 then 'failed' else 'queued' end,
    failure_code=case when attempts>=3 then 'attempts_exhausted' else null end,lease_token=null,lease_until=null,
    finished_at=case when attempts>=3 then clock_timestamp() else null end
    where org_id=p_org_id and batch_id=p_batch_id and state='running' and lease_until<=clock_timestamp();
  select max_concurrent_targets into cap from private.organization_scan_entitlements where org_id=p_org_id;
  if (select count(*) from public.organization_scan_batch_targets where org_id=p_org_id and state='running' and lease_until>clock_timestamp())>=cap then return null; end if;
  select * into t from public.organization_scan_batch_targets where org_id=p_org_id and batch_id=p_batch_id and state='queued'
    and available_at<=clock_timestamp() order by origin limit 1 for update skip locked;
  if not found then return null; end if;
  update public.organization_scan_batch_targets set state='running',attempts=attempts+1,lease_token=gen_random_uuid(),
    lease_until=clock_timestamp()+interval '75 seconds',started_at=clock_timestamp(),failure_code=null where id=t.id returning * into t;
  perform private.organization_scan_event(p_org_id,p_batch_id,'claimed',0,0,0,0,
    least(1200000,greatest(0,(extract(epoch from clock_timestamp()-t.available_at)*1000)::integer)));
  return jsonb_build_object('target_id',t.id,'origin',t.origin,'lease_token',t.lease_token,'attempt',t.attempts);
end $$;

create function public.complete_organization_scan_target(p_org_id uuid,p_target_id uuid,p_lease_token uuid,
  p_result jsonb,p_failure text,p_elapsed_ms integer,p_bytes_read integer,p_probe_count integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare b public.organization_scan_batches; t public.organization_scan_batch_targets; m uuid; next_state text; code text;
begin
  select b0.* into b from public.organization_scan_batches b0 join public.organization_scan_batch_targets t0 on t0.org_id=b0.org_id and t0.batch_id=b0.id
    where t0.org_id=p_org_id and t0.id=p_target_id;
  if not found then return false; end if;
  m := private.lock_organization_scan_access(p_org_id,b.initiated_by,true);
  select * into b from public.organization_scan_batches where org_id=p_org_id and id=b.id for update;
  if not found then return false; end if;
  select * into t from public.organization_scan_batch_targets where org_id=p_org_id and id=p_target_id for update;
  if not found or t.state<>'running' or t.lease_token is distinct from p_lease_token or t.lease_until<=clock_timestamp() then return false; end if;
  if m is null or m is distinct from b.membership_id or b.cancelled_at is not null or b.deadline_at<=clock_timestamp() or b.expires_at<=clock_timestamp() then
    update public.organization_scan_batch_targets set state='cancelled',failure_code='access_revoked',lease_token=null,lease_until=null,
      finished_at=clock_timestamp() where org_id=p_org_id and batch_id=b.id and state in ('queued','running');
    perform private.organization_scan_event(p_org_id,b.id,'access_revoked');
    return false;
  end if;
  if p_elapsed_ms not between 0 and 60000 or p_bytes_read not between 0 and 3145728 or p_probe_count not between 0 and 40
    or p_elapsed_ms is null or p_bytes_read is null or p_probe_count is null then raise exception 'invalid_scan_metrics'; end if;
  if p_result is not null then
    -- Closed rubric IDs and status codes only. Labels are rendered from local
    -- application copy, never from a fetched page or worker-provided HTML.
    if p_failure is not null or jsonb_typeof(p_result)<>'object' or octet_length(p_result::text)>8192
      or p_result - array['version','score','checks'] <> '{}'::jsonb
      or p_result->'version' is distinct from '2'::jsonb or jsonb_typeof(p_result->'score') is distinct from 'number'
      or (p_result->>'score')::numeric not between 0 and 100
      or jsonb_typeof(p_result->'checks') is distinct from 'array' then raise exception 'invalid_scan_result'; end if;
    if jsonb_array_length(p_result->'checks')<>18 or exists(select 1 from jsonb_array_elements(p_result->'checks') c
      where jsonb_typeof(c)<>'object' or c - array['id','status'] <> '{}'::jsonb
      or c->>'id' is null or c->>'id' not in ('reachable','speed','robots','agent_docs','llms_txt','semantics','jsonld','business_identity','offer_schema','pricing','action_path','availability','offer_details','structured_action','https','contact','policies','freshness')
      or c->>'status' is null or c->>'status' not in ('pass','warn','fail'))
      or (select count(distinct c->>'id') from jsonb_array_elements(p_result->'checks') c)<>18 then raise exception 'invalid_scan_checks'; end if;
    next_state := 'succeeded'; code := null;
    perform 1 from private.scan_network_controls where singleton for update;
    insert into private.organization_scan_cooldowns(org_id,domain_key,expires_at)
      select p_org_id,domain_key,clock_timestamp()+interval '24 hours' from private.scan_network_leases where token=p_lease_token
      on conflict(org_id,domain_key) do update set expires_at=excluded.expires_at;
  else
    if p_failure is null or p_failure not in ('unsafe_target','robots_denied','target_unavailable','network_error','pressure_deferred') then raise exception 'invalid_scan_failure'; end if;
    next_state := case when p_failure='pressure_deferred' or (p_failure='network_error' and t.attempts<3) then 'queued' else 'failed' end;
    code := case when next_state='queued' then null else p_failure end;
  end if;
  update public.organization_scan_batch_targets set state=next_state,result=p_result,failure_code=code,lease_token=null,lease_until=null,
    attempts=case when p_failure='pressure_deferred' then greatest(0,attempts-1) else attempts end,
    available_at=clock_timestamp()+interval '30 seconds',finished_at=case when next_state='queued' then null else clock_timestamp() end,
    elapsed_ms=p_elapsed_ms,bytes_read=p_bytes_read,probe_count=p_probe_count where id=p_target_id;
  perform private.organization_scan_event(p_org_id,b.id,case when p_failure='pressure_deferred' then 'pressure_deferred' when next_state='queued' then 'retry' else next_state end,0,p_elapsed_ms,p_bytes_read,p_probe_count);
  return true;
end $$;

-- The database queue is the outbox. Lost event sends, exhausted orchestration
-- retries and abandoned leases are recoverable without resubmitting or charging.
create function public.dispatch_organization_scan_batches()
returns table(org_id uuid,batch_id uuid) language plpgsql security definer set search_path = '' as $$
begin
  return query with due as (
    select b.id from public.organization_scan_batches b where b.dispatch_after<=clock_timestamp()
      and exists(select 1 from public.organization_scan_batch_targets t where t.org_id=b.org_id and t.batch_id=b.id and t.state in ('queued','running'))
    order by b.dispatch_after limit 20 for update skip locked
  ) update public.organization_scan_batches b set dispatch_after=clock_timestamp()+interval '2 minutes'
    from due where b.id=due.id returning b.org_id,b.id;
end $$;

create function public.cleanup_organization_scans()
returns integer language plpgsql security definer set search_path = '' as $$
declare b record; removed integer := 0;
begin
  -- Match command lock order. Cleanup runs even while the capability is off.
  perform 1 from private.organization_runtime_controls where singleton for update;
  for b in select id,org_id from public.organization_scan_batches where expires_at<=clock_timestamp() order by expires_at limit 100 loop
    perform 1 from public.organizations where id=b.org_id for update;
    delete from public.organization_scan_batches where id=b.id and org_id=b.org_id;
    if found then perform private.organization_scan_event(b.org_id,b.id,'deleted'); removed:=removed+1; end if;
  end loop;
  for b in select id,org_id from public.organization_scan_batches b0 where deadline_at<=clock_timestamp()
    and exists(select 1 from public.organization_scan_batch_targets t where t.org_id=b0.org_id and t.batch_id=b0.id and t.state in ('queued','running'))
    order by deadline_at limit 100 loop
    update public.organization_scan_batch_targets set state='cancelled',failure_code='expired',lease_token=null,lease_until=null,finished_at=clock_timestamp()
      where org_id=b.org_id and batch_id=b.id and state in ('queued','running');
    if found then perform private.organization_scan_event(b.org_id,b.id,'expired'); end if;
  end loop;
  delete from private.organization_scan_receipts where expires_at<=clock_timestamp();
  delete from private.organization_scan_daily_usage where day<(clock_timestamp() at time zone 'UTC')::date-2;
  delete from private.organization_scan_actor_usage where day<(clock_timestamp() at time zone 'UTC')::date-2;
  delete from private.organization_scan_cooldowns where expires_at<=clock_timestamp();
  delete from private.organization_scan_events where retain_until<=clock_timestamp();
  perform 1 from private.scan_network_controls where singleton for update;
  delete from private.scan_network_leases where expires_at<=clock_timestamp();
  delete from private.scan_network_windows where window_start<=clock_timestamp()-interval '1 day';
  return removed;
end $$;

do $$
declare rel text; fn record;
begin
  foreach rel in array array['public.organization_scan_batches','public.organization_scan_batch_targets',
    'private.organization_scan_receipts','private.organization_scan_daily_usage','private.organization_scan_actor_usage',
    'private.organization_scan_events','private.scan_network_controls','private.scan_target_denylist',
    'private.scan_network_windows','private.scan_network_leases','private.organization_scan_cooldowns'] loop
    execute format('alter table %s enable row level security',rel);
    execute format('revoke all on table %s from public, anon, authenticated, service_role',rel);
  end loop;
  for fn in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private') and p.proname in ('lock_organization_scan_access','organization_scan_event','organization_scan_projection',
      'submit_organization_scan_batch','find_organization_scan_receipt','read_organization_scan_batches','change_organization_scan_batch','acquire_scan_network_slot','release_scan_network_slot',
      'claim_organization_scan_target','complete_organization_scan_target','dispatch_organization_scan_batches','cleanup_organization_scans') loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role',fn.signature);
  end loop;
end $$;
revoke all on sequence private.organization_scan_events_id_seq from public,anon,authenticated,service_role;
grant execute on function public.submit_organization_scan_batch(uuid,uuid,text[],boolean),
  public.find_organization_scan_receipt(uuid,uuid,text[]),
  public.read_organization_scan_batches(uuid,uuid), public.change_organization_scan_batch(uuid,uuid,text,uuid,boolean) to authenticated;
grant execute on function public.acquire_scan_network_slot(text,uuid,uuid), public.release_scan_network_slot(uuid),
  public.claim_organization_scan_target(uuid,uuid), public.complete_organization_scan_target(uuid,uuid,uuid,jsonb,text,integer,integer,integer),
  public.dispatch_organization_scan_batches(), public.cleanup_organization_scans() to service_role;

commit;

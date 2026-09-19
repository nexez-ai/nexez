begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table private.merchant_website_controls (
  singleton boolean primary key default true check (singleton),
  collection_enabled boolean not null default false
);
insert into private.merchant_website_controls(singleton) values (true);

create function private.merchant_website_origin(p_url text) returns text
language plpgsql immutable strict set search_path = '' as $$
declare v text; host text;
begin
  if char_length(p_url) > 2048 or p_url ~ '[[:cntrl:]\\]' then return null; end if;
  v := btrim(p_url);
  if v !~* '^https?://' then v := 'https://' || v; end if;
  host := lower(substring(regexp_replace(v, '^https?://', '', 'i') from '^[^/?#]+'));
  if host is null or char_length(host)>253
    or host !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$'
    or host ~ '(^|\.)(localhost|local|internal|test|invalid|example|onion|home|lan)$' then return null; end if;
  return case when v ~* '^https://' then 'https://' else 'http://' end || host;
end $$;

create table private.merchant_website_associations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  listing_id uuid not null references public.pages(id) on delete cascade,
  request_key uuid not null,
  origin text not null check (private.merchant_website_origin(origin) is not null and origin = private.merchant_website_origin(origin) and char_length(origin)<=263),
  website_url_at_approval text not null check (char_length(website_url_at_approval)<=2048),
  method text not null default 'merchant_approved' check (method='merchant_approved'),
  approval_version text not null default 'merchant-website-v1' check (approval_version='merchant-website-v1'),
  confirmed_at timestamptz not null default clock_timestamp() check (isfinite(confirmed_at)),
  expires_at timestamptz not null check (isfinite(expires_at)),
  revoked_at timestamptz check (isfinite(revoked_at)),
  check (expires_at>confirmed_at and expires_at<=confirmed_at+interval '30 days'),
  check (revoked_at is null or revoked_at>=confirmed_at),
  unique(owner_id, request_key), unique(id, owner_id, listing_id, origin)
);
create unique index merchant_website_one_association_idx on private.merchant_website_associations(listing_id) where revoked_at is null;
create index merchant_website_associations_owner_idx on private.merchant_website_associations(owner_id, confirmed_at);
create index merchant_website_associations_listing_idx on private.merchant_website_associations(listing_id);
create index merchant_website_associations_expiry_idx on private.merchant_website_associations(expires_at);

-- Minimal request receipts deliberately survive listing/association deletion.
-- This preserves the owner quota and idempotency fence when a listing is removed.
-- No URL, fetched content, score or organization identity is stored here.
create table private.merchant_website_collections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  listing_id uuid not null, association_id uuid not null, request_key uuid not null,
  state text not null default 'queued' check (state in ('queued','running','succeeded','failed','cancelled')),
  created_at timestamptz not null default clock_timestamp(),
  deadline_at timestamptz not null default clock_timestamp()+interval '90 seconds',
  lease_token uuid, lease_until timestamptz,
  check (isfinite(created_at) and isfinite(deadline_at) and deadline_at>created_at and deadline_at<=created_at+interval '91 seconds'),
  check ((state='running' and lease_token is not null and lease_until is not null and isfinite(lease_until))
    or (state<>'running' and lease_token is null and lease_until is null)),
  unique(owner_id,request_key)
);
create index merchant_website_collections_owner_idx on private.merchant_website_collections(owner_id,created_at);
create index merchant_website_collections_resource_idx on private.merchant_website_collections(owner_id,listing_id,association_id,created_at desc);
create index merchant_website_collections_retention_idx on private.merchant_website_collections(created_at);

create table private.website_readiness_snapshots (
  id uuid primary key default gen_random_uuid(), collection_id uuid not null unique,
  owner_id uuid not null, listing_id uuid not null, association_id uuid not null, origin text not null,
  provenance text not null default 'merchant_website_snapshot' check (provenance='merchant_website_snapshot'),
  scanner_version text not null check (scanner_version='site-scan-2.1'),
  rubric_id text not null default 'nexez.website-agent-readiness' check (rubric_id='nexez.website-agent-readiness'),
  result jsonb, failure text check (failure in ('unsafe_target','robots_denied','target_unavailable','network_error','pressure_deferred')),
  evaluated_at timestamptz not null default clock_timestamp() check (isfinite(evaluated_at)),
  created_at timestamptz not null default clock_timestamp() check (isfinite(created_at)),
  source_version text not null check (source_version ~ '^sha256:[a-f0-9]{64}$'),
  check ((result is not null and failure is null) or (result is null and failure is not null)),
  foreign key (association_id,owner_id,listing_id,origin)
    references private.merchant_website_associations(id,owner_id,listing_id,origin) on delete cascade
);
create index website_readiness_snapshots_association_idx on private.website_readiness_snapshots(association_id,created_at desc);
create index website_readiness_snapshots_scope_idx on private.website_readiness_snapshots(association_id,owner_id,listing_id,origin);
create index website_readiness_snapshots_retention_idx on private.website_readiness_snapshots(created_at);

create function private.pin_merchant_website_evidence() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_table_name='website_readiness_snapshots' then
    raise exception 'website_evidence_immutable' using errcode='42501';
  end if;
  if to_jsonb(new)-'revoked_at' <> to_jsonb(old)-'revoked_at'
    or old.revoked_at is not null or new.revoked_at is null then
    raise exception 'website_evidence_immutable' using errcode='42501';
  end if;
  return new;
end $$;
create trigger pin_website_readiness_snapshot before update on private.website_readiness_snapshots
  for each row execute function private.pin_merchant_website_evidence();
create trigger pin_merchant_website_association before update on private.merchant_website_associations
  for each row execute function private.pin_merchant_website_evidence();

alter table private.merchant_website_controls enable row level security;
alter table private.merchant_website_associations enable row level security;
alter table private.merchant_website_collections enable row level security;
alter table private.website_readiness_snapshots enable row level security;
revoke all on private.merchant_website_controls, private.merchant_website_associations,
  private.merchant_website_collections, private.website_readiness_snapshots from public,anon,authenticated,service_role;

-- All commands take short locks in this order, and release them before network I/O.
-- Taking the real auth row lock also serializes account bans/deletion with a commit.
create function private.lock_merchant_website_owner(p_owner uuid,p_listing uuid,p_collection boolean)
returns text language plpgsql security definer set search_path = '' as $$
declare enabled boolean; pilot private.merchant_report_access;
begin
  select collection_enabled into enabled from private.merchant_website_controls where singleton for share;
  perform 1 from auth.users where id=p_owner and is_anonymous is not true and deleted_at is null
    and (banned_until is null or banned_until<=clock_timestamp()) for update;
  if not found then return 'not_found'; end if;
  perform 1 from public.pages where id=p_listing and owner_id=p_owner for update;
  if not found then return 'not_found'; end if;
  select * into pilot from private.merchant_report_access where owner_id=p_owner for share;
  if p_collection and (enabled is not true or pilot.enabled is not true or pilot.expires_at<=clock_timestamp()) then return 'disabled'; end if;
  return 'allowed';
end $$;

create function private.command_merchant_website(p_listing uuid,p_action text,p_origin text,p_association uuid,p_request uuid,p_attested boolean,p_approval_version text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid:=auth.uid(); permission text; a private.merchant_website_associations; j private.merchant_website_collections;
  website text; expiry timestamptz; active_count integer;
begin
  permission:=private.lock_merchant_website_owner(actor,p_listing,p_action<>'revoke');
  if permission='not_found' then raise exception 'listing_not_found' using errcode='PT404'; end if;
  if permission<>'allowed' then raise exception 'collection_disabled' using errcode='PT503'; end if;
  if p_action not in ('approve','revoke','collect') or p_action is null then raise exception 'invalid_command' using errcode='PT400'; end if;
  select website_url into website from public.pages where id=p_listing and owner_id=actor;
  if p_action='approve' then
    if p_request is null or p_association is not null or p_attested is distinct from true or p_approval_version is distinct from 'merchant-website-v1'
      or p_origin is null or p_origin is distinct from private.merchant_website_origin(p_origin)
      or p_origin is distinct from private.merchant_website_origin(website) then raise exception 'invalid_approval' using errcode='PT400'; end if;
    select * into a from private.merchant_website_associations where owner_id=actor and request_key=p_request;
    if found then
      if a.listing_id<>p_listing or a.origin<>p_origin or a.website_url_at_approval is distinct from website then raise exception 'idempotency_conflict' using errcode='PT409'; end if;
      return jsonb_build_object('id',a.id,'ownerId',actor,'listingId',p_listing);
    end if;
    if (select count(*) from private.merchant_website_associations where owner_id=actor)>=100 then raise exception 'approval_limit' using errcode='PT429'; end if;
    update private.merchant_website_associations set revoked_at=clock_timestamp() where listing_id=p_listing and revoked_at is null
      and (owner_id<>actor or expires_at<=clock_timestamp() or website_url_at_approval is distinct from website);
    if exists(select 1 from private.merchant_website_associations where listing_id=p_listing and revoked_at is null) then raise exception 'association_exists' using errcode='PT409'; end if;
    select least(expires_at,clock_timestamp()+interval '30 days') into expiry from private.merchant_report_access where owner_id=actor;
    insert into private.merchant_website_associations(owner_id,listing_id,request_key,origin,website_url_at_approval,expires_at)
      values(actor,p_listing,p_request,p_origin,website,expiry) returning * into a;
    return jsonb_build_object('id',a.id,'ownerId',actor,'listingId',p_listing);
  end if;
  if p_association is null or p_origin is not null or p_attested is not null or p_approval_version is not null
    or (p_action='revoke' and p_request is not null) or (p_action='collect' and p_request is null) then raise exception 'invalid_command' using errcode='PT400'; end if;
  select * into a from private.merchant_website_associations where id=p_association and owner_id=actor and listing_id=p_listing for update;
  if not found then raise exception 'association_not_found' using errcode='PT404'; end if;
  if p_action='revoke' then
    if a.revoked_at is null then update private.merchant_website_associations set revoked_at=clock_timestamp() where id=a.id; end if;
    update private.merchant_website_collections set state='cancelled',lease_token=null,lease_until=null where association_id=a.id and state in ('queued','running');
    return jsonb_build_object('id',a.id,'ownerId',actor,'listingId',p_listing);
  end if;
  if a.revoked_at is not null or a.expires_at<=clock_timestamp() or a.website_url_at_approval is distinct from website then raise exception 'association_changed' using errcode='PT409'; end if;
  select * into j from private.merchant_website_collections where owner_id=actor and request_key=p_request;
  if found then
    if j.listing_id<>p_listing or j.association_id<>a.id then raise exception 'idempotency_conflict' using errcode='PT409'; end if;
    return jsonb_build_object('id',j.id,'ownerId',actor,'listingId',p_listing);
  end if;
  select count(*) into active_count from private.merchant_website_collections where owner_id=actor and state in ('queued','running')
    and deadline_at>clock_timestamp() and (state='queued' or lease_until>clock_timestamp());
  if active_count>0 then raise exception 'collection_busy' using errcode='PT409'; end if;
  if (select count(*) from private.merchant_website_collections where owner_id=actor
    and created_at>=date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC')>=3 then raise exception 'daily_limit' using errcode='PT429'; end if;
  insert into private.merchant_website_collections(owner_id,listing_id,association_id,request_key) values(actor,p_listing,a.id,p_request) returning * into j;
  return jsonb_build_object('id',j.id,'ownerId',actor,'listingId',p_listing);
end $$;

create function private.claim_merchant_website_collection(p_collection uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare j private.merchant_website_collections; a private.merchant_website_associations; permission text;
begin
  select * into j from private.merchant_website_collections where id=p_collection;
  if not found then return null; end if;
  permission:=private.lock_merchant_website_owner(j.owner_id,j.listing_id,true);
  select * into a from private.merchant_website_associations where id=j.association_id and owner_id=j.owner_id and listing_id=j.listing_id for update;
  select * into j from private.merchant_website_collections where id=p_collection for update;
  if not found or j.state<>'queued' then return null; end if;
  if permission<>'allowed' or a.id is null or a.revoked_at is not null or a.expires_at<=clock_timestamp() or j.deadline_at<=clock_timestamp()
    or a.website_url_at_approval is distinct from (select website_url from public.pages where id=j.listing_id and owner_id=j.owner_id) then
    update private.merchant_website_collections set state='cancelled' where id=j.id; return null;
  end if;
  update private.merchant_website_collections set state='running',lease_token=gen_random_uuid(),lease_until=least(deadline_at,clock_timestamp()+interval '45 seconds')
    where id=j.id returning * into j;
  return jsonb_build_object('id',j.id,'ownerId',j.owner_id,'listingId',j.listing_id,'associationId',a.id,'origin',a.origin,'leaseToken',j.lease_token);
end $$;

create function private.complete_merchant_website_collection(p_collection uuid,p_token uuid,p_result jsonb,p_failure text,p_scanner_version text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare j private.merchant_website_collections; a private.merchant_website_associations; permission text; evaluated timestamptz; fingerprint text;
begin
  select * into j from private.merchant_website_collections where id=p_collection;
  if not found then return false; end if;
  permission:=private.lock_merchant_website_owner(j.owner_id,j.listing_id,true);
  select * into a from private.merchant_website_associations where id=j.association_id and owner_id=j.owner_id and listing_id=j.listing_id for update;
  select * into j from private.merchant_website_collections where id=p_collection for update;
  if not found or j.state<>'running' or j.lease_token is distinct from p_token then return false; end if;
  if permission<>'allowed' or a.id is null or a.revoked_at is not null or a.expires_at<=clock_timestamp()
    or j.deadline_at<=clock_timestamp() or j.lease_until<=clock_timestamp()
    or a.website_url_at_approval is distinct from (select website_url from public.pages where id=j.listing_id and owner_id=j.owner_id) then
    update private.merchant_website_collections set state='cancelled',lease_token=null,lease_until=null where id=j.id; return false;
  end if;
  if p_scanner_version is distinct from 'site-scan-2.1' then raise exception 'invalid_scanner'; end if;
  if p_result is not null then
    if p_failure is not null or jsonb_typeof(p_result)<>'object' or octet_length(p_result::text)>8192
      or p_result-array['version','score','checks']<>'{}'::jsonb or p_result->'version' is distinct from '2'::jsonb
      or jsonb_typeof(p_result->'score') is distinct from 'number' or (p_result->>'score')::numeric not between 0 and 100
      or jsonb_typeof(p_result->'checks') is distinct from 'array' then raise exception 'invalid_scan_result'; end if;
    if jsonb_array_length(p_result->'checks')<>18 or (select count(distinct c->>'id') from jsonb_array_elements(p_result->'checks') c)<>18
      or exists(select 1 from jsonb_array_elements(p_result->'checks') c where jsonb_typeof(c)<>'object' or c-array['id','status']<>'{}'::jsonb
        or c->>'id' is null or c->>'id' not in ('reachable','speed','robots','agent_docs','llms_txt','semantics','jsonld','business_identity','offer_schema','pricing','action_path','availability','offer_details','structured_action','https','contact','policies','freshness')
        or c->>'status' is null or c->>'status' not in ('pass','warn','fail')) then raise exception 'invalid_scan_checks'; end if;
  elsif p_failure is null or p_failure not in ('unsafe_target','robots_denied','target_unavailable','network_error','pressure_deferred') then raise exception 'invalid_scan_failure'; end if;
  evaluated:=clock_timestamp();
  fingerprint:='sha256:'||encode(sha256(convert_to(jsonb_build_object('owner',j.owner_id,'listing',j.listing_id,'association',a.id,'origin',a.origin,
    'collection',j.id,'evaluatedAt',evaluated,'scanner',p_scanner_version,'rubric','nexez.website-agent-readiness','result',p_result,'failure',p_failure)::text,'UTF8')),'hex');
  insert into private.website_readiness_snapshots(collection_id,owner_id,listing_id,association_id,origin,scanner_version,result,failure,evaluated_at,source_version)
    values(j.id,j.owner_id,j.listing_id,a.id,a.origin,p_scanner_version,p_result,p_failure,evaluated,fingerprint);
  update private.merchant_website_collections set state=case when p_result is null then 'failed' else 'succeeded' end,lease_token=null,lease_until=null where id=j.id;
  return true;
end $$;

create function private.read_merchant_website_baseline(p_listing uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare actor uuid:=auth.uid(); website text; enabled boolean; a private.merchant_website_associations; s private.website_readiness_snapshots; j private.merchant_website_collections;
begin
  if actor is null or not exists(select 1 from auth.users where id=actor and is_anonymous is not true and deleted_at is null
    and (banned_until is null or banned_until<=statement_timestamp())) then return null; end if;
  select website_url into website from public.pages where id=p_listing and owner_id=actor;
  if not found then return null; end if;
  enabled:=exists(select 1 from private.merchant_report_access p where p.owner_id=actor and p.enabled and p.expires_at>statement_timestamp());
  if enabled then
    select * into a from private.merchant_website_associations where listing_id=p_listing and owner_id=actor and revoked_at is null
      and expires_at>statement_timestamp() and website_url_at_approval=website;
    select * into s from private.website_readiness_snapshots where association_id=a.id and owner_id=actor and listing_id=p_listing
      and created_at>statement_timestamp()-interval '30 days' order by created_at desc,id desc limit 1;
    select * into j from private.merchant_website_collections where association_id=a.id and owner_id=actor and listing_id=p_listing order by created_at desc,id desc limit 1;
  end if;
  return jsonb_build_object('ownerId',actor,'listingId',p_listing,'collectionEnabled',enabled and coalesce((select collection_enabled from private.merchant_website_controls where singleton),false),
    'suggestedOrigin',private.merchant_website_origin(website),
    'association',case when a.id is null then null else jsonb_build_object('id',a.id,'origin',a.origin,'method',a.method,'confirmedAt',a.confirmed_at,'expiresAt',a.expires_at) end,
    'latest',case when s.id is null then null else jsonb_build_object('id',s.id,'associationId',s.association_id,'origin',s.origin,'associationMethod',a.method,
      'scannerVersion',s.scanner_version,'rubricId',s.rubric_id,'provenance',s.provenance,'evaluatedAt',s.evaluated_at,'createdAt',s.created_at,'sourceVersion',s.source_version,'result',s.result,'failure',s.failure) end,
    'attempt',case when j.id is null then null else jsonb_build_object('id',j.id,'state',case when j.state in ('queued','running') and
      (j.deadline_at<=statement_timestamp() or (j.state='running' and j.lease_until<=statement_timestamp())) then 'expired' else j.state end) end);
end $$;

-- Keep the previous RPC stable for older application deployments. Both reads
-- below share the calling statement snapshot, including all current authority.
create function private.read_merchant_report_with_website(p_listing_id uuid,p_month date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare report jsonb; website jsonb;
begin
  report:=private.read_merchant_report_inputs(p_listing_id,p_month);
  if report is null then return null; end if;
  website:=private.read_merchant_website_baseline(p_listing_id);
  return report||jsonb_build_object('websiteSnapshot',website->'latest');
end $$;

create function private.cleanup_merchant_website_baselines() returns integer
language plpgsql security definer set search_path = '' as $$
declare removed integer;
begin
  delete from private.website_readiness_snapshots where id in (select id from private.website_readiness_snapshots where created_at<clock_timestamp()-interval '30 days' order by created_at limit 100);
  get diagnostics removed=row_count;
  delete from private.merchant_website_collections where id in (select id from private.merchant_website_collections where created_at<clock_timestamp()-interval '30 days' order by created_at limit 100);
  delete from private.merchant_website_associations where id in (select id from private.merchant_website_associations where expires_at<clock_timestamp()-interval '30 days' order by expires_at limit 100);
  return removed;
end $$;

create function public.command_merchant_website(p_listing uuid,p_action text,p_origin text,p_association uuid,p_request uuid,p_attested boolean,p_approval_version text)
returns jsonb language sql security invoker set search_path = '' as $$ select private.command_merchant_website(p_listing,p_action,p_origin,p_association,p_request,p_attested,p_approval_version); $$;
create function public.read_merchant_website_baseline(p_listing uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$ select private.read_merchant_website_baseline(p_listing); $$;
create function public.read_merchant_report_with_website(p_listing_id uuid,p_month date) returns jsonb
language sql stable security invoker set search_path = '' as $$ select private.read_merchant_report_with_website(p_listing_id,p_month); $$;
create function public.claim_merchant_website_collection(p_collection uuid) returns jsonb
language sql security invoker set search_path = '' as $$ select private.claim_merchant_website_collection(p_collection); $$;
create function public.complete_merchant_website_collection(p_collection uuid,p_token uuid,p_result jsonb,p_failure text,p_scanner_version text) returns boolean
language sql security invoker set search_path = '' as $$ select private.complete_merchant_website_collection(p_collection,p_token,p_result,p_failure,p_scanner_version); $$;
create function public.cleanup_merchant_website_baselines() returns integer
language sql security invoker set search_path = '' as $$ select private.cleanup_merchant_website_baselines(); $$;

do $$ declare f record; begin
  for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private') and p.proname in ('merchant_website_origin','pin_merchant_website_evidence','lock_merchant_website_owner',
      'command_merchant_website','read_merchant_website_baseline','read_merchant_report_with_website','claim_merchant_website_collection','complete_merchant_website_collection','cleanup_merchant_website_baselines') loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  end loop;
end $$;
grant usage on schema private to authenticated,service_role;
grant execute on function private.command_merchant_website(uuid,text,text,uuid,uuid,boolean,text), public.command_merchant_website(uuid,text,text,uuid,uuid,boolean,text),
  private.read_merchant_website_baseline(uuid),public.read_merchant_website_baseline(uuid),private.read_merchant_report_with_website(uuid,date),public.read_merchant_report_with_website(uuid,date) to authenticated;
grant execute on function private.claim_merchant_website_collection(uuid),public.claim_merchant_website_collection(uuid),
  private.complete_merchant_website_collection(uuid,uuid,jsonb,text,text),public.complete_merchant_website_collection(uuid,uuid,jsonb,text,text),
  private.cleanup_merchant_website_baselines(),public.cleanup_merchant_website_baselines() to service_role;

commit;

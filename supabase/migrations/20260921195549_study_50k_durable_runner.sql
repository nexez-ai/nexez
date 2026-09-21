-- A separate, opt-in research cohort. No job is scheduled by this migration.
-- Old study rows and interactive scanner behavior are preserved.
begin;

create table public.study_runs (
  cohort text primary key check (cohort ~ '^[a-z0-9-]{3,80}$'),
  created_at timestamptz not null default clock_timestamp(),
  state text not null default 'preparing' check (state in
    ('preparing','pilot','pilot_review','running','paused','completed','exhausted')),
  target_successes integer not null default 50000 check (target_successes between 1 and 50000),
  success_limit integer not null default 500 check (success_limit between 1 and target_successes),
  max_attempts integer not null default 1500 check (max_attempts between 1 and 75000),
  attempts_reserved integer not null default 0 check (attempts_reserved >= 0),
  max_dispatches integer not null default 500 check (max_dispatches between 1 and 14000),
  dispatches integer not null default 0 check (dispatches >= 0),
  budget_cents integer not null default 10000 check (budget_cents between 1 and 10000),
  other_cost_reserve_cents integer not null default 3000 check (other_cost_reserve_cents >= 0),
  -- USD 0.005 reserved per dispatch, roughly twice the full 60s compute model.
  -- This is NOT a provider billing cap. Pilot usage must be reviewed separately.
  dispatch_cost_microusd integer not null default 5000 check (dispatch_cost_microusd >= 5000),
  deadline_at timestamptz not null default clock_timestamp() + interval '21 days',
  source_manifest jsonb not null default '{}'::jsonb check (octet_length(source_manifest::text) <= 16384),
  source_frozen_at timestamptz,
  last_dispatch_at timestamptz,
  stop_reason text,
  check (other_cost_reserve_cents < budget_cents)
);

create table public.study_run_targets (
  id uuid primary key default gen_random_uuid(),
  cohort text not null references public.study_runs(cohort),
  domain_key text not null check (domain_key ~ '^[a-z0-9.-]{3,253}$'),
  url text not null check (url ~ '^https?://[a-z0-9.-]+$' and char_length(url) <= 263),
  vertical text not null check (vertical in ('restaurants','health','home_trades','personal_care','retail')),
  region text not null check (region ~ '^[A-Z]{2}$'),
  source_ref text not null check (char_length(source_ref) between 1 and 160),
  sample_rank text not null check (sample_rank ~ '^[a-f0-9]{64}$'),
  state text not null default 'queued' check (state in ('queued','running','succeeded','failed','robots_excluded','duplicate')),
  attempts integer not null default 0 check (attempts between 0 and 3),
  lease_token uuid,
  lease_until timestamptz,
  available_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  failure_code text check (failure_code in ('network_error','pressure_deferred','unsafe_target','target_unavailable','attempts_exhausted','robots_denied','duplicate_final_domain')),
  elapsed_ms integer not null default 0 check (elapsed_ms between 0 and 60000),
  bytes_read integer not null default 0 check (bytes_read between 0 and 4194304),
  probe_count integer not null default 0 check (probe_count between 0 and 40),
  unique (cohort, domain_key),
  unique (cohort, id),
  check ((state = 'running' and lease_token is not null and lease_until is not null)
    or (state <> 'running' and lease_token is null and lease_until is null))
);
create index study_run_targets_claim_idx on public.study_run_targets(cohort,available_at,sample_rank) where state='queued';
create index study_run_targets_active_idx on public.study_run_targets(cohort,lease_until) where state='running';
create index study_run_targets_lease_idx on public.study_run_targets(lease_token) where lease_token is not null;
create index study_run_targets_state_idx on public.study_run_targets(cohort,state);

create table public.study_run_results (
  target_id uuid primary key,
  cohort text not null references public.study_runs(cohort),
  final_domain_hash text not null check (final_domain_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  metrics jsonb not null check (jsonb_typeof(metrics)='object' and octet_length(metrics::text) <= 8192
    and not (metrics ?| array['domain','url','pageText','html','email','phone'])),
  unique (cohort, final_domain_hash),
  foreign key (cohort,target_id) references public.study_run_targets(cohort,id)
);

create table public.study_run_dispatches (
  id uuid primary key default gen_random_uuid(),
  cohort text not null references public.study_runs(cohort),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default clock_timestamp() + interval '90 seconds',
  claimed_at timestamptz,
  finished_at timestamptz,
  request_id bigint,
  outcome text
);
create index study_run_dispatches_active_idx on public.study_run_dispatches(cohort,expires_at) where finished_at is null;

-- Frozen frames cannot be edited, including by application bugs after launch.
create function public.guard_study_run_frame() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_op='UPDATE' and (new.cohort,new.domain_key,new.url,new.vertical,new.region,new.source_ref,new.sample_rank)
    is not distinct from (old.cohort,old.domain_key,old.url,old.vertical,old.region,old.source_ref,old.sample_rank) then return new; end if;
  perform 1 from public.study_runs where cohort=new.cohort and state='preparing' and source_frozen_at is null for update;
  if not found then raise exception 'study_frame_frozen'; end if;
  return new;
end $$;
create trigger study_run_frame_guard before insert or update on public.study_run_targets
  for each row execute function public.guard_study_run_frame();

create function public.claim_study_run_batch(p_cohort text,p_dispatch uuid)
returns setof public.study_run_targets language plpgsql set search_path='' as $$
declare r public.study_runs; remaining integer; active integer; succeeded integer; claimed integer;
begin
  select * into r from public.study_runs where cohort=p_cohort for update;
  if not found or r.state not in ('pilot','running') or r.source_frozen_at is null
    or not exists(select 1 from public.study_control where key='research' and enabled) then return; end if;
  if r.deadline_at<=clock_timestamp() then
    update public.study_runs set state='paused',stop_reason='deadline' where cohort=p_cohort; return;
  end if;
  update public.study_run_dispatches set claimed_at=clock_timestamp()
    where id=p_dispatch and cohort=p_cohort and claimed_at is null and finished_at is null and expires_at>clock_timestamp();
  if not found then return; end if;
  update public.study_run_targets set state=case when attempts>=3 then 'failed' else 'queued' end,
    failure_code=case when attempts>=3 then 'attempts_exhausted' else 'network_error' end,
    lease_token=null,lease_until=null,available_at=clock_timestamp(),
    finished_at=case when attempts>=3 then clock_timestamp() else null end
    where cohort=p_cohort and state='running' and lease_until<=clock_timestamp();
  select count(*) into succeeded from public.study_run_results where cohort=p_cohort;
  select count(*) into active from public.study_run_targets where cohort=p_cohort and state='running';
  remaining := least(6,r.success_limit-succeeded-active,r.max_attempts-r.attempts_reserved);
  if remaining<=0 then
    if succeeded>=r.success_limit then
      update public.study_runs set state=case when success_limit>=target_successes then 'completed' else 'pilot_review' end,
        stop_reason='success_limit' where cohort=p_cohort;
    elsif r.attempts_reserved>=r.max_attempts and active=0 then
      update public.study_runs set state='paused',stop_reason='attempt_limit' where cohort=p_cohort;
    end if;
    return;
  end if;
  return query update public.study_run_targets t set state='running',attempts=t.attempts+1,
    lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '75 seconds',failure_code=null
    where t.id in (select id from public.study_run_targets where cohort=p_cohort and state='queued'
      and attempts<3 and available_at<=clock_timestamp() order by sample_rank,id limit remaining for update skip locked)
    returning t.*;
  get diagnostics claimed=row_count;
  update public.study_runs set attempts_reserved=attempts_reserved+claimed where cohort=p_cohort;
  if claimed=0 and active=0 and not exists(select 1 from public.study_run_targets where cohort=p_cohort and state='queued') then
    update public.study_runs set state='exhausted',stop_reason='frame_exhausted' where cohort=p_cohort;
  end if;
end $$;

create function public.finish_study_run_target(p_cohort text,p_target uuid,p_lease uuid,
  p_metrics jsonb,p_domain_hash text,p_failure text,p_ms integer,p_bytes integer,p_probes integer)
returns boolean language plpgsql set search_path='' as $$
declare r public.study_runs; t public.study_run_targets; final_state text; inserted integer;
begin
  select * into r from public.study_runs where cohort=p_cohort for update;
  select * into t from public.study_run_targets where id=p_target and cohort=p_cohort for update;
  if not found or t.state<>'running' or t.lease_token is distinct from p_lease or t.lease_until<=clock_timestamp() then return false; end if;
  if p_metrics is not null then
    if p_failure is not null or jsonb_typeof(p_metrics)<>'object' or octet_length(p_metrics::text)>8192
      or p_domain_hash is null or p_domain_hash !~ '^[a-f0-9]{64}$'
      or not (p_metrics @> '{"source":"study"}'::jsonb)
      or coalesce((p_metrics->>'http_status')::integer,0) not between 200 and 299
      or coalesce((p_metrics->>'score')::integer,-1) not between 0 and 100
      or coalesce((p_metrics->>'scanner_version')::integer,0)<>2
      or exists(select 1 from jsonb_object_keys(p_metrics) k where k not in
        ('source','study_cohort','vertical','scanner_version','score','dimension_scores','elapsed_ms','http_status','response_ms','https',
        'has_title','has_meta_description','has_h1','has_json_ld','valid_json_ld','schema_types','has_business_identity',
        'has_offer_schema','has_structured_price','has_visible_price','has_action_path','has_structured_action',
        'has_structured_availability','has_visible_availability','has_offer_details','has_contact','has_policies',
        'has_freshness_signal','agent_json_ok','well_known_agent_json_ok','well_known_agent_card_ok','mcp_json_ok',
        'open_api_json_ok','llms_txt_ok','robots','blocked_bot_count')) then raise exception 'invalid_study_metrics'; end if;
    insert into public.study_run_results(target_id,cohort,final_domain_hash,metrics)
      values(t.id,t.cohort,p_domain_hash,p_metrics||jsonb_build_object('study_cohort',t.cohort,'vertical',t.vertical))
      on conflict do nothing;
    get diagnostics inserted=row_count;
    final_state := case when inserted=1 then 'succeeded' else 'duplicate' end;
  else
    if p_failure is null or p_failure not in ('network_error','pressure_deferred','unsafe_target','target_unavailable','robots_denied') then
      raise exception 'invalid_study_failure'; end if;
    final_state := case when p_failure='robots_denied' then 'robots_excluded'
      when p_failure in ('network_error','pressure_deferred') and t.attempts<3 then 'queued' else 'failed' end;
  end if;
  update public.study_run_targets set state=final_state,lease_token=null,lease_until=null,
    available_at=clock_timestamp()+case when final_state='queued' then interval '5 minutes'*t.attempts else interval '0' end,
    finished_at=case when final_state='queued' then null else clock_timestamp() end,
    failure_code=case when final_state='duplicate' then 'duplicate_final_domain' else p_failure end,
    elapsed_ms=least(60000,greatest(0,coalesce(p_ms,0))),bytes_read=least(4194304,greatest(0,coalesce(p_bytes,0))),
    probe_count=least(40,greatest(0,coalesce(p_probes,0))) where id=t.id;
  if (select count(*) from public.study_run_results where cohort=p_cohort)>=r.success_limit then
    update public.study_runs set state=case when success_limit>=target_successes then 'completed' else 'pilot_review' end,
      stop_reason='success_limit' where cohort=p_cohort;
  end if;
  return true;
end $$;

-- The existing limiter still owns domain, denylist and global capacity checks.
-- Research adds a lower-priority sublimit, without modifying its public behavior.
create function private.acquire_study_network_slot(p_domain text,p_token uuid)
returns text language plpgsql security definer set search_path='' as $$
declare capacity integer;
begin
  select max_concurrent into capacity from private.scan_network_controls where singleton and enabled for update;
  if capacity is null or not exists(select 1 from public.study_run_targets t join public.study_runs r using(cohort)
    where t.lease_token=p_token and t.state='running' and t.lease_until>clock_timestamp()
    and r.state in ('pilot','running') and r.deadline_at>clock_timestamp())
    or not exists(select 1 from public.study_control where key='research' and enabled) then return 'denied'; end if;
  if not exists(select 1 from private.scan_network_leases where token=p_token and expires_at>clock_timestamp()) then
    if (select count(distinct token) from private.scan_network_leases where expires_at>clock_timestamp())>=greatest(capacity-3,0)
      or (select count(distinct l.token) from private.scan_network_leases l join public.study_run_targets t on t.lease_token=l.token
        where l.expires_at>clock_timestamp() and t.state='running')>=3 then return 'busy'; end if;
  end if;
  return public.acquire_scan_network_slot(p_domain,p_token,null);
end $$;
create function public.acquire_study_network_slot(p_domain text,p_token uuid)
returns text language sql security definer set search_path='' as $$ select private.acquire_study_network_slot(p_domain,p_token); $$;

create function public.study_run_status(p_cohort text) returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('cohort',r.cohort,'state',r.state,'successLimit',r.success_limit,'targetSuccesses',r.target_successes,
    'attemptsReserved',r.attempts_reserved,'maxAttempts',r.max_attempts,'dispatches',r.dispatches,'maxDispatches',r.max_dispatches,
    'budgetCents',r.budget_cents,'reservedEstimateCents',r.other_cost_reserve_cents+r.dispatches*r.dispatch_cost_microusd/10000.0,
    'sourceFrozenAt',r.source_frozen_at,'deadlineAt',r.deadline_at,'stopReason',r.stop_reason,
    'targets',coalesce((select jsonb_object_agg(state,n) from (select state,count(*) n from public.study_run_targets where cohort=p_cohort group by state) c),'{}'::jsonb),
    'results',(select count(*) from public.study_run_results where cohort=p_cohort),
    'byVertical',coalesce((select jsonb_object_agg(vertical,n) from (select t.vertical,count(*) n from public.study_run_results s join public.study_run_targets t on s.target_id=t.id where s.cohort=p_cohort group by t.vertical) c),'{}'::jsonb),
    'lastDispatchAt',r.last_dispatch_at)
  from public.study_runs r where r.cohort=p_cohort;
$$;

-- Only the postgres-owned scheduler can dispatch. Bearer secret stays in Vault,
-- never in cron.job.command, source control, application logs, or status output.
create function public.dispatch_readiness_study(p_cohort text) returns text
language plpgsql set search_path='' as $$
declare r public.study_runs; dispatch_id uuid; new_request_id bigint; bearer text;
begin
  select * into r from public.study_runs where cohort=p_cohort for update;
  if not found or r.state not in ('pilot','running') or r.source_frozen_at is null
    or not exists(select 1 from public.study_control where key='research' and enabled) then return 'inactive'; end if;
  if r.deadline_at<=clock_timestamp() or r.dispatches>=r.max_dispatches
    or r.other_cost_reserve_cents*10000+(r.dispatches+1)::bigint*r.dispatch_cost_microusd>r.budget_cents::bigint*10000 then
    update public.study_runs set state='paused',stop_reason='dispatch_budget_or_deadline' where cohort=p_cohort; return 'paused'; end if;
  if r.last_dispatch_at>clock_timestamp()-interval '55 seconds'
    or exists(select 1 from public.study_run_dispatches where cohort=p_cohort and finished_at is null and expires_at>clock_timestamp()) then return 'busy'; end if;
  if not exists(select 1 from public.study_run_targets where cohort=p_cohort and
      ((state='queued' and available_at<=clock_timestamp()) or (state='running' and lease_until<=clock_timestamp()))) then
    if not exists(select 1 from public.study_run_targets where cohort=p_cohort and state in ('queued','running')) then
      update public.study_runs set state=case when (select count(*) from public.study_run_results where cohort=p_cohort)>=r.success_limit
        then case when r.success_limit>=r.target_successes then 'completed' else 'pilot_review' end else 'exhausted' end,
        stop_reason='no_remaining_targets' where cohort=p_cohort;
      return 'finished';
    end if;
    return 'cooldown';
  end if;
  update public.study_run_dispatches set finished_at=clock_timestamp(),outcome='lease_expired'
    where cohort=p_cohort and finished_at is null and expires_at<=clock_timestamp();
  -- Stop repeated infrastructure failures instead of consuming the whole budget.
  if (select count(*) from (select outcome from public.study_run_dispatches where cohort=p_cohort
      order by created_at desc limit 5) d where outcome='lease_expired')=5 then
    update public.study_runs set state='paused',stop_reason='five_dispatch_failures' where cohort=p_cohort; return 'paused'; end if;
  select decrypted_secret into bearer from vault.decrypted_secrets where name='nexez_readiness_research_bearer';
  if bearer is null then return 'missing_secret'; end if;
  insert into public.study_run_dispatches(cohort) values(p_cohort) returning id into dispatch_id;
  select net.http_post(url:='https://app.nexez.ai/api/internal/readiness-research',
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||bearer),
    body:=jsonb_build_object('action','tick','cohort',p_cohort,'dispatchId',dispatch_id),timeout_milliseconds:=58000) into new_request_id;
  update public.study_run_dispatches set request_id=new_request_id where id=dispatch_id;
  update public.study_runs set dispatches=dispatches+1,last_dispatch_at=clock_timestamp() where cohort=p_cohort;
  return 'dispatched';
end $$;

alter table public.study_runs enable row level security;
alter table public.study_run_targets enable row level security;
alter table public.study_run_results enable row level security;
alter table public.study_run_dispatches enable row level security;
revoke all on public.study_runs,public.study_run_targets,public.study_run_results,public.study_run_dispatches from public,anon,authenticated,service_role;
grant select,update on public.study_runs to service_role;
grant select,insert,update on public.study_run_targets,public.study_run_dispatches to service_role;
grant select,insert on public.study_run_results to service_role;
revoke all on function public.guard_study_run_frame(),public.claim_study_run_batch(text,uuid),
  public.finish_study_run_target(text,uuid,uuid,jsonb,text,text,integer,integer,integer),
  public.acquire_study_network_slot(text,uuid),private.acquire_study_network_slot(text,uuid),
  public.study_run_status(text),public.dispatch_readiness_study(text) from public,anon,authenticated,service_role;
grant execute on function public.claim_study_run_batch(text,uuid),
  public.finish_study_run_target(text,uuid,uuid,jsonb,text,text,integer,integer,integer),
  public.acquire_study_network_slot(text,uuid),
  public.study_run_status(text) to service_role;
commit;

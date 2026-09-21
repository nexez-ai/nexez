-- Keep prior observations intact. New validation requires a separately frozen
-- protocol-2 cohort. This migration never starts a scan or raises a run's cap.
begin;
set local lock_timeout = '5s';

alter table public.study_runs add column research_protocol_version integer not null default 1
  check (research_protocol_version in (1,2));
alter table public.study_runs drop constraint study_runs_target_successes_check;
alter table public.study_runs add constraint study_runs_target_successes_check
  check (target_successes between 1 and 100000);

create function public.guard_study_run_protocol() returns trigger
language plpgsql set search_path='' as $$
begin
  if old.source_frozen_at is not null and new.research_protocol_version<>old.research_protocol_version then
    raise exception 'study_protocol_frozen';
  end if;
  return new;
end $$;
create trigger study_run_protocol_guard before update on public.study_runs
  for each row execute function public.guard_study_run_protocol();
revoke all on function public.guard_study_run_protocol() from public,anon,authenticated,service_role;

alter table public.study_run_targets drop constraint study_run_targets_failure_code_check;
alter table public.study_run_targets add constraint study_run_targets_failure_code_check
  check (failure_code in ('network_error','pressure_deferred','unsafe_target','target_unavailable',
    'attempts_exhausted','robots_denied','duplicate_final_domain','non_html','insufficient_content',
    'challenge_page','parked_domain','unavailable_page','excluded_destination'));

create or replace function public.finish_study_run_target(p_cohort text,p_target uuid,p_lease uuid,
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
      or coalesce((p_metrics->>'research_protocol_version')::integer,1)<>r.research_protocol_version
      or exists(select 1 from jsonb_object_keys(p_metrics) k where k not in
        ('source','study_cohort','vertical','scanner_version','research_protocol_version','score','dimension_scores','elapsed_ms','http_status','response_ms','https',
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
    if p_failure is null or p_failure not in ('network_error','pressure_deferred','unsafe_target','target_unavailable','robots_denied',
      'non_html','insufficient_content','challenge_page','parked_domain','unavailable_page','excluded_destination') then
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

create or replace function public.study_run_status(p_cohort text) returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('cohort',r.cohort,'state',r.state,'researchProtocolVersion',r.research_protocol_version,
    'successLimit',r.success_limit,'targetSuccesses',r.target_successes,
    'attemptsReserved',r.attempts_reserved,'maxAttempts',r.max_attempts,'dispatches',r.dispatches,'maxDispatches',r.max_dispatches,
    'budgetCents',r.budget_cents,'reservedEstimateCents',r.other_cost_reserve_cents+r.dispatches*r.dispatch_cost_microusd/10000.0,
    'sourceFrozenAt',r.source_frozen_at,'deadlineAt',r.deadline_at,'stopReason',r.stop_reason,
    'targets',coalesce((select jsonb_object_agg(state,n) from (select state,count(*) n from public.study_run_targets where cohort=p_cohort group by state) c),'{}'::jsonb),
    'results',(select count(*) from public.study_run_results where cohort=p_cohort),
    'byVertical',coalesce((select jsonb_object_agg(vertical,n) from (select t.vertical,count(*) n from public.study_run_results s join public.study_run_targets t on s.target_id=t.id where s.cohort=p_cohort group by t.vertical) c),'{}'::jsonb),
    'lastDispatchAt',r.last_dispatch_at)
  from public.study_runs r where r.cohort=p_cohort;
$$;
commit;

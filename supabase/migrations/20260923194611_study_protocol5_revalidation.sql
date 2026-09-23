-- Uniform revalidation of an audit-only predecessor. No run is created or started.
begin;
set local lock_timeout='5s';

alter table public.study_runs drop constraint study_runs_research_protocol_version_check;
alter table public.study_runs add constraint study_runs_research_protocol_version_check
  check (research_protocol_version in (1,2,3,4,5));
alter table public.study_runs add column revalidates_cohort text references public.study_runs(cohort),
  add constraint study_revalidation_root_only check (
    revalidates_cohort is null or (revalidates_cohort<>cohort and continued_from is null));
create unique index study_one_revalidation_idx on public.study_runs(revalidates_cohort)
  where revalidates_cohort is not null;
alter table public.study_run_targets add column revalidates_target_id uuid references public.study_run_results(target_id);
create unique index study_revalidation_target_idx on public.study_run_targets(revalidates_target_id)
  where revalidates_target_id is not null;

create function public.guard_study_revalidation_run() returns trigger
language plpgsql set search_path='' as $$
declare parent public.study_runs; carried_cents bigint; expected bigint;
begin
  if tg_op='UPDATE' then
    if new.revalidates_cohort is distinct from old.revalidates_cohort then
      raise exception 'study_revalidation_immutable';
    end if;
    if exists(select 1 from public.study_runs where revalidates_cohort=old.cohort)
      and new is distinct from old then raise exception 'study_revalidation_predecessor_closed'; end if;
  end if;
  if new.research_protocol_version=5 and new.continued_from is null and new.revalidates_cohort is null then
    raise exception 'study_revalidation_lineage_required';
  end if;
  if new.revalidates_cohort is null then return new; end if;
  select * into parent from public.study_runs where cohort=new.revalidates_cohort for update;
  if not found or new.research_protocol_version<>5 or parent.research_protocol_version<>4
    or parent.state<>'paused' or parent.stop_reason<>'quality_gate_failed_protocol_4_templates'
    or parent.source_frozen_at is null or parent.continued_from is not null
    or parent.revalidates_cohort is not null or new.hash_identity_fingerprint is null
    or exists(select 1 from public.study_runs where continued_from=parent.cohort)
    or exists(select 1 from public.study_run_targets where cohort=parent.cohort and state='running')
    or exists(select 1 from public.study_run_dispatches where cohort=parent.cohort
      and finished_at is null and expires_at>clock_timestamp()) then
    raise exception 'study_revalidation_predecessor_not_ready';
  end if;
  if tg_op='INSERT' and (new.state<>'preparing' or new.source_frozen_at is not null
    or new.attempts_reserved<>0 or new.dispatches<>0 or new.dispatch_reserved_microusd<>0) then
    raise exception 'study_revalidation_initialization';
  end if;
  carried_cents := parent.other_cost_reserve_cents+(parent.dispatch_reserved_microusd+9999)/10000;
  if new.other_cost_reserve_cents<carried_cents or new.budget_cents>parent.budget_cents
    or new.deadline_at>parent.deadline_at then raise exception 'study_revalidation_budget_carry'; end if;
  if new.source_manifest->>'sourceJsonlSha256' is null
    or new.source_manifest->>'mappingSha256' is null
    or new.source_manifest->>'selectionSeedCohort' is null
    or new.source_manifest->>'targetsSha256' !~ '^[a-f0-9]{64}$'
    or new.source_manifest->>'targetsSha256' is null
    or (new.source_manifest->>'sourceJsonlSha256',new.source_manifest->>'mappingSha256',new.source_manifest->>'selectionSeedCohort')
      is distinct from (parent.source_manifest->>'sourceJsonlSha256',parent.source_manifest->>'mappingSha256',parent.source_manifest->>'selectionSeedCohort')
    or new.source_manifest->>'parentTargetsSha256' is distinct from
      coalesce(parent.source_manifest->>'parentTargetsSha256',parent.source_manifest->>'targetsSha256')
    or new.source_manifest->>'revalidatesCohort' is distinct from parent.cohort then
    raise exception 'study_revalidation_source_mismatch';
  end if;
  if tg_op='UPDATE' and old.source_frozen_at is null and new.source_frozen_at is not null then
    select count(*) into expected from public.study_run_results where cohort=parent.cohort;
    if expected=0 or expected<>(select count(*) from public.study_run_targets where cohort=new.cohort)
      or exists(select 1 from public.study_run_targets where cohort=new.cohort and revalidates_target_id is null) then
      raise exception 'study_revalidation_incomplete';
    end if;
  end if;
  if new.state in ('pilot','running') and new.source_frozen_at is null then
    raise exception 'study_revalidation_unfrozen';
  end if;
  return new;
end $$;
create trigger study_revalidation_run_guard before insert or update on public.study_runs
  for each row execute function public.guard_study_revalidation_run();
revoke all on function public.guard_study_revalidation_run() from public,anon,authenticated,service_role;

create function public.guard_study_revalidation_target() returns trigger
language plpgsql set search_path='' as $$
declare r public.study_runs; original public.study_run_targets;
begin
  if tg_op in ('UPDATE','DELETE') then
    if exists(select 1 from public.study_runs where revalidates_cohort=old.cohort) then
      raise exception 'study_revalidation_predecessor_closed';
    end if;
    if tg_op='DELETE' then
      if exists(select 1 from public.study_runs where cohort=old.cohort and revalidates_cohort is not null
        and source_frozen_at is not null) then raise exception 'study_revalidation_frame_frozen'; end if;
      return old;
    end if;
    if (new.id,new.revalidates_target_id) is distinct from (old.id,old.revalidates_target_id) then
      raise exception 'study_revalidation_target_immutable';
    end if;
  end if;
  select * into r from public.study_runs where cohort=new.cohort for update;
  if r.revalidates_cohort is null then
    if new.revalidates_target_id is not null then raise exception 'study_revalidation_target_mismatch'; end if;
    return new;
  end if;
  select t.* into original from public.study_run_targets t
    join public.study_run_results s on s.target_id=t.id and s.cohort=t.cohort
    where s.cohort=r.revalidates_cohort and t.id=new.revalidates_target_id;
  if not found or (new.domain_key,new.url,new.vertical,new.region,new.source_ref,new.sample_rank)
    is distinct from (original.domain_key,original.url,original.vertical,original.region,original.source_ref,original.sample_rank) then
    raise exception 'study_revalidation_target_mismatch';
  end if;
  if tg_op='INSERT' and (new.state<>'queued' or new.attempts<>0 or new.lease_token is not null
    or new.lease_until is not null or new.finished_at is not null or new.failure_code is not null
    or new.elapsed_ms<>0 or new.bytes_read<>0 or new.probe_count<>0) then
    raise exception 'study_revalidation_target_initialization';
  end if;
  return new;
end $$;
create trigger study_revalidation_target_guard before insert or update or delete on public.study_run_targets
  for each row execute function public.guard_study_revalidation_target();
revoke all on function public.guard_study_revalidation_target() from public,anon,authenticated,service_role;

create function public.guard_study_revalidation_result() returns trigger
language plpgsql set search_path='' as $$
begin
  if exists(select 1 from public.study_runs where revalidates_cohort=
    case when tg_op='INSERT' then new.cohort else old.cohort end) then
    raise exception 'study_revalidation_predecessor_closed';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger study_revalidation_result_guard before insert or update or delete on public.study_run_results
  for each row execute function public.guard_study_revalidation_result();
revoke all on function public.guard_study_revalidation_result() from public,anon,authenticated,service_role;

create or replace function public.guard_study_wave_lineage() returns trigger
language plpgsql set search_path='' as $$
declare parent public.study_runs; carried_cents bigint;
begin
  if tg_op='UPDATE' then
    if new.continued_from is distinct from old.continued_from then
      raise exception 'study_lineage_immutable';
    end if;
    if old.hash_identity_fingerprint is not null then
      if (new.hash_identity_fingerprint,new.family_max_attempts,new.family_max_dispatches)
          is distinct from (old.hash_identity_fingerprint,old.family_max_attempts,old.family_max_dispatches)
        or new.budget_cents>old.budget_cents or new.deadline_at>old.deadline_at
        or new.attempts_reserved<old.attempts_reserved then
        raise exception 'study_family_bound_immutable';
      end if;
      if old.source_frozen_at is not null and (new.source_manifest,new.source_frozen_at)
          is distinct from (old.source_manifest,old.source_frozen_at) then
        raise exception 'study_family_source_frozen';
      end if;
    elsif new.hash_identity_fingerprint is not null then
      if old.state in ('pilot','running') or new.state in ('pilot','running')
        or old.source_frozen_at is null
        or exists(select 1 from public.study_run_targets where cohort=old.cohort and state='running')
        or exists(select 1 from public.study_run_dispatches where cohort=old.cohort
          and finished_at is null and expires_at>clock_timestamp()) then
        raise exception 'study_identity_seal_requires_stopped_run';
      end if;
    end if;
    if exists(select 1 from public.study_runs where continued_from=old.cohort) then
      if new.state not in ('exhausted','paused')
        or (new.dispatches,new.dispatch_reserved_microusd,new.attempts_reserved,
            new.other_cost_reserve_cents,new.budget_cents,new.deadline_at)
          is distinct from (old.dispatches,old.dispatch_reserved_microusd,old.attempts_reserved,
            old.other_cost_reserve_cents,old.budget_cents,old.deadline_at) then
        raise exception 'study_parent_closed';
      end if;
    end if;
  end if;
  if new.hash_identity_fingerprint is null then return new; end if;
  if new.research_protocol_version not in (4,5) then raise exception 'study_lineage_protocol'; end if;
  if new.max_attempts>new.family_max_attempts or new.max_dispatches>new.family_max_dispatches
    or new.attempts_reserved>new.family_max_attempts or new.dispatches>new.family_max_dispatches then
    raise exception 'study_family_limit';
  end if;
  if new.continued_from is not null then
    select * into parent from public.study_runs where cohort=new.continued_from for update;
    if not found or parent.continued_from is not null or parent.state<>'exhausted'
      or parent.source_frozen_at is null or parent.research_protocol_version<>new.research_protocol_version
      or parent.hash_identity_fingerprint is null
      or new.hash_identity_fingerprint<>parent.hash_identity_fingerprint
      or (new.family_max_attempts,new.family_max_dispatches)
        is distinct from (parent.family_max_attempts,parent.family_max_dispatches)
      or exists(select 1 from public.study_run_targets where cohort=parent.cohort and state in ('queued','running'))
      or exists(select 1 from public.study_run_dispatches where cohort=parent.cohort
        and finished_at is null and expires_at>clock_timestamp()) then
      raise exception 'study_parent_not_ready';
    end if;
    if tg_op='INSERT' and (new.state<>'preparing' or new.source_frozen_at is not null
      or new.attempts_reserved<>0) then raise exception 'study_continuation_initialization'; end if;
    if new.source_manifest->>'sourceJsonlSha256' is null
      or new.source_manifest->>'mappingSha256' is null
      or new.source_manifest->>'selectionSeedCohort' is null
      or new.source_manifest->>'originalTargetsSha256' is null
      or (new.source_manifest->>'sourceJsonlSha256',new.source_manifest->>'mappingSha256',new.source_manifest->>'selectionSeedCohort')
        is distinct from (parent.source_manifest->>'sourceJsonlSha256',parent.source_manifest->>'mappingSha256',parent.source_manifest->>'selectionSeedCohort')
      or new.source_manifest->>'originalTargetsSha256' is distinct from
        coalesce(parent.source_manifest->>'parentTargetsSha256',parent.source_manifest->>'targetsSha256') then
      raise exception 'study_continuation_source_mismatch';
    end if;
    carried_cents := parent.other_cost_reserve_cents+(parent.dispatch_reserved_microusd+9999)/10000;
    if new.other_cost_reserve_cents<carried_cents or new.budget_cents>parent.budget_cents
      or new.deadline_at>parent.deadline_at then raise exception 'study_continuation_budget_carry'; end if;
    if parent.attempts_reserved+new.max_attempts>parent.family_max_attempts
      or parent.dispatches+new.max_dispatches>parent.family_max_dispatches
      or parent.attempts_reserved+new.attempts_reserved>parent.family_max_attempts
      or parent.dispatches+new.dispatches>parent.family_max_dispatches then
      raise exception 'study_family_limit';
    end if;
  end if;
  return new;
end $$;
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
        'open_api_json_ok','llms_txt_ok','robots','blocked_bot_count',
        'research_visible_chars','research_replacement_chars','research_html_bytes','research_title_chars')) then raise exception 'invalid_study_metrics'; end if;
    -- Numeric evidence must accompany fresh protocol-5 scanner results.
    -- These are bounded counts, never text, title, headers or source URLs.
    if r.research_protocol_version=5 and (
      not (p_metrics ?& array['research_visible_chars','research_replacement_chars','research_html_bytes','research_title_chars'])
      or exists(select 1 from unnest(array['research_visible_chars','research_replacement_chars','research_html_bytes','research_title_chars']) k
        where jsonb_typeof(p_metrics->k) is distinct from 'number'
          or (p_metrics->>k) !~ '^(0|[1-9][0-9]{0,7})$')
    ) then raise exception 'invalid_study_quality_evidence'; end if;
    -- Separate validation before casts: SQL may reorder OR expressions.
    if r.research_protocol_version=5 and (
      (p_metrics->>'research_visible_chars')::integer not between 80 and 50000
      or (p_metrics->>'research_html_bytes')::integer not between 1 and 1572864
      or (p_metrics->>'research_title_chars')::integer not between 0 and 8000
      or (p_metrics->>'research_replacement_chars')::integer>(p_metrics->>'research_visible_chars')::integer
      or ((p_metrics->>'research_replacement_chars')::integer>=3
        and (p_metrics->>'research_replacement_chars')::integer*100>(p_metrics->>'research_visible_chars')::integer*2)
    ) then raise exception 'invalid_study_quality_evidence'; end if;
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
    'budgetCents',r.budget_cents,'reservedEstimateCents',r.other_cost_reserve_cents+r.dispatch_reserved_microusd/10000.0,
    'dispatchReservedMicroUsd',r.dispatch_reserved_microusd,'dispatchCostMicroUsd',r.dispatch_cost_microusd,
    'otherCostReserveCents',r.other_cost_reserve_cents,
    'revalidatesCohort',r.revalidates_cohort,'continuedFrom',r.continued_from,'hashIdentityFingerprint',r.hash_identity_fingerprint,
    'familyMaxAttempts',r.family_max_attempts,'familyMaxDispatches',r.family_max_dispatches,
    'sourceFrozenAt',r.source_frozen_at,'deadlineAt',r.deadline_at,'stopReason',r.stop_reason,
    'targets',coalesce((select jsonb_object_agg(state,n) from (select state,count(*) n from public.study_run_targets where cohort=p_cohort group by state) c),'{}'::jsonb),
    'results',(select count(*) from public.study_run_results where cohort=p_cohort),
    'byVertical',coalesce((select jsonb_object_agg(vertical,n) from (select t.vertical,count(*) n from public.study_run_results s join public.study_run_targets t on s.target_id=t.id where s.cohort=p_cohort group by t.vertical) c),'{}'::jsonb),
    'lastDispatchAt',r.last_dispatch_at)
  from public.study_runs r where r.cohort=p_cohort;
$$;

commit;

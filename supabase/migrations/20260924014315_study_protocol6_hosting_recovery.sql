-- Additive, owner-approved hosting-template recovery. No run is created or started.
-- Revalidate the same original results, not only the failed revalidation's passes.
begin;
set local lock_timeout='5s';

alter table public.study_runs drop constraint study_runs_research_protocol_version_check;
alter table public.study_runs add constraint study_runs_research_protocol_version_check
  check (research_protocol_version in (1,2,3,4,5,6));
alter table public.study_runs add column recovers_from text references public.study_runs(cohort),
  add constraint study_recovery_root_only check (
    recovers_from is null or (recovers_from<>cohort and continued_from is null
      and revalidates_cohort is not null and research_protocol_version=6));
create unique index study_one_recovery_idx on public.study_runs(recovers_from) where recovers_from is not null;
-- The original result may be rechecked once per explicitly allowed protocol.
-- A recovery requires the failed, stopped protocol-5 root and consumes its budget.
drop index public.study_one_revalidation_idx;
create unique index study_one_revalidation_idx on public.study_runs(revalidates_cohort,research_protocol_version)
  where revalidates_cohort is not null;
drop index public.study_revalidation_target_idx;
create unique index study_revalidation_target_idx on public.study_run_targets(revalidates_target_id,cohort)
  where revalidates_target_id is not null;

create or replace function public.guard_study_revalidation_run() returns trigger
language plpgsql set search_path='' as $$
declare parent public.study_runs; recovery public.study_runs; carried_cents bigint; expected bigint;
begin
  if tg_op='UPDATE' then
    if (new.revalidates_cohort,new.recovers_from) is distinct from (old.revalidates_cohort,old.recovers_from) then
      raise exception 'study_revalidation_immutable';
    end if;
    if exists(select 1 from public.study_runs where revalidates_cohort=old.cohort)
      and new is distinct from old then raise exception 'study_revalidation_predecessor_closed'; end if;
  end if;
  if new.research_protocol_version in (5,6) and new.continued_from is null and new.revalidates_cohort is null then
    raise exception 'study_revalidation_lineage_required';
  end if;
  if new.revalidates_cohort is null then return new; end if;
  select * into parent from public.study_runs where cohort=new.revalidates_cohort for update;
  if not found or new.research_protocol_version not in (5,6) or parent.research_protocol_version<>4
    or parent.state<>'paused' or parent.stop_reason<>'quality_gate_failed_protocol_4_templates'
    or parent.source_frozen_at is null or parent.continued_from is not null
    or parent.revalidates_cohort is not null or new.hash_identity_fingerprint is null
    or exists(select 1 from public.study_runs where continued_from=parent.cohort)
    or exists(select 1 from public.study_run_targets where cohort=parent.cohort and state='running')
    or exists(select 1 from public.study_run_dispatches where cohort=parent.cohort
      and finished_at is null and expires_at>clock_timestamp()) then
    raise exception 'study_revalidation_predecessor_not_ready';
  end if;

  if new.research_protocol_version=6 then
    select * into recovery from public.study_runs where cohort=new.recovers_from for update;
    if not found or recovery.research_protocol_version<>5 or recovery.state<>'paused'
      or recovery.stop_reason<>'quality_gate_failed_protocol_5_hosting_placeholder'
      or recovery.revalidates_cohort is distinct from parent.cohort
      or recovery.source_frozen_at is null or recovery.continued_from is not null
      or recovery.hash_identity_fingerprint is null
      or new.hash_identity_fingerprint is distinct from recovery.hash_identity_fingerprint
      or exists(select 1 from public.study_runs where continued_from=recovery.cohort)
      or exists(select 1 from public.study_run_targets where cohort=recovery.cohort and state='running')
      or exists(select 1 from public.study_run_dispatches where cohort=recovery.cohort
        and finished_at is null and expires_at>clock_timestamp()) then
      raise exception 'study_recovery_predecessor_not_ready';
    end if;
    if new.family_max_attempts+recovery.attempts_reserved>recovery.family_max_attempts
      or new.family_max_dispatches+recovery.dispatches>recovery.family_max_dispatches then
      raise exception 'study_recovery_family_carry';
    end if;
    carried_cents := recovery.other_cost_reserve_cents+(recovery.dispatch_reserved_microusd+9999)/10000;
    if new.other_cost_reserve_cents<carried_cents or new.budget_cents>recovery.budget_cents
      or new.deadline_at>recovery.deadline_at then raise exception 'study_recovery_budget_carry'; end if;
    if new.source_manifest->>'recoversFrom' is distinct from recovery.cohort
      or new.source_manifest->>'recoveryTargetsSha256' is distinct from recovery.source_manifest->>'targetsSha256'
      or new.source_manifest->>'recoveryTargetsSha256' is null then
      raise exception 'study_recovery_source_mismatch';
    end if;
  elsif new.recovers_from is not null then
    raise exception 'study_recovery_protocol';
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

-- Freeze the failed revalidation too, including inserts and counter edits.
-- Trigger functions remain invoker-only and unavailable as Data API RPCs.
create function public.guard_study_recovery_predecessor() returns trigger
language plpgsql set search_path='' as $$
declare predecessor text;
begin
  predecessor := case when tg_op='INSERT' then new.cohort else old.cohort end;
  if exists(select 1 from public.study_runs where recovers_from=predecessor) then
    raise exception 'study_recovery_predecessor_closed';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger study_recovery_predecessor_guard before update or delete on public.study_runs
  for each row execute function public.guard_study_recovery_predecessor();
create trigger study_recovery_predecessor_guard before insert or update or delete on public.study_run_targets
  for each row execute function public.guard_study_recovery_predecessor();
create trigger study_recovery_predecessor_guard before insert or update or delete on public.study_run_results
  for each row execute function public.guard_study_recovery_predecessor();
revoke all on function public.guard_study_recovery_predecessor() from public,anon,authenticated,service_role;

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
  if new.research_protocol_version not in (4,5,6) then raise exception 'study_lineage_protocol'; end if;
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

-- Enforce numeric protocol-6 evidence even on direct service-role result inserts.
-- Existing RPC protocol, lease, metric allowlist and finish guards are unchanged.
create function public.guard_study_protocol6_evidence() returns trigger
language plpgsql set search_path='' as $$
declare protocol integer;
begin
  select research_protocol_version into protocol from public.study_runs where cohort=new.cohort;
  if protocol<>6 then return new; end if;
  if new.metrics->>'research_protocol_version' is distinct from '6'
    or new.metrics->>'scanner_version' is distinct from '2'
    or not (new.metrics ?& array['research_visible_chars','research_replacement_chars','research_html_bytes','research_title_chars'])
    or exists(select 1 from unnest(array['research_visible_chars','research_replacement_chars','research_html_bytes','research_title_chars']) k
      where jsonb_typeof(new.metrics->k) is distinct from 'number'
        or (new.metrics->>k) !~ '^(0|[1-9][0-9]{0,7})$') then
    raise exception 'invalid_study_quality_evidence';
  end if;
  -- Validate types first; SQL may reorder OR expressions and their casts.
  if (new.metrics->>'research_visible_chars')::integer not between 80 and 50000
    or (new.metrics->>'research_html_bytes')::integer not between 1 and 1572864
    or (new.metrics->>'research_title_chars')::integer not between 0 and 8000
    or (new.metrics->>'research_replacement_chars')::integer>(new.metrics->>'research_visible_chars')::integer
    or ((new.metrics->>'research_replacement_chars')::integer>=3
      and (new.metrics->>'research_replacement_chars')::integer*100>(new.metrics->>'research_visible_chars')::integer*2) then
    raise exception 'invalid_study_quality_evidence';
  end if;
  return new;
end $$;
create trigger study_protocol6_evidence_guard before insert or update on public.study_run_results
  for each row execute function public.guard_study_protocol6_evidence();
revoke all on function public.guard_study_protocol6_evidence() from public,anon,authenticated,service_role;

create or replace function public.study_run_status(p_cohort text) returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('cohort',r.cohort,'state',r.state,'researchProtocolVersion',r.research_protocol_version,
    'successLimit',r.success_limit,'targetSuccesses',r.target_successes,
    'attemptsReserved',r.attempts_reserved,'maxAttempts',r.max_attempts,'dispatches',r.dispatches,'maxDispatches',r.max_dispatches,
    'budgetCents',r.budget_cents,'reservedEstimateCents',r.other_cost_reserve_cents+r.dispatch_reserved_microusd/10000.0,
    'dispatchReservedMicroUsd',r.dispatch_reserved_microusd,'dispatchCostMicroUsd',r.dispatch_cost_microusd,
    'otherCostReserveCents',r.other_cost_reserve_cents,
    'recoversFrom',r.recovers_from,'revalidatesCohort',r.revalidates_cohort,'continuedFrom',r.continued_from,'hashIdentityFingerprint',r.hash_identity_fingerprint,
    'familyMaxAttempts',r.family_max_attempts,'familyMaxDispatches',r.family_max_dispatches,
    'sourceFrozenAt',r.source_frozen_at,'deadlineAt',r.deadline_at,'stopReason',r.stop_reason,
    'targets',coalesce((select jsonb_object_agg(state,n) from (select state,count(*) n from public.study_run_targets where cohort=p_cohort group by state) c),'{}'::jsonb),
    'results',(select count(*) from public.study_run_results where cohort=p_cohort),
    'byVertical',coalesce((select jsonb_object_agg(vertical,n) from (select t.vertical,count(*) n from public.study_run_results s join public.study_run_targets t on s.target_id=t.id where s.cohort=p_cohort group by t.vertical) c),'{}'::jsonb),
    'lastDispatchAt',r.last_dispatch_at)
  from public.study_runs r where r.cohort=p_cohort;
$$;

create or replace function public.study_family_status(p_root text) returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('rootCohort',r.cohort,'protocol',r.research_protocol_version,
    'maxAttempts',r.family_max_attempts,'maxDispatches',r.family_max_dispatches,'budgetCents',r.budget_cents,
    'deadlineAt',r.deadline_at,'recoversFrom',r.recovers_from,
    'priorRecoveryAttempts',coalesce((select attempts_reserved from public.study_runs where cohort=r.recovers_from),0),
    'priorRecoveryDispatches',coalesce((select dispatches from public.study_runs where cohort=r.recovers_from),0),
    'attempts',(select sum(attempts_reserved) from public.study_runs where cohort=p_root or continued_from=p_root),
    'dispatches',(select sum(dispatches) from public.study_runs where cohort=p_root or continued_from=p_root),
    'reservedEstimateCents',coalesce((select other_cost_reserve_cents+dispatch_reserved_microusd/10000.0
      from public.study_runs where continued_from=p_root),r.other_cost_reserve_cents+r.dispatch_reserved_microusd/10000.0),
    'results',(select count(*) from public.study_run_results where identity_cohort=p_root),
    'uniqueFinalDomains',(select count(distinct final_domain_hash) from public.study_run_results where identity_cohort=p_root),
    'activeWaves',(select count(*) from public.study_runs where (cohort=p_root or continued_from=p_root) and state in ('pilot','running')))
  from public.study_runs r where r.cohort=p_root and r.continued_from is null and r.hash_identity_fingerprint is not null;
$$;

commit;

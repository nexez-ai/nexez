-- Opt-in two-wave safeguards only. No cohort is linked, sealed or activated.
begin;
set local lock_timeout='5s';

alter table public.study_runs
  add column continued_from text references public.study_runs(cohort),
  add column hash_identity_fingerprint text check (hash_identity_fingerprint ~ '^[a-f0-9]{64}$'),
  add column family_max_attempts integer check (family_max_attempts between 1 and 150000),
  add column family_max_dispatches integer check (family_max_dispatches between 1 and 25000),
  add constraint study_family_configuration_complete check (
    num_nonnulls(hash_identity_fingerprint,family_max_attempts,family_max_dispatches) in (0,3)
    and (continued_from is null or hash_identity_fingerprint is not null)),
  add constraint study_continuation_not_self check (continued_from<>cohort);
-- At most one extension, never an unbounded chain or parallel branches.
create unique index study_one_continuation_idx on public.study_runs(continued_from)
  where continued_from is not null;
create unique index study_one_active_family_wave_idx on public.study_runs((coalesce(continued_from,cohort)))
  where state in ('pilot','running');

create function public.guard_study_wave_lineage() returns trigger
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
  if new.research_protocol_version<>4 then raise exception 'study_lineage_protocol'; end if;
  if new.max_attempts>new.family_max_attempts or new.max_dispatches>new.family_max_dispatches
    or new.attempts_reserved>new.family_max_attempts or new.dispatches>new.family_max_dispatches then
    raise exception 'study_family_limit';
  end if;
  if new.continued_from is not null then
    select * into parent from public.study_runs where cohort=new.continued_from for update;
    if not found or parent.continued_from is not null or parent.state<>'exhausted'
      or parent.source_frozen_at is null or parent.research_protocol_version<>4
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
-- Runs after the accounting trigger has computed any newly charged reservation.
create trigger study_wave_lineage_guard before insert or update on public.study_runs
  for each row execute function public.guard_study_wave_lineage();
revoke all on function public.guard_study_wave_lineage() from public,anon,authenticated,service_role;

create function public.guard_study_wave_initial_domain() returns trigger
language plpgsql set search_path='' as $$
declare parent_cohort text;
begin
  if tg_op='UPDATE' and (new.cohort,new.domain_key) is not distinct from (old.cohort,old.domain_key) then return new; end if;
  select continued_from into parent_cohort from public.study_runs where cohort=new.cohort;
  if parent_cohort is not null and exists(select 1 from public.study_run_targets
    where cohort=parent_cohort and domain_key=new.domain_key) then
    raise exception 'study_continuation_initial_duplicate';
  end if;
  return new;
end $$;
create trigger study_wave_initial_domain_guard before insert or update on public.study_run_targets
  for each row execute function public.guard_study_wave_initial_domain();
revoke all on function public.guard_study_wave_initial_domain() from public,anon,authenticated,service_role;

-- Existing cohorts keep their own identity namespace, including audit-only pilots.
-- Only an explicitly linked continuation shares its parent's namespace.
alter table public.study_run_results add column identity_cohort text references public.study_runs(cohort);
update public.study_run_results set identity_cohort=cohort;
alter table public.study_run_results alter column identity_cohort set not null;
create unique index study_family_final_domain_idx on public.study_run_results(identity_cohort,final_domain_hash);
create function public.guard_study_result_identity() returns trigger
language plpgsql set search_path='' as $$
declare expected_cohort text;
begin
  if tg_op='UPDATE' and (new.target_id,new.cohort,new.final_domain_hash,new.identity_cohort)
    is distinct from (old.target_id,old.cohort,old.final_domain_hash,old.identity_cohort) then
    raise exception 'study_result_identity_immutable';
  end if;
  select coalesce(continued_from,cohort) into expected_cohort from public.study_runs where cohort=new.cohort;
  if expected_cohort is null or (new.identity_cohort is not null and new.identity_cohort<>expected_cohort) then
    raise exception 'study_result_identity_mismatch';
  end if;
  new.identity_cohort := expected_cohort;
  return new;
end $$;
create trigger study_result_identity_guard before insert or update on public.study_run_results
  for each row execute function public.guard_study_result_identity();
revoke all on function public.guard_study_result_identity() from public,anon,authenticated,service_role;
-- finish_study_run_target already uses ON CONFLICT DO NOTHING and records the
-- duplicate exclusion. Its protocol/metrics/lease checks remain untouched.

create or replace function public.study_run_status(p_cohort text) returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('cohort',r.cohort,'state',r.state,'researchProtocolVersion',r.research_protocol_version,
    'successLimit',r.success_limit,'targetSuccesses',r.target_successes,
    'attemptsReserved',r.attempts_reserved,'maxAttempts',r.max_attempts,'dispatches',r.dispatches,'maxDispatches',r.max_dispatches,
    'budgetCents',r.budget_cents,'reservedEstimateCents',r.other_cost_reserve_cents+r.dispatch_reserved_microusd/10000.0,
    'dispatchReservedMicroUsd',r.dispatch_reserved_microusd,'dispatchCostMicroUsd',r.dispatch_cost_microusd,
    'otherCostReserveCents',r.other_cost_reserve_cents,
    'continuedFrom',r.continued_from,'hashIdentityFingerprint',r.hash_identity_fingerprint,
    'familyMaxAttempts',r.family_max_attempts,'familyMaxDispatches',r.family_max_dispatches,
    'sourceFrozenAt',r.source_frozen_at,'deadlineAt',r.deadline_at,'stopReason',r.stop_reason,
    'targets',coalesce((select jsonb_object_agg(state,n) from (select state,count(*) n from public.study_run_targets where cohort=p_cohort group by state) c),'{}'::jsonb),
    'results',(select count(*) from public.study_run_results where cohort=p_cohort),
    'byVertical',coalesce((select jsonb_object_agg(vertical,n) from (select t.vertical,count(*) n from public.study_run_results s join public.study_run_targets t on s.target_id=t.id where s.cohort=p_cohort group by t.vertical) c),'{}'::jsonb),
    'lastDispatchAt',r.last_dispatch_at)
  from public.study_runs r where r.cohort=p_cohort;
$$;

create function public.study_family_status(p_root text) returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('rootCohort',r.cohort,'protocol',r.research_protocol_version,
    'maxAttempts',r.family_max_attempts,'maxDispatches',r.family_max_dispatches,'budgetCents',r.budget_cents,
    'deadlineAt',r.deadline_at,
    'attempts',(select sum(attempts_reserved) from public.study_runs where cohort=p_root or continued_from=p_root),
    'dispatches',(select sum(dispatches) from public.study_runs where cohort=p_root or continued_from=p_root),
    'reservedEstimateCents',coalesce((select other_cost_reserve_cents+dispatch_reserved_microusd/10000.0
      from public.study_runs where continued_from=p_root),r.other_cost_reserve_cents+r.dispatch_reserved_microusd/10000.0),
    'results',(select count(*) from public.study_run_results where identity_cohort=p_root),
    'uniqueFinalDomains',(select count(distinct final_domain_hash) from public.study_run_results where identity_cohort=p_root),
    'activeWaves',(select count(*) from public.study_runs where (cohort=p_root or continued_from=p_root) and state in ('pilot','running')))
  from public.study_runs r where r.cohort=p_root and r.continued_from is null and r.hash_identity_fingerprint is not null;
$$;
revoke all on function public.study_family_status(text) from public,anon,authenticated,service_role;
grant execute on function public.study_family_status(text) to service_role;
commit;

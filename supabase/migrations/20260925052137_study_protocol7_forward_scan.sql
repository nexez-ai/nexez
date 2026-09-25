-- Forward-only owner-directed recovery. No source rows or scans are created.
-- Old provisional observations remain immutable and outside the new denominator.
begin;
set local lock_timeout='5s';
alter table public.study_runs drop constraint study_runs_research_protocol_version_check;
alter table public.study_runs add constraint study_runs_research_protocol_version_check
  check (research_protocol_version in (1,2,3,4,5,6,7));
alter table public.study_runs drop constraint study_recovery_root_only;
alter table public.study_runs add constraint study_recovery_root_only check (
  recovers_from is null or (recovers_from<>cohort and continued_from is null and
    ((research_protocol_version=6 and revalidates_cohort is not null)
      or (research_protocol_version=7 and revalidates_cohort is null))));

-- Preserve existing lineage and evidence checks, extending only their version set.
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
  if new.research_protocol_version not in (4,5,6,7) then raise exception 'study_lineage_protocol'; end if;
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

create or replace function public.guard_study_protocol6_evidence() returns trigger
language plpgsql set search_path='' as $$
declare protocol integer;
begin
  select research_protocol_version into protocol from public.study_runs where cohort=new.cohort;
  if protocol not in (6,7) then return new; end if;
  if new.metrics->>'research_protocol_version' is distinct from protocol::text
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

create function public.guard_study_forward_run() returns trigger
language plpgsql set search_path='' as $$
declare parent public.study_runs; carried_cents bigint; expected integer; actual_hash text;
begin
  if new.research_protocol_version<>7 then return new; end if;
  select * into parent from public.study_runs where cohort=new.recovers_from for update;
  if not found or parent.research_protocol_version<>6 or parent.state<>'paused'
    or parent.stop_reason<>'quality_gate_failed_protocol_6_text_and_password'
    or parent.source_frozen_at is null or parent.continued_from is not null
    or new.continued_from is not null or new.revalidates_cohort is not null
    or parent.hash_identity_fingerprint is null
    or new.hash_identity_fingerprint is distinct from parent.hash_identity_fingerprint
    or exists(select 1 from public.study_runs where continued_from=parent.cohort)
    or exists(select 1 from public.study_run_targets where cohort=parent.cohort and state in ('queued','running'))
    or exists(select 1 from public.study_run_dispatches where cohort=parent.cohort and finished_at is null) then
    raise exception 'study_forward_predecessor_not_ready';
  end if;
  if tg_op='INSERT' and (new.state<>'preparing' or new.source_frozen_at is not null
    or new.attempts_reserved<>0 or new.dispatches<>0 or new.dispatch_reserved_microusd<>0) then
    raise exception 'study_forward_initialization';
  end if;
  if new.family_max_attempts+parent.attempts_reserved>parent.family_max_attempts
    or new.family_max_dispatches+parent.dispatches>parent.family_max_dispatches then
    raise exception 'study_forward_family_carry';
  end if;
  carried_cents := parent.other_cost_reserve_cents+(parent.dispatch_reserved_microusd+9999)/10000;
  if new.other_cost_reserve_cents<carried_cents or new.budget_cents>parent.budget_cents
    or new.deadline_at>parent.deadline_at
    or new.other_cost_reserve_cents*10000::bigint+new.family_max_dispatches::bigint*new.dispatch_cost_microusd
      >new.budget_cents*10000::bigint then raise exception 'study_forward_budget_carry'; end if;
  if new.source_manifest->>'recoversFrom' is distinct from parent.cohort
    or new.source_manifest->>'mode' is distinct from 'forward_only_excluding_prior_initial_domains'
    or new.source_manifest->>'recoveryTargetsSha256' is distinct from parent.source_manifest->>'targetsSha256'
    or new.source_manifest->>'sourceJsonlSha256' is null
    or new.source_manifest->>'mappingSha256' is null
    or new.source_manifest->>'selectionSeedCohort' is null
    or (new.source_manifest->>'sourceJsonlSha256',new.source_manifest->>'mappingSha256',new.source_manifest->>'selectionSeedCohort')
      is distinct from (parent.source_manifest->>'sourceJsonlSha256',parent.source_manifest->>'mappingSha256',parent.source_manifest->>'selectionSeedCohort')
    or coalesce(new.source_manifest->>'targetsSha256','') !~ '^[a-f0-9]{64}$'
    or coalesce(new.source_manifest->>'importCanonicalSha256','') !~ '^[a-f0-9]{64}$'
    or coalesce(new.source_manifest->>'selected','') !~ '^[1-9][0-9]{0,5}$' then
    raise exception 'study_forward_source_mismatch';
  end if;
  expected := (new.source_manifest->>'selected')::integer;
  if expected>120000 then raise exception 'study_forward_frame_limit'; end if;
  if tg_op='UPDATE' and old.source_frozen_at is null and new.source_frozen_at is not null then
    if expected<>(select count(*) from public.study_run_targets where cohort=new.cohort)
      or exists(select 1 from public.study_run_results where cohort=new.cohort) then
      raise exception 'study_forward_incomplete';
    end if;
    select encode(sha256(convert_to(string_agg(concat_ws(chr(9),cohort,domain_key,url,vertical,region,source_ref,sample_rank)
      ||chr(10),'' order by sample_rank),'UTF8')),'hex') into actual_hash
      from public.study_run_targets where cohort=new.cohort;
    if actual_hash is distinct from new.source_manifest->>'importCanonicalSha256' then
      raise exception 'study_forward_frame_checksum';
    end if;
  end if;
  if new.state in ('pilot','running') and new.source_frozen_at is null then
    raise exception 'study_forward_unfrozen';
  end if;
  return new;
end $$;
create trigger study_forward_run_guard before insert or update on public.study_runs
  for each row execute function public.guard_study_forward_run();
revoke all on function public.guard_study_forward_run() from public,anon,authenticated,service_role;

create function public.guard_study_forward_target() returns trigger
language plpgsql set search_path='' as $$
declare run public.study_runs;
begin
  if tg_op='DELETE' then
    if exists(select 1 from public.study_runs where cohort=old.cohort and research_protocol_version=7
      and source_frozen_at is not null) then raise exception 'study_forward_frame_frozen'; end if;
    return old;
  end if;
  if tg_op='UPDATE' and (new.cohort,new.domain_key,new.revalidates_target_id)
      is not distinct from (old.cohort,old.domain_key,old.revalidates_target_id) then return new; end if;
  select * into run from public.study_runs where cohort=new.cohort;
  if run.research_protocol_version<>7 then return new; end if;
  if new.revalidates_target_id is not null or new.state<>'queued' or new.attempts<>0
    or new.finished_at is not null or new.failure_code is not null then
    raise exception 'study_forward_fresh_targets_required';
  end if;
  if exists(select 1 from public.study_run_targets where cohort=run.recovers_from and domain_key=new.domain_key) then
    raise exception 'study_forward_initial_duplicate';
  end if;
  return new;
end $$;
create trigger study_forward_target_guard before insert or update or delete on public.study_run_targets
  for each row execute function public.guard_study_forward_target();
revoke all on function public.guard_study_forward_target() from public,anon,authenticated,service_role;

commit;

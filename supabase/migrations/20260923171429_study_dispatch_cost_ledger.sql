-- Preparation only: no run, rate, checkpoint, cron or frozen frame is changed.
-- The nested design is bounded to 125,000 candidates. These schema ceilings
-- accommodate a reviewed continuation, not authorization to activate one.
begin;

alter table public.study_runs
  drop constraint study_runs_max_attempts_check,
  add constraint study_runs_max_attempts_check check (max_attempts between 1 and 150000),
  drop constraint study_runs_max_dispatches_check,
  add constraint study_runs_max_dispatches_check check (max_dispatches between 1 and 25000),
  drop constraint study_runs_dispatch_cost_microusd_check,
  add constraint study_runs_dispatch_cost_microusd_check check (dispatch_cost_microusd >= 2700),
  add column dispatch_reserved_microusd bigint not null default 0 check (dispatch_reserved_microusd >= 0);

-- USD 0.0027 is a prospective floor, not a new default. The deployed 60-second
-- maximum with standard 2-GB/1-vCPU iad1 resources models USD 0.0024872667 for
-- full-duration compute and one invocation. Other costs require a separate
-- reserve and provider review. Existing USD 0.005 rates remain unchanged.
-- Never retrospectively reprice dispatches at a lower continuation rate.
update public.study_runs
  set dispatch_reserved_microusd=dispatches::bigint*dispatch_cost_microusd;

create function public.guard_study_dispatch_accounting() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' then
    if new.dispatches<>0 or new.dispatch_reserved_microusd<>0 then
      raise exception 'study_dispatch_ledger_initialization';
    end if;
    return new;
  end if;
  if new.dispatches<old.dispatches
    or new.dispatch_reserved_microusd is distinct from old.dispatch_reserved_microusd
    or new.other_cost_reserve_cents<old.other_cost_reserve_cents then
    raise exception 'study_dispatch_reserve_immutable';
  end if;
  if new.dispatch_cost_microusd<>old.dispatch_cost_microusd
    and (old.state in ('pilot','running') or new.state in ('pilot','running') or new.dispatches<>old.dispatches) then
    raise exception 'study_rate_change_requires_stopped_run';
  end if;
  new.dispatch_reserved_microusd := old.dispatch_reserved_microusd
    +(new.dispatches-old.dispatches)::bigint*old.dispatch_cost_microusd;
  return new;
end $$;
create trigger study_dispatch_accounting_guard before insert or update on public.study_runs
  for each row execute function public.guard_study_dispatch_accounting();
revoke all on function public.guard_study_dispatch_accounting() from public,anon,authenticated,service_role;

-- Keep scheduling, infrastructure-failure, deadline and single-use safeguards.
-- Only the budget expression changes, to use the non-decreasing ledger.
create or replace function public.dispatch_readiness_study(p_cohort text) returns text
language plpgsql set search_path='' as $$
declare r public.study_runs; dispatch_id uuid; new_request_id bigint; bearer text;
begin
  select * into r from public.study_runs where cohort=p_cohort for update;
  if not found or r.state not in ('pilot','running') or r.source_frozen_at is null
    or not exists(select 1 from public.study_control where key='research' and enabled) then return 'inactive'; end if;
  if r.deadline_at<=clock_timestamp() or r.dispatches>=r.max_dispatches
    or r.other_cost_reserve_cents::bigint*10000+r.dispatch_reserved_microusd+r.dispatch_cost_microusd>r.budget_cents::bigint*10000 then
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
  -- The trigger charges exactly this increment at the unchanged active rate.
  update public.study_runs set dispatches=dispatches+1,last_dispatch_at=clock_timestamp() where cohort=p_cohort;
  return 'dispatched';
end $$;

create or replace function public.study_run_status(p_cohort text) returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('cohort',r.cohort,'state',r.state,'researchProtocolVersion',r.research_protocol_version,
    'successLimit',r.success_limit,'targetSuccesses',r.target_successes,
    'attemptsReserved',r.attempts_reserved,'maxAttempts',r.max_attempts,'dispatches',r.dispatches,'maxDispatches',r.max_dispatches,
    'budgetCents',r.budget_cents,'reservedEstimateCents',r.other_cost_reserve_cents+r.dispatch_reserved_microusd/10000.0,
    'dispatchReservedMicroUsd',r.dispatch_reserved_microusd,'dispatchCostMicroUsd',r.dispatch_cost_microusd,
    'otherCostReserveCents',r.other_cost_reserve_cents,
    'sourceFrozenAt',r.source_frozen_at,'deadlineAt',r.deadline_at,'stopReason',r.stop_reason,
    'targets',coalesce((select jsonb_object_agg(state,n) from (select state,count(*) n from public.study_run_targets where cohort=p_cohort group by state) c),'{}'::jsonb),
    'results',(select count(*) from public.study_run_results where cohort=p_cohort),
    'byVertical',coalesce((select jsonb_object_agg(vertical,n) from (select t.vertical,count(*) n from public.study_run_results s join public.study_run_targets t on s.target_id=t.id where s.cohort=p_cohort group by t.vertical) c),'{}'::jsonb),
    'lastDispatchAt',r.last_dispatch_at)
  from public.study_runs r where r.cohort=p_cohort;
$$;

comment on column public.study_runs.dispatch_reserved_microusd is
  'Cumulative dispatch reservations at the rates charged. Estimate, not provider billing. Never reset or reprice historical dispatches.';
commit;

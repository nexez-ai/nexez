-- Protocol 3 excludes explicit expired-domain renewal notices. Keep every
-- existing frozen cohort and all run limits unchanged. Materialized selection
-- enforces the existing batch LIMIT across query plans. This starts no scans.
begin;
set local lock_timeout = '5s';
alter table public.study_runs drop constraint study_runs_research_protocol_version_check;
alter table public.study_runs add constraint study_runs_research_protocol_version_check
  check (research_protocol_version in (1,2,3));
create or replace function public.claim_study_run_batch(p_cohort text,p_dispatch uuid)
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
  -- Materialize the locked selection once. An IN subquery with SKIP LOCKED can
  -- be rescanned by the UPDATE plan and claim more rows than its inner LIMIT.
  return query with candidates as materialized (
    select id from public.study_run_targets where cohort=p_cohort and state='queued'
      and attempts<3 and available_at<=clock_timestamp()
      order by sample_rank,id limit remaining for update skip locked
  )
  update public.study_run_targets t set state='running',attempts=t.attempts+1,
    lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '75 seconds',failure_code=null
    from candidates c where t.id=c.id returning t.*;
  get diagnostics claimed=row_count;
  update public.study_runs set attempts_reserved=attempts_reserved+claimed where cohort=p_cohort;
  if claimed=0 and active=0 and not exists(select 1 from public.study_run_targets where cohort=p_cohort and state='queued') then
    update public.study_runs set state='exhausted',stop_reason='frame_exhausted' where cohort=p_cohort;
  end if;
end $$;

commit;

-- Disposable database only. All fixtures roll back. Extension HTTP is stubbed
-- in scripts/study-test-bootstrap.sql for isolated local tests.
\set ON_ERROR_STOP on
begin;
set local plpgsql.check_asserts=on;
insert into public.study_control(key,enabled) values('research',true);
insert into vault.decrypted_secrets(name,decrypted_secret) values('nexez_readiness_research_bearer','local-fixture-only');
insert into public.study_runs(cohort,target_successes,success_limit) values('test-study',10,2),('test-recovery',20,20),('test-budget',10,2);
insert into public.study_run_targets(cohort,domain_key,url,vertical,region,source_ref,sample_rank)
  select c,'target'||i||'.com','https://target'||i||'.com','restaurants','CA','fixture-'||i,
    encode(sha256(convert_to(i::text,'UTF8')),'hex')
  from unnest(array['test-study','test-recovery','test-budget']) c cross join generate_series(1,10) i;
update public.study_runs set source_frozen_at=clock_timestamp(),state='pilot';

do $$
declare rel text; fn record;
begin
  foreach rel in array array['study_runs','study_run_targets','study_run_results','study_run_dispatches'] loop
    assert (select relrowsecurity from pg_class where oid=('public.'||rel)::regclass), 'RLS required';
    assert not has_table_privilege('anon','public.'||rel,'SELECT,INSERT,UPDATE,DELETE'), 'anonymous table access';
    assert not has_table_privilege('authenticated','public.'||rel,'SELECT,INSERT,UPDATE,DELETE'), 'authenticated table access';
  end loop;
  for fn in select p.oid::regprocedure signature,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private') and p.proname in ('claim_study_run_batch','finish_study_run_target','acquire_study_network_slot','study_run_status','dispatch_readiness_study') loop
    assert not has_function_privilege('anon',fn.signature,'EXECUTE'), 'anonymous command access';
    assert not has_function_privilege('authenticated',fn.signature,'EXECUTE'), 'authenticated command access';
    assert fn.proconfig @> array['search_path=""'], 'pinned search path';
  end loop;
  assert not has_function_privilege('service_role','public.dispatch_readiness_study(text)','EXECUTE'), 'only scheduler may charge dispatches';
  begin update public.study_run_targets set url='https://changed.com' where cohort='test-study';
    raise exception 'frozen frame changed'; exception when raise_exception then assert sqlerrm='study_frame_frozen'; end;
  assert public.dispatch_readiness_study('test-study')='dispatched', 'first dispatch';
  assert public.dispatch_readiness_study('test-study')='busy', 'duplicate dispatch';
end $$;

set local role service_role;
do $$
declare d uuid; a public.study_run_targets; b public.study_run_targets; n integer; good jsonb;
begin
  select id into d from public.study_run_dispatches where cohort='test-study';
  select count(*) into n from public.claim_study_run_batch('test-study',d);
  assert n=2, 'claims cannot overshoot pilot';
  assert (select count(*) from public.claim_study_run_batch('test-study',d))=0, 'dispatch replay';
  select * into a from public.study_run_targets where cohort='test-study' and state='running' order by id limit 1;
  select * into b from public.study_run_targets where cohort='test-study' and state='running' and id<>a.id;
  good := '{"source":"study","scanner_version":2,"score":50,"http_status":200,"has_visible_price":true}';
  assert not public.finish_study_run_target(a.cohort,a.id,gen_random_uuid(),good,repeat('a',64),null,1,2,3), 'wrong lease rejected';
  assert not public.finish_study_run_target('test-recovery',a.id,a.lease_token,good,repeat('a',64),null,1,2,3), 'wrong cohort rejected';
  begin perform public.finish_study_run_target(a.cohort,a.id,a.lease_token,good||'{"pageText":"private"}',repeat('a',64),null,1,2,3);
    raise exception 'raw content accepted'; exception when raise_exception then assert sqlerrm='invalid_study_metrics'; end;
  begin perform public.finish_study_run_target(a.cohort,a.id,a.lease_token,good||'{"http_status":403}',repeat('a',64),null,1,2,3);
    raise exception 'blocked page scored'; exception when raise_exception then assert sqlerrm='invalid_study_metrics'; end;
  assert public.finish_study_run_target(a.cohort,a.id,a.lease_token,good,repeat('a',64),null,1,2,3), 'atomic result completion';
  assert not public.finish_study_run_target(a.cohort,a.id,a.lease_token,good,repeat('a',64),null,1,2,3), 'completion replay';
  assert public.finish_study_run_target(b.cohort,b.id,b.lease_token,good,repeat('a',64),null,1,2,3), 'duplicate final domain terminal';
  assert (select state='duplicate' from public.study_run_targets where id=b.id), 'duplicate excluded';
  assert (select count(*) from public.study_run_results where cohort=a.cohort)=1, 'duplicate not in denominator';
  assert (select state='pilot' from public.study_runs where cohort=a.cohort), 'pilot needs another success';
end $$;
reset role;

update public.study_run_dispatches set finished_at=clock_timestamp() where cohort='test-study';
update public.study_runs set last_dispatch_at=null where cohort='test-study';
select public.dispatch_readiness_study('test-study');
do $$
declare d uuid; t public.study_run_targets;
begin
  select id into d from public.study_run_dispatches where cohort='test-study' and finished_at is null;
  select * into t from public.claim_study_run_batch('test-study',d);
  assert public.finish_study_run_target(t.cohort,t.id,t.lease_token,'{"source":"study","scanner_version":2,"score":50,"http_status":200}',repeat('b',64),null,1,2,3);
  assert (select state='pilot_review' from public.study_runs where cohort=t.cohort), 'automatic pilot stop';
  assert public.dispatch_readiness_study(t.cohort)='inactive', 'pilot cannot continue unattended';
  assert not public.study_run_status(t.cohort)::text like '%target1.com%', 'status contains only aggregates';
end $$;

select public.dispatch_readiness_study('test-recovery');
do $$
declare d uuid; t public.study_run_targets; original_lease uuid; n integer;
begin
  select id into d from public.study_run_dispatches where cohort='test-recovery';
  assert (select count(*) from public.claim_study_run_batch('test-recovery',d))=6, 'bounded batch';
  select * into t from public.study_run_targets where cohort='test-recovery' and state='running' order by sample_rank limit 1;
  original_lease:=t.lease_token;
  assert public.acquire_study_network_slot(t.domain_key,t.lease_token)='allowed', 'research permit';
  perform public.release_scan_network_slot(t.lease_token);
  update public.study_run_targets set lease_until=clock_timestamp()-interval '1 second' where id=t.id;
  assert not public.finish_study_run_target(t.cohort,t.id,original_lease,null,null,'network_error',1,2,3), 'expired completion fenced';
  insert into public.study_run_dispatches(cohort) values('test-recovery') returning id into d;
  select count(*) into n from public.claim_study_run_batch('test-recovery',d);
  select * into t from public.study_run_targets where id=t.id;
  assert t.attempts=2 and t.lease_token<>original_lease, 'interrupted target reclaimed with new lease';
  assert public.finish_study_run_target(t.cohort,t.id,t.lease_token,null,null,'network_error',1,2,3), 'transient failure recorded';
  assert (select state='queued' and available_at>clock_timestamp() from public.study_run_targets where id=t.id), 'retry backoff';
  update public.study_run_targets set state='failed',failure_code='attempts_exhausted',lease_token=null,lease_until=null where cohort=t.cohort and state='running';
  update public.study_run_targets set available_at=clock_timestamp(),attempts=2 where id=t.id;
  insert into public.study_run_dispatches(cohort) values(t.cohort) returning id into d;
  perform public.claim_study_run_batch(t.cohort,d);
  select * into t from public.study_run_targets where id=t.id;
  assert public.finish_study_run_target(t.cohort,t.id,t.lease_token,null,null,'network_error',1,2,3);
  assert (select state='failed' and attempts=3 from public.study_run_targets where id=t.id), 'retry exhaustion';
end $$;

do $$
declare d uuid; t public.study_run_targets; tokens uuid[]; i integer;
begin
  select array_agg(gen_random_uuid()) into tokens from generate_series(1,5);
  for i in 1..5 loop assert public.acquire_scan_network_slot('interactive'||i||'.com',tokens[i],null)='allowed'; end loop;
  assert public.dispatch_readiness_study('test-budget')='dispatched';
  select id into d from public.study_run_dispatches where cohort='test-budget';
  perform public.claim_study_run_batch('test-budget',d);
  select * into t from public.study_run_targets where cohort='test-budget' and state='running' limit 1;
  assert public.acquire_study_network_slot(t.domain_key,t.lease_token)='busy', 'customer headroom preserved';
  for i in 1..5 loop perform public.release_scan_network_slot(tokens[i]); end loop;
  assert public.acquire_study_network_slot(t.domain_key,gen_random_uuid())='denied', 'research requires real target lease';
  assert public.acquire_study_network_slot(t.domain_key,t.lease_token)='allowed';
  perform public.release_scan_network_slot(t.lease_token);
  assert public.finish_study_run_target(t.cohort,t.id,t.lease_token,null,null,'robots_denied',1,2,3);
  assert (select state='robots_excluded' from public.study_run_targets where id=t.id), 'robots excluded, not scored';
  update public.study_runs set dispatches=max_dispatches,last_dispatch_at=null where cohort=t.cohort;
  assert public.dispatch_readiness_study(t.cohort)='paused', 'dispatch cap';
  update public.study_runs set state='pilot',dispatches=0,budget_cents=3001,dispatch_cost_microusd=20000 where cohort=t.cohort;
  assert public.dispatch_readiness_study(t.cohort)='paused', 'cost reserve prevents overspend estimate';
  update public.study_runs set state='pilot',deadline_at=clock_timestamp()-interval '1 second' where cohort=t.cohort;
  assert public.dispatch_readiness_study(t.cohort)='paused', 'deadline stop';
end $$;
rollback;

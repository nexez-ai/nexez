-- Disposable PostgreSQL only. HTTP is stubbed; every fixture rolls back.
\set ON_ERROR_STOP on
begin;
set local plpgsql.check_asserts=on;
insert into public.study_control(key,enabled) values('research',true);
insert into vault.decrypted_secrets(name,decrypted_secret) values('nexez_readiness_research_bearer','local-fixture-only');
insert into public.study_runs(cohort,research_protocol_version,max_attempts,max_dispatches,other_cost_reserve_cents,source_manifest)
values('recovery-original',4,15000,3000,3305,jsonb_build_object('sourceJsonlSha256',repeat('d',64),
  'mappingSha256',repeat('e',64),'selectionSeedCohort','original-seed','parentTargetsSha256',repeat('f',64)));
insert into public.study_run_targets(cohort,domain_key,url,vertical,region,source_ref,sample_rank)
select 'recovery-original','original'||i||'.example','https://original'||i||'.example','health','CA','fixture-'||i,
  encode(sha256(convert_to(i::text,'UTF8')),'hex') from generate_series(1,3) i;
insert into public.study_run_results(target_id,cohort,final_domain_hash,metrics)
select id,cohort,sample_rank,'{"source":"study","research_protocol_version":4,"scanner_version":2,"score":50,"http_status":200}'
from public.study_run_targets where cohort='recovery-original';
update public.study_run_targets set state='succeeded' where cohort='recovery-original';
update public.study_runs set source_frozen_at=clock_timestamp(),state='paused',
  stop_reason='quality_gate_failed_protocol_4_templates',dispatches=1995,attempts_reserved=11809
where cohort='recovery-original';
insert into public.study_runs(cohort,revalidates_cohort,research_protocol_version,hash_identity_fingerprint,
  family_max_attempts,family_max_dispatches,max_attempts,max_dispatches,other_cost_reserve_cents,
  dispatch_cost_microusd,budget_cents,deadline_at,source_manifest,target_successes,success_limit)
select 'recovery-failed',cohort,5,repeat('c',64),120000,20000,1500,500,4303,
  2700,budget_cents,deadline_at,source_manifest||jsonb_build_object('revalidatesCohort',cohort,'targetsSha256',repeat('a',64)),100000,500
from public.study_runs where cohort='recovery-original';
insert into public.study_run_targets(cohort,domain_key,url,vertical,region,source_ref,sample_rank,revalidates_target_id)
select 'recovery-failed',domain_key,url,vertical,region,source_ref,sample_rank,id
from public.study_run_targets where cohort='recovery-original';
update public.study_runs set source_frozen_at=clock_timestamp(),state='paused',
  stop_reason='quality_gate_failed_protocol_5_hosting_placeholder',attempts_reserved=522,dispatches=87
where cohort='recovery-failed';
insert into public.study_run_results(target_id,cohort,final_domain_hash,metrics)
select id,cohort,sample_rank,'{"source":"study","research_protocol_version":5,"scanner_version":2,"score":50,"http_status":200}'
from public.study_run_targets where cohort='recovery-failed' and source_ref='fixture-1';
update public.study_run_targets set state='succeeded' where cohort='recovery-failed' and source_ref='fixture-1';

create function pg_temp.add_recovery(p_name text,p_reserve integer default 4327,
  p_attempts integer default 119478,p_dispatches integer default 19913,
  p_recovery text default 'recovery-failed',p_fingerprint text default repeat('c',64))
returns void language sql as $$
  insert into public.study_runs(cohort,revalidates_cohort,recovers_from,research_protocol_version,hash_identity_fingerprint,
    family_max_attempts,family_max_dispatches,max_attempts,max_dispatches,other_cost_reserve_cents,
    dispatch_cost_microusd,budget_cents,deadline_at,source_manifest,target_successes,success_limit)
  select p_name,revalidates_cohort,p_recovery,6,p_fingerprint,p_attempts,p_dispatches,1500,500,p_reserve,
    2700,budget_cents,deadline_at,source_manifest||jsonb_build_object('recoversFrom',p_recovery,
      'recoveryTargetsSha256',source_manifest->>'targetsSha256','targetsSha256',repeat('b',64)),100000,500
  from public.study_runs where cohort='recovery-failed';
$$;
select pg_temp.add_recovery('recovery-root');
insert into public.study_run_targets(cohort,domain_key,url,vertical,region,source_ref,sample_rank,revalidates_target_id)
select 'recovery-root',domain_key,url,vertical,region,source_ref,sample_rank,id
from public.study_run_targets where cohort='recovery-original';
update public.study_run_targets set state='failed' where cohort='recovery-root';
update public.study_runs set source_frozen_at=clock_timestamp(),state='paused',
  stop_reason='quality_gate_failed_protocol_6_text_and_password',attempts_reserved=5125,dispatches=857
where cohort='recovery-root';

create function pg_temp.add_forward(p_name text,p_reserve integer default 4559,
  p_attempts integer default 114353,p_dispatches integer default 19056,p_fingerprint text default repeat('c',64))
returns void language sql as $$
  insert into public.study_runs(cohort,recovers_from,research_protocol_version,hash_identity_fingerprint,
    family_max_attempts,family_max_dispatches,max_attempts,max_dispatches,other_cost_reserve_cents,
    dispatch_cost_microusd,budget_cents,deadline_at,source_manifest,target_successes,success_limit)
  select p_name,cohort,7,p_fingerprint,p_attempts,p_dispatches,15000,3000,p_reserve,2700,budget_cents,deadline_at,
    source_manifest||jsonb_build_object('recoversFrom',cohort,'recoveryTargetsSha256',source_manifest->>'targetsSha256',
      'mode','forward_only_excluding_prior_initial_domains','selected',3,'targetsSha256',repeat('1',64),
      'importCanonicalSha256',repeat('2',64)),100000,5000
  from public.study_runs where cohort='recovery-root';
$$;
do $$ begin
  assert (public.study_run_status('recovery-root')->>'reservedEstimateCents')::numeric=4558.39;
  begin perform pg_temp.add_forward('underfunded',4558);
    raise exception 'carry rounded down'; exception when raise_exception then assert sqlerrm='study_forward_budget_carry'; end;
  begin perform pg_temp.add_forward('reset-attempts',4559,119478);
    raise exception 'attempt budget reset'; exception when raise_exception then assert sqlerrm='study_forward_family_carry'; end;
  begin perform pg_temp.add_forward('reset-dispatches',4559,114353,19913);
    raise exception 'dispatch budget reset'; exception when raise_exception then assert sqlerrm='study_forward_family_carry'; end;
  begin perform pg_temp.add_forward('new-salt',4559,114353,19056,repeat('d',64));
    raise exception 'salt changed'; exception when raise_exception then assert sqlerrm='study_forward_predecessor_not_ready'; end;
  begin
    update public.study_run_targets set state='queued' where cohort='recovery-root';
    perform pg_temp.add_forward('unfinished-parent');
    raise exception 'nonterminal predecessor'; exception when raise_exception then assert sqlerrm='study_forward_predecessor_not_ready'; end;
end $$;
select pg_temp.add_forward('forward-root');
do $$ begin
  assert (public.study_family_status('forward-root')->>'results')::integer=0;
  assert (public.study_family_status('forward-root')->>'priorRecoveryAttempts')::integer=5125;
  assert (public.study_family_status('forward-root')->>'priorRecoveryDispatches')::integer=857;
  begin update public.study_runs set state='running' where cohort='recovery-root';
    raise exception 'old run resumed'; exception when raise_exception then assert sqlerrm='study_recovery_predecessor_closed'; end;
  begin update public.study_run_targets set state='queued' where cohort='recovery-root';
    raise exception 'old targets mutated'; exception when raise_exception then assert sqlerrm='study_recovery_predecessor_closed'; end;
  begin update public.study_runs set source_frozen_at=clock_timestamp() where cohort='forward-root';
    raise exception 'partial import frozen'; exception when raise_exception then assert sqlerrm='study_forward_incomplete'; end;
  begin insert into public.study_run_targets(cohort,domain_key,url,vertical,region,source_ref,sample_rank)
    select 'forward-root',domain_key,url,vertical,region,source_ref,sample_rank from public.study_run_targets where cohort='recovery-root';
    raise exception 'original candidates repeated'; exception when raise_exception then assert sqlerrm='study_forward_initial_duplicate'; end;
  begin update public.study_runs set dispatch_cost_microusd=5000 where cohort='forward-root';
    raise exception 'family cost exceeded'; exception when raise_exception then assert sqlerrm='study_forward_budget_carry'; end;
end $$;
insert into public.study_run_targets(cohort,domain_key,url,vertical,region,source_ref,sample_rank)
select 'forward-root','fresh'||i||'.example','https://fresh'||i||'.example','health','CA','fresh-'||i,
  encode(sha256(convert_to(i::text,'UTF8')),'hex') from generate_series(1,3) i;
do $$ begin
  begin update public.study_runs set source_frozen_at=clock_timestamp() where cohort='forward-root';
    raise exception 'wrong frame hash accepted'; exception when raise_exception then assert sqlerrm='study_forward_frame_checksum'; end;
end $$;
update public.study_runs set source_manifest=source_manifest||jsonb_build_object('importCanonicalSha256',(
  select encode(sha256(convert_to(string_agg(concat_ws(chr(9),cohort,domain_key,url,vertical,region,source_ref,sample_rank)
    ||chr(10),'' order by sample_rank),'UTF8')),'hex') from public.study_run_targets where cohort='forward-root'))
where cohort='forward-root';
update public.study_runs set source_frozen_at=clock_timestamp(),state='running' where cohort='forward-root';
do $$ begin
  begin delete from public.study_run_targets where cohort='forward-root';
    raise exception 'frozen forward targets deleted'; exception when raise_exception then assert sqlerrm='study_forward_frame_frozen'; end;
end $$;
select public.dispatch_readiness_study('forward-root');
set local role service_role;
do $$ declare d uuid; t public.study_run_targets; metrics jsonb; i integer:=0;
begin
  metrics := '{"source":"study","research_protocol_version":7,"scanner_version":2,"score":50,"http_status":200,
    "research_visible_chars":120,"research_replacement_chars":0,"research_html_bytes":200,"research_title_chars":12}';
  select id into d from public.study_run_dispatches where cohort='forward-root';
  for t in select * from public.claim_study_run_batch('forward-root',d) loop
    i:=i+1;
    begin perform public.finish_study_run_target(t.cohort,t.id,t.lease_token,metrics-'research_visible_chars',repeat('9',64),null,1,2,3);
      raise exception 'missing diagnostics accepted'; exception when raise_exception then assert sqlerrm='invalid_study_quality_evidence'; end;
    begin perform public.finish_study_run_target(t.cohort,t.id,t.lease_token,metrics||'{"research_protocol_version":6}',repeat('9',64),null,1,2,3);
      raise exception 'old score copied'; exception when raise_exception then assert sqlerrm='invalid_study_metrics'; end;
    assert public.finish_study_run_target(t.cohort,t.id,t.lease_token,metrics,repeat('9',64),null,1,2,3);
  end loop;
  assert i=3;
  assert (select count(*) from public.study_run_results where cohort='forward-root')=1;
  assert (select count(*) from public.study_run_targets where cohort='forward-root' and state='duplicate')=2;
  assert (public.study_family_status('forward-root')->>'results')::integer=1;
  assert (public.study_run_status('forward-root')->>'reservedEstimateCents')::numeric=4559.27;
end $$;
reset role;
do $$ declare fn regprocedure; begin
  foreach fn in array array['public.guard_study_forward_run()'::regprocedure,'public.guard_study_forward_target()'::regprocedure] loop
    assert not has_function_privilege('anon',fn,'EXECUTE');
    assert not has_function_privilege('authenticated',fn,'EXECUTE');
    assert not has_function_privilege('service_role',fn,'EXECUTE');
    assert (select proconfig @> array['search_path=""'] from pg_proc where oid=fn);
    assert not (select prosecdef from pg_proc where oid=fn);
  end loop;
end $$;
rollback;

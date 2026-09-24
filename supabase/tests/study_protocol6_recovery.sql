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
do $$ begin
  assert (public.study_run_status('recovery-failed')->>'reservedEstimateCents')::numeric=4326.49;
  begin perform pg_temp.add_recovery('underfunded',4326);
    raise exception 'rounded-down carry accepted'; exception when raise_exception then assert sqlerrm='study_recovery_budget_carry'; end;
  begin perform pg_temp.add_recovery('reset-attempts',4327,120000);
    raise exception 'attempt envelope reset'; exception when raise_exception then assert sqlerrm='study_recovery_family_carry'; end;
  begin perform pg_temp.add_recovery('reset-dispatches',4327,119478,20000);
    raise exception 'dispatch envelope reset'; exception when raise_exception then assert sqlerrm='study_recovery_family_carry'; end;
  begin perform pg_temp.add_recovery('missing-predecessor',4327,119478,19913,null);
    raise exception 'unlinked recovery accepted'; exception when raise_exception then assert sqlerrm='study_recovery_predecessor_not_ready'; end;
  begin perform pg_temp.add_recovery('changed-salt',4327,119478,19913,'recovery-failed',repeat('d',64));
    raise exception 'salt discontinuity accepted'; exception when raise_exception then assert sqlerrm='study_recovery_predecessor_not_ready'; end;
  begin
    update public.study_runs set state='pilot' where cohort='recovery-failed';
    perform pg_temp.add_recovery('active-predecessor');
    raise exception 'active predecessor accepted'; exception when raise_exception then assert sqlerrm='study_recovery_predecessor_not_ready'; end;
  begin
    update public.study_runs set stop_reason='manual_pause' where cohort='recovery-failed';
    perform pg_temp.add_recovery('unknown-pause');
    raise exception 'manual pause bypassed'; exception when raise_exception then assert sqlerrm='study_recovery_predecessor_not_ready'; end;
  begin insert into public.study_runs(cohort,research_protocol_version) values('unlinked-v6',6);
    raise exception 'unlinked protocol accepted'; exception when raise_exception then assert sqlerrm='study_revalidation_lineage_required'; end;
end $$;
select pg_temp.add_recovery('recovery-root');
do $$ begin
  assert (public.study_family_status('recovery-root')->>'results')::integer=0;
  assert (public.study_family_status('recovery-root')->>'priorRecoveryAttempts')::integer=522;
  assert (public.study_family_status('recovery-root')->>'priorRecoveryDispatches')::integer=87;
  assert (public.study_run_status('recovery-root')->>'recoversFrom')='recovery-failed';
  begin perform pg_temp.add_recovery('parallel-recovery');
    raise exception 'second recovery accepted'; exception when unique_violation then null; end;
  begin update public.study_runs set recovers_from=null where cohort='recovery-root';
    raise exception 'recovery detached'; exception when raise_exception then assert sqlerrm='study_revalidation_immutable'; end;
  begin update public.study_runs set source_manifest=source_manifest||'{"recoveryTargetsSha256":"wrong"}' where cohort='recovery-root';
    raise exception 'recovery source detached'; exception when raise_exception then assert sqlerrm='study_recovery_source_mismatch'; end;
  begin update public.study_runs set deadline_at=deadline_at+interval '1 day' where cohort='recovery-root';
    raise exception 'deadline extended'; exception when raise_exception then assert sqlerrm='study_recovery_budget_carry'; end;
  begin update public.study_runs set state='running' where cohort='recovery-failed';
    raise exception 'failed protocol resumed'; exception when raise_exception then assert sqlerrm='study_recovery_predecessor_closed'; end;
  begin update public.study_runs set dispatches=88 where cohort='recovery-failed';
    raise exception 'failed counter changed'; exception when raise_exception then assert sqlerrm='study_recovery_predecessor_closed'; end;
  begin delete from public.study_runs where cohort='recovery-failed';
    raise exception 'failed predecessor deleted'; exception when raise_exception then assert sqlerrm='study_recovery_predecessor_closed'; end;
  begin update public.study_run_targets set state='failed' where cohort='recovery-failed';
    raise exception 'failed targets changed'; exception when raise_exception then assert sqlerrm='study_recovery_predecessor_closed'; end;
  begin delete from public.study_run_results where cohort='recovery-failed';
    raise exception 'failed observations deleted'; exception when raise_exception then assert sqlerrm='study_recovery_predecessor_closed'; end;
  begin update public.study_run_results set metrics='{}' where cohort='recovery-failed';
    raise exception 'failed observations relabeled'; exception when raise_exception then assert sqlerrm='study_recovery_predecessor_closed'; end;
  begin insert into public.study_run_results(target_id,cohort,final_domain_hash,metrics)
    select id,cohort,sample_rank,'{}' from public.study_run_targets where cohort='recovery-failed' and source_ref='fixture-2';
    raise exception 'new old-protocol result accepted'; exception when raise_exception then assert sqlerrm='study_recovery_predecessor_closed'; end;
end $$;
-- Recheck the original frame, including targets the failed pilot never reached.
insert into public.study_run_targets(cohort,domain_key,url,vertical,region,source_ref,sample_rank,revalidates_target_id)
select 'recovery-root',domain_key,url,vertical,region,source_ref,sample_rank,id
from public.study_run_targets where cohort='recovery-original' and source_ref='fixture-1';
do $$ begin
  begin update public.study_runs set source_frozen_at=clock_timestamp() where cohort='recovery-root';
    raise exception 'only previous passes revalidated'; exception when raise_exception then assert sqlerrm='study_revalidation_incomplete'; end;
  begin insert into public.study_run_targets(cohort,domain_key,url,vertical,region,source_ref,sample_rank,revalidates_target_id)
    select 'recovery-root',domain_key,url,'retail',region,source_ref,sample_rank,id
    from public.study_run_targets where cohort='recovery-original' and source_ref='fixture-2';
    raise exception 'category changed'; exception when raise_exception then assert sqlerrm='study_revalidation_target_mismatch'; end;
end $$;
insert into public.study_run_targets(cohort,domain_key,url,vertical,region,source_ref,sample_rank,revalidates_target_id)
select 'recovery-root',domain_key,url,vertical,region,source_ref,sample_rank,id
from public.study_run_targets where cohort='recovery-original' and source_ref<>'fixture-1';
update public.study_runs set source_frozen_at=clock_timestamp(),state='pilot' where cohort='recovery-root';
select public.dispatch_readiness_study('recovery-root');
set local role service_role;
do $$ declare d uuid; t public.study_run_targets; i integer:=0; metrics jsonb; k text;
begin
  metrics := '{"source":"study","research_protocol_version":6,"scanner_version":2,"score":50,"http_status":200,
    "research_visible_chars":120,"research_replacement_chars":0,"research_html_bytes":200,"research_title_chars":12}';
  select id into d from public.study_run_dispatches where cohort='recovery-root';
  for t in select * from public.claim_study_run_batch('recovery-root',d) loop
    i:=i+1;
    foreach k in array array['research_visible_chars','research_replacement_chars','research_html_bytes','research_title_chars'] loop
      begin perform public.finish_study_run_target(t.cohort,t.id,t.lease_token,metrics-k,t.sample_rank,null,1,2,3);
        raise exception 'missing evidence accepted'; exception when raise_exception then assert sqlerrm='invalid_study_quality_evidence'; end;
    end loop;
    begin perform public.finish_study_run_target(t.cohort,t.id,t.lease_token,metrics||'{"research_visible_chars":79}',t.sample_rank,null,1,2,3);
      raise exception 'short page accepted'; exception when raise_exception then assert sqlerrm='invalid_study_quality_evidence'; end;
    begin perform public.finish_study_run_target(t.cohort,t.id,t.lease_token,metrics||'{"research_replacement_chars":47}',t.sample_rank,null,1,2,3);
      raise exception 'unreadable page accepted'; exception when raise_exception then assert sqlerrm='invalid_study_quality_evidence'; end;
    begin perform public.finish_study_run_target(t.cohort,t.id,t.lease_token,metrics||'{"research_html_bytes":1.2}',t.sample_rank,null,1,2,3);
      raise exception 'fractional evidence accepted'; exception when raise_exception then assert sqlerrm='invalid_study_quality_evidence'; end;
    begin perform public.finish_study_run_target(t.cohort,t.id,t.lease_token,metrics||'{"research_title_chars":"12"}',t.sample_rank,null,1,2,3);
      raise exception 'string evidence accepted'; exception when raise_exception then assert sqlerrm='invalid_study_quality_evidence'; end;
    begin perform public.finish_study_run_target(t.cohort,t.id,t.lease_token,metrics||'{"research_protocol_version":5}',t.sample_rank,null,1,2,3);
      raise exception 'old protocol accepted'; exception when raise_exception then assert sqlerrm='invalid_study_metrics'; end;
    begin perform public.finish_study_run_target(t.cohort,t.id,t.lease_token,metrics||'{"body":"private text"}',t.sample_rank,null,1,2,3);
      raise exception 'body accepted'; exception when raise_exception then assert sqlerrm='invalid_study_metrics'; end;
    assert public.finish_study_run_target(t.cohort,t.id,t.lease_token,
      case when i<3 then metrics else null end,case when i<3 then repeat('9',64) else null end,
      case when i<3 then null else 'unavailable_page' end,1,2,3);
  end loop;
  assert i=3;
  assert (select count(*) from public.study_run_results where cohort='recovery-root')=1;
  assert (select count(*) from public.study_run_targets where cohort='recovery-root' and state='duplicate')=1;
  assert (select count(*) from public.study_run_targets where cohort='recovery-root' and state='failed')=1;
  assert (public.study_family_status('recovery-root')->>'results')::integer=1;
  assert (public.study_family_status('recovery-root')->>'reservedEstimateCents')::numeric=4327.27;
  assert (select count(*) from public.study_run_results where cohort='recovery-original')=3;
  assert (select count(*) from public.study_run_results where cohort='recovery-failed')=1;
  update public.study_run_dispatches set finished_at=clock_timestamp(),outcome='finished' where id=d;
end $$;
reset role;
update public.study_runs set last_dispatch_at=clock_timestamp()-interval '60 seconds' where cohort='recovery-root';
do $$ begin
  assert public.dispatch_readiness_study('recovery-root')='finished';
  assert (select state from public.study_runs where cohort='recovery-root')='exhausted';
end $$;
insert into public.study_runs(cohort,continued_from,research_protocol_version,hash_identity_fingerprint,
  family_max_attempts,family_max_dispatches,max_attempts,max_dispatches,other_cost_reserve_cents,
  dispatch_cost_microusd,budget_cents,deadline_at,source_manifest,target_successes,success_limit)
select 'recovery-child',cohort,6,hash_identity_fingerprint,family_max_attempts,family_max_dispatches,
  119475,19912,4328,2700,budget_cents,deadline_at,source_manifest||jsonb_build_object('originalTargetsSha256',repeat('f',64)),100000,1000
from public.study_runs where cohort='recovery-root';
do $$ declare fn regprocedure;
begin
  assert (public.study_family_status('recovery-root')->>'results')::integer=1;
  assert (public.study_family_status('recovery-root')->>'reservedEstimateCents')::numeric=4328;
  assert (public.study_family_status('recovery-root')->>'maxAttempts')::integer+522=120000;
  assert (public.study_family_status('recovery-root')->>'maxDispatches')::integer+87=20000;
  begin update public.study_runs set max_dispatches=max_dispatches+1 where cohort='recovery-child';
    raise exception 'child allowance reset'; exception when raise_exception then assert sqlerrm='study_family_limit'; end;
  begin update public.study_runs set research_protocol_version=5 where cohort='recovery-child';
    raise exception 'protocol mixed'; exception when raise_exception then assert sqlerrm='study_parent_not_ready'; end;
  begin update public.study_runs set state='running' where cohort='recovery-root';
    raise exception 'parent resumed'; exception when raise_exception then assert sqlerrm='study_parent_closed'; end;
  foreach fn in array array['public.guard_study_recovery_predecessor()'::regprocedure,
    'public.guard_study_protocol6_evidence()'::regprocedure] loop
    assert not has_function_privilege('anon',fn,'EXECUTE');
    assert not has_function_privilege('authenticated',fn,'EXECUTE');
    assert not has_function_privilege('service_role',fn,'EXECUTE');
    assert (select proconfig @> array['search_path=""'] from pg_proc where oid=fn);
  end loop;
end $$;
rollback;

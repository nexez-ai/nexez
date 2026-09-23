-- Disposable PostgreSQL only. No external HTTP and no production changes.
\set ON_ERROR_STOP on
begin;
set local plpgsql.check_asserts=on;
insert into public.study_control(key,enabled) values('research',true);
insert into vault.decrypted_secrets(name,decrypted_secret) values('nexez_readiness_research_bearer','local-fixture-only');
insert into public.study_runs(cohort,research_protocol_version,max_attempts,max_dispatches,other_cost_reserve_cents,source_manifest)
values('revalidation-predecessor',4,15000,3000,3305,jsonb_build_object('sourceJsonlSha256',repeat('d',64),
  'mappingSha256',repeat('e',64),'selectionSeedCohort','original-seed','parentTargetsSha256',repeat('f',64)));
insert into public.study_run_targets(cohort,domain_key,url,vertical,region,source_ref,sample_rank)
select 'revalidation-predecessor','original'||i||'.example','https://original'||i||'.example','health','CA','fixture-'||i,
  encode(sha256(convert_to(i::text,'UTF8')),'hex') from generate_series(1,3) i;
insert into public.study_run_results(target_id,cohort,final_domain_hash,metrics)
select id,cohort,sample_rank,'{"source":"study","research_protocol_version":4,"scanner_version":2,"score":50,"http_status":200}'
from public.study_run_targets where cohort='revalidation-predecessor' and source_ref<>'fixture-3';
update public.study_run_targets set state='succeeded' where cohort='revalidation-predecessor' and source_ref<>'fixture-3';
update public.study_runs set source_frozen_at=clock_timestamp(),state='paused',
  stop_reason='quality_gate_failed_protocol_4_templates',dispatches=1995,attempts_reserved=11809
where cohort='revalidation-predecessor';

create function pg_temp.add_revalidation(p_name text,p_reserve integer default 4303,p_protocol integer default 5)
returns void language sql as $$
  insert into public.study_runs(cohort,revalidates_cohort,research_protocol_version,hash_identity_fingerprint,
    family_max_attempts,family_max_dispatches,max_attempts,max_dispatches,other_cost_reserve_cents,
    dispatch_cost_microusd,budget_cents,deadline_at,source_manifest,target_successes,success_limit)
  select p_name,cohort,p_protocol,repeat('c',64),120000,20000,1500,500,p_reserve,
    2700,budget_cents,deadline_at,source_manifest||jsonb_build_object('revalidatesCohort',cohort,'targetsSha256',repeat('a',64)),100000,500
  from public.study_runs where cohort='revalidation-predecessor';
$$;
do $$ begin
  assert (public.study_run_status('revalidation-predecessor')->>'reservedEstimateCents')::numeric=4302.5;
  begin perform pg_temp.add_revalidation('underfunded-recheck',4302);
    raise exception 'rounded down carry accepted'; exception when raise_exception then assert sqlerrm='study_revalidation_budget_carry'; end;
  begin perform pg_temp.add_revalidation('mixed-recheck',4303,4);
    raise exception 'old protocol recheck accepted'; exception when raise_exception then assert sqlerrm='study_revalidation_predecessor_not_ready'; end;
  begin
    update public.study_runs set state='running' where cohort='revalidation-predecessor';
    perform pg_temp.add_revalidation('active-parent-recheck');
    raise exception 'active predecessor accepted'; exception when raise_exception then assert sqlerrm='study_revalidation_predecessor_not_ready';
  end;
  begin
    update public.study_runs set stop_reason='manual_pause' where cohort='revalidation-predecessor';
    perform pg_temp.add_revalidation('manual-pause-recheck');
    raise exception 'unrelated pause bypassed'; exception when raise_exception then assert sqlerrm='study_revalidation_predecessor_not_ready';
  end;
  begin insert into public.study_runs(cohort,research_protocol_version) values('unlinked-correction',5);
    raise exception 'unlinked correction accepted'; exception when raise_exception then assert sqlerrm='study_revalidation_lineage_required'; end;
end $$;
select pg_temp.add_revalidation('revalidation-root');
do $$ begin
  assert (public.study_run_status('revalidation-root')->>'revalidatesCohort')='revalidation-predecessor';
  assert (public.study_family_status('revalidation-root')->>'reservedEstimateCents')::numeric=4303;
  begin perform pg_temp.add_revalidation('parallel-correction');
    raise exception 'second correction accepted'; exception when unique_violation then null; end;
  begin update public.study_runs set state='running' where cohort='revalidation-predecessor';
    raise exception 'predecessor resumed'; exception when raise_exception then assert sqlerrm='study_revalidation_predecessor_closed'; end;
  begin update public.study_runs set dispatches=dispatches+1 where cohort='revalidation-predecessor';
    raise exception 'predecessor cost changed'; exception when raise_exception then assert sqlerrm='study_revalidation_predecessor_closed'; end;
  begin update public.study_run_results set metrics='{}' where cohort='revalidation-predecessor';
    raise exception 'old scores overwritten'; exception when raise_exception then assert sqlerrm='study_revalidation_predecessor_closed'; end;
  begin delete from public.study_run_results where cohort='revalidation-predecessor';
    raise exception 'old results deleted'; exception when raise_exception then assert sqlerrm='study_revalidation_predecessor_closed'; end;
  begin update public.study_run_targets set state='queued' where cohort='revalidation-predecessor';
    raise exception 'old targets changed'; exception when raise_exception then assert sqlerrm='study_revalidation_predecessor_closed'; end;
  begin update public.study_runs set revalidates_cohort=null where cohort='revalidation-root';
    raise exception 'root detached'; exception when raise_exception then assert sqlerrm='study_revalidation_immutable'; end;
  begin update public.study_runs set state='pilot' where cohort='revalidation-root';
    raise exception 'unfrozen root started'; exception when raise_exception then assert sqlerrm='study_revalidation_unfrozen'; end;
  begin update public.study_runs set source_frozen_at=clock_timestamp() where cohort='revalidation-root';
    raise exception 'empty frame frozen'; exception when raise_exception then assert sqlerrm='study_revalidation_incomplete'; end;
  begin insert into public.study_run_targets(cohort,domain_key,url,vertical,region,source_ref,sample_rank,revalidates_target_id)
    select 'revalidation-root',domain_key,url,'retail',region,source_ref,sample_rank,id
    from public.study_run_targets where cohort='revalidation-predecessor' and source_ref='fixture-1';
    raise exception 'changed category accepted'; exception when raise_exception then assert sqlerrm='study_revalidation_target_mismatch'; end;
  begin insert into public.study_run_targets(cohort,domain_key,url,vertical,region,source_ref,sample_rank,revalidates_target_id)
    select 'revalidation-root',domain_key,url,vertical,region,source_ref,sample_rank,id
    from public.study_run_targets where cohort='revalidation-predecessor' and source_ref='fixture-3';
    raise exception 'nonresult target included'; exception when raise_exception then assert sqlerrm='study_revalidation_target_mismatch'; end;
end $$;
insert into public.study_run_targets(cohort,domain_key,url,vertical,region,source_ref,sample_rank,revalidates_target_id)
select 'revalidation-root',domain_key,url,vertical,region,source_ref,sample_rank,id
from public.study_run_targets where cohort='revalidation-predecessor' and source_ref='fixture-1';
do $$ begin
  begin update public.study_runs set source_frozen_at=clock_timestamp() where cohort='revalidation-root';
    raise exception 'partial frame frozen'; exception when raise_exception then assert sqlerrm='study_revalidation_incomplete'; end;
end $$;
insert into public.study_run_targets(cohort,domain_key,url,vertical,region,source_ref,sample_rank,revalidates_target_id)
select 'revalidation-root',domain_key,url,vertical,region,source_ref,sample_rank,id
from public.study_run_targets where cohort='revalidation-predecessor' and source_ref='fixture-2';
update public.study_runs set source_frozen_at=clock_timestamp(),state='pilot' where cohort='revalidation-root';
do $$ begin
  begin delete from public.study_run_targets where cohort='revalidation-root';
    raise exception 'frozen revalidation target deleted'; exception when raise_exception then assert sqlerrm='study_revalidation_frame_frozen'; end;
  begin update public.study_run_targets set revalidates_target_id=null where cohort='revalidation-root';
    raise exception 'target detached'; exception when raise_exception then assert sqlerrm='study_revalidation_target_immutable'; end;
end $$;
select public.dispatch_readiness_study('revalidation-root');
set local role service_role;
do $$ declare d uuid; t public.study_run_targets; i integer:=0; metrics jsonb;
begin
  metrics := '{"source":"study","research_protocol_version":5,"scanner_version":2,"score":50,"http_status":200,
    "research_visible_chars":120,"research_replacement_chars":0,"research_html_bytes":200,"research_title_chars":12}';
  select id into d from public.study_run_dispatches where cohort='revalidation-root';
  for t in select * from public.claim_study_run_batch('revalidation-root',d) loop
    i:=i+1;
    begin perform public.finish_study_run_target(t.cohort,t.id,t.lease_token,metrics-'research_visible_chars',t.sample_rank,null,1,2,3);
      raise exception 'missing evidence accepted'; exception when raise_exception then assert sqlerrm='invalid_study_quality_evidence'; end;
    begin perform public.finish_study_run_target(t.cohort,t.id,t.lease_token,metrics||'{"research_visible_chars":79}',t.sample_rank,null,1,2,3);
      raise exception 'short page accepted'; exception when raise_exception then assert sqlerrm='invalid_study_quality_evidence'; end;
    begin perform public.finish_study_run_target(t.cohort,t.id,t.lease_token,metrics||'{"research_replacement_chars":47}',t.sample_rank,null,1,2,3);
      raise exception 'unreadable page accepted'; exception when raise_exception then assert sqlerrm='invalid_study_quality_evidence'; end;
    begin perform public.finish_study_run_target(t.cohort,t.id,t.lease_token,metrics||'{"research_html_bytes":1.2}',t.sample_rank,null,1,2,3);
      raise exception 'fractional evidence accepted'; exception when raise_exception then assert sqlerrm='invalid_study_quality_evidence'; end;
    begin perform public.finish_study_run_target(t.cohort,t.id,t.lease_token,metrics||'{"research_title_chars":"12"}',t.sample_rank,null,1,2,3);
      raise exception 'string evidence accepted'; exception when raise_exception then assert sqlerrm='invalid_study_quality_evidence'; end;
    begin perform public.finish_study_run_target(t.cohort,t.id,t.lease_token,metrics||'{"research_protocol_version":4}',t.sample_rank,null,1,2,3);
      raise exception 'old metric relabeled'; exception when raise_exception then assert sqlerrm='invalid_study_metrics'; end;
    begin perform public.finish_study_run_target(t.cohort,t.id,t.lease_token,metrics||'{"html":"private body"}',t.sample_rank,null,1,2,3);
      raise exception 'page persisted'; exception when raise_exception then assert sqlerrm='invalid_study_metrics'; end;
    assert public.finish_study_run_target(t.cohort,t.id,t.lease_token,
      case when i=1 then metrics else null end,case when i=1 then t.sample_rank else null end,
      case when i=1 then null else 'unavailable_page' end,1,2,3);
  end loop;
  assert i=2;
  assert (select count(*) from public.study_run_results where cohort='revalidation-root')=1;
  assert (select count(*) from public.study_run_targets where cohort='revalidation-root' and state='failed')=1;
  assert (public.study_family_status('revalidation-root')->>'results')::integer=1,
    'old metrics and revalidation failures must not count or become zero scores';
  assert (public.study_family_status('revalidation-root')->>'reservedEstimateCents')::numeric=4303.27;
  assert (select count(*) from public.study_run_results where cohort='revalidation-predecessor')=2;
  update public.study_run_dispatches set finished_at=clock_timestamp(),outcome='finished' where id=d;
end $$;
reset role;
update public.study_runs set last_dispatch_at=clock_timestamp()-interval '60 seconds' where cohort='revalidation-root';
do $$ begin
  assert public.dispatch_readiness_study('revalidation-root')='finished';
  assert (select state from public.study_runs where cohort='revalidation-root')='exhausted';
end $$;
-- A corrected continuation uses the same protocol, bounded family and carry.
insert into public.study_runs(cohort,continued_from,research_protocol_version,hash_identity_fingerprint,
  family_max_attempts,family_max_dispatches,max_attempts,max_dispatches,other_cost_reserve_cents,
  dispatch_cost_microusd,budget_cents,deadline_at,source_manifest,target_successes,success_limit)
select 'revalidation-child',cohort,5,hash_identity_fingerprint,family_max_attempts,family_max_dispatches,
  119998,19999,4304,2700,budget_cents,deadline_at,source_manifest||jsonb_build_object('originalTargetsSha256',repeat('f',64)),100000,1000
from public.study_runs where cohort='revalidation-root';
do $$ declare fn regprocedure;
begin
  assert (public.study_family_status('revalidation-root')->>'results')::integer=1;
  begin update public.study_runs set state='running' where cohort='revalidation-root';
    raise exception 'corrected parent resumed'; exception when raise_exception then assert sqlerrm='study_parent_closed'; end;
  begin update public.study_runs set research_protocol_version=4 where cohort='revalidation-child';
    raise exception 'cross protocol continuation accepted'; exception when raise_exception then assert sqlerrm='study_parent_not_ready'; end;
  foreach fn in array array['public.guard_study_revalidation_run()'::regprocedure,
    'public.guard_study_revalidation_target()'::regprocedure,'public.guard_study_revalidation_result()'::regprocedure] loop
    assert not has_function_privilege('anon',fn,'EXECUTE');
    assert not has_function_privilege('authenticated',fn,'EXECUTE');
    assert (select proconfig @> array['search_path=""'] from pg_proc where oid=fn);
  end loop;
end $$;
rollback;

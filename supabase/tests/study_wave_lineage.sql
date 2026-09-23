-- Disposable PostgreSQL only. All data rolls back; HTTP is stubbed by bootstrap.
\set ON_ERROR_STOP on
begin;
set local plpgsql.check_asserts=on;
insert into public.study_control(key,enabled) values('research',true);
insert into vault.decrypted_secrets(name,decrypted_secret) values('nexez_readiness_research_bearer','local-fixture-only');
insert into public.study_runs(cohort,research_protocol_version,target_successes,success_limit,max_attempts,max_dispatches,source_manifest)
values('wave-root',4,100,100,8,4,jsonb_build_object('sourceJsonlSha256',repeat('d',64),
  'mappingSha256',repeat('e',64),'selectionSeedCohort','original-seed','parentTargetsSha256',repeat('f',64)));
insert into public.study_run_targets(cohort,domain_key,url,vertical,region,source_ref,sample_rank)
select 'wave-root','root'||i||'.example','https://root'||i||'.example','health','CA','fixture-'||i,
  encode(sha256(convert_to(i::text,'UTF8')),'hex') from generate_series(1,2) i;
update public.study_runs set source_frozen_at=clock_timestamp(),state='running' where cohort='wave-root';
do $$ begin
  begin update public.study_runs set hash_identity_fingerprint=repeat('c',64),family_max_attempts=20,family_max_dispatches=10 where cohort='wave-root';
    raise exception 'active seal accepted'; exception when raise_exception then assert sqlerrm='study_identity_seal_requires_stopped_run'; end;
end $$;
select public.dispatch_readiness_study('wave-root');
do $$ declare d uuid; t public.study_run_targets; i integer:=0;
begin
  select id into d from public.study_run_dispatches where cohort='wave-root';
  for t in select * from public.claim_study_run_batch('wave-root',d) loop
    i:=i+1;
    assert public.finish_study_run_target(t.cohort,t.id,t.lease_token,
      '{"source":"study","research_protocol_version":4,"scanner_version":2,"score":50,"http_status":200}',
      repeat(case when i=1 then 'a' else 'b' end,64),null,1,2,3);
  end loop;
  assert i=2;
  update public.study_run_dispatches set finished_at=clock_timestamp(),outcome='finished' where id=d;
  update public.study_runs set state='exhausted' where cohort='wave-root';
  update public.study_runs set hash_identity_fingerprint=repeat('c',64),
    family_max_attempts=20,family_max_dispatches=10 where cohort='wave-root';
end $$;

create function pg_temp.add_wave(p_name text,p_parent text default 'wave-root',p_reserve integer default 3001,
  p_hash text default repeat('c',64),p_protocol integer default 4) returns void language sql as $$
  insert into public.study_runs(cohort,continued_from,research_protocol_version,hash_identity_fingerprint,
    family_max_attempts,family_max_dispatches,max_attempts,max_dispatches,other_cost_reserve_cents,
    dispatch_cost_microusd,budget_cents,deadline_at,source_manifest,target_successes,success_limit)
  select p_name,p_parent,p_protocol,p_hash,family_max_attempts,family_max_dispatches,18,9,p_reserve,
    2700,budget_cents,deadline_at,jsonb_build_object('sourceJsonlSha256',repeat('d',64),
    'mappingSha256',repeat('e',64),'selectionSeedCohort','original-seed','originalTargetsSha256',repeat('f',64)),100,100
  from public.study_runs where cohort=p_parent;
$$;
do $$ begin
  assert (public.study_run_status('wave-root')->>'dispatchReservedMicroUsd')::bigint=5000;
  assert (public.study_family_status('wave-root')->>'results')::integer=2;
  begin perform pg_temp.add_wave('underfunded-wave','wave-root',3000);
    raise exception 'cost reset accepted'; exception when raise_exception then assert sqlerrm='study_continuation_budget_carry'; end;
  begin perform pg_temp.add_wave('wrong-hash-wave','wave-root',3001,repeat('0',64));
    raise exception 'changed identity accepted'; exception when raise_exception then assert sqlerrm='study_parent_not_ready'; end;
  begin perform pg_temp.add_wave('wrong-protocol-wave','wave-root',3001,repeat('c',64),3);
    raise exception 'protocol mixing accepted'; exception when raise_exception then assert sqlerrm='study_lineage_protocol'; end;
  begin
    update public.study_runs set state='paused' where cohort='wave-root';
    perform pg_temp.add_wave('unfinished-parent-wave');
    raise exception 'paused parent accepted'; exception when raise_exception then assert sqlerrm='study_parent_not_ready';
  end;
  begin update public.study_runs set family_max_attempts=21 where cohort='wave-root';
    raise exception 'expanded family accepted'; exception when raise_exception then assert sqlerrm='study_family_bound_immutable'; end;
  begin update public.study_runs set source_manifest='{}' where cohort='wave-root';
    raise exception 'source rewrite accepted'; exception when raise_exception then assert sqlerrm='study_family_source_frozen'; end;
  begin update public.study_runs set hash_identity_fingerprint=repeat('0',64) where cohort='wave-root';
    raise exception 'changed root identity accepted'; exception when raise_exception then assert sqlerrm='study_family_bound_immutable'; end;
end $$;
select pg_temp.add_wave('wave-child');
do $$ begin
  begin perform pg_temp.add_wave('second-child');
    raise exception 'parallel branch accepted'; exception when unique_violation then null; end;
  begin perform pg_temp.add_wave('third-wave','wave-child');
    raise exception 'unbounded chain accepted'; exception when raise_exception then assert sqlerrm='study_parent_not_ready'; end;
  begin update public.study_runs set state='running' where cohort='wave-root';
    raise exception 'parent resumed'; exception when raise_exception then assert sqlerrm='study_parent_closed'; end;
  begin update public.study_runs set dispatches=dispatches+1 where cohort='wave-root';
    raise exception 'closed parent charged'; exception when raise_exception then assert sqlerrm='study_parent_closed'; end;
  begin update public.study_runs set attempts_reserved=attempts_reserved+1 where cohort='wave-root';
    raise exception 'closed parent scanned'; exception when raise_exception then assert sqlerrm='study_parent_closed'; end;
  begin update public.study_runs set continued_from=null where cohort='wave-child';
    raise exception 'child detached'; exception when raise_exception then assert sqlerrm='study_lineage_immutable'; end;
  begin update public.study_runs set max_attempts=19 where cohort='wave-child';
    raise exception 'combined attempts over cap'; exception when raise_exception then assert sqlerrm='study_family_limit'; end;
  begin update public.study_runs set max_dispatches=10 where cohort='wave-child';
    raise exception 'combined dispatches over cap'; exception when raise_exception then assert sqlerrm='study_family_limit'; end;
  begin update public.study_runs set deadline_at=deadline_at+interval '1 second' where cohort='wave-child';
    raise exception 'deadline extended'; exception when raise_exception then assert sqlerrm='study_family_bound_immutable'; end;
  begin update public.study_runs set source_manifest=source_manifest||'{"selectionSeedCohort":"different-seed"}' where cohort='wave-child';
    raise exception 'new seed accepted'; exception when raise_exception then assert sqlerrm='study_continuation_source_mismatch'; end;
  begin insert into public.study_run_targets(cohort,domain_key,url,vertical,region,source_ref,sample_rank)
    select 'wave-child',domain_key,url,vertical,region,source_ref,sample_rank from public.study_run_targets where cohort='wave-root' limit 1;
    raise exception 'initial duplicate accepted'; exception when raise_exception then assert sqlerrm='study_continuation_initial_duplicate'; end;
end $$;
insert into public.study_run_targets(cohort,domain_key,url,vertical,region,source_ref,sample_rank)
select 'wave-child','child'||i||'.example','https://child'||i||'.example','health','CA','child-'||i,
  encode(sha256(convert_to(i::text,'UTF8')),'hex') from generate_series(1,2) i;
update public.study_runs set source_frozen_at=clock_timestamp(),state='running' where cohort='wave-child';
select public.dispatch_readiness_study('wave-child');
set local role service_role;
do $$ declare d uuid; t public.study_run_targets; i integer:=0; family jsonb;
begin
  select id into d from public.study_run_dispatches where cohort='wave-child';
  for t in select * from public.claim_study_run_batch('wave-child',d) loop
    i:=i+1;
    assert public.finish_study_run_target(t.cohort,t.id,t.lease_token,
      '{"source":"study","research_protocol_version":4,"scanner_version":2,"score":50,"http_status":200}',
      repeat(case when i=1 then 'a' else '9' end,64),null,1,2,3);
  end loop;
  assert i=2;
  assert (select count(*) from public.study_run_targets where cohort='wave-child' and state='duplicate')=1,
    'cross-wave redirect duplicates must be exclusions';
  assert (select count(*) from public.study_run_results where cohort='wave-child')=1;
  assert (select identity_cohort from public.study_run_results where cohort='wave-child')='wave-root';
  family:=public.study_family_status('wave-root');
  assert (family->>'results')::integer=3 and (family->>'uniqueFinalDomains')::integer=3;
  assert (family->>'attempts')::integer=4 and (family->>'dispatches')::integer=2;
  assert (family->>'reservedEstimateCents')::numeric=3001.27,
    'parent cost rounds upward once; never double count the carry or reprice the first dispatch';
  assert (family->>'activeWaves')::integer=1;
  assert family::text not like '%.example%', 'family status must remain aggregate';
  assert public.study_family_status('wave-child') is null, 'child is not a second root budget';
  begin update public.study_runs set attempts_reserved=0 where cohort='wave-child';
    raise exception 'attempt counter reset'; exception when raise_exception then assert sqlerrm='study_family_bound_immutable'; end;
end $$;
reset role;
-- Audit-only earlier protocols remain separate even when final hashes match.
insert into public.study_runs(cohort,research_protocol_version) values('superseded-fixture',3);
insert into public.study_run_targets(cohort,domain_key,url,vertical,region,source_ref,sample_rank)
values('superseded-fixture','old.example','https://old.example','health','CA','old',repeat('1',64));
insert into public.study_run_results(target_id,cohort,final_domain_hash,metrics)
select id,cohort,repeat('a',64),'{}'::jsonb from public.study_run_targets where cohort='superseded-fixture';
do $$ declare fn regprocedure;
begin
  assert (select count(*) from public.study_run_results where final_domain_hash=repeat('a',64))=2;
  assert (public.study_family_status('wave-root')->>'results')::integer=3;
  begin update public.study_run_results set identity_cohort='wave-root' where cohort='superseded-fixture';
    raise exception 'superseded result relabeled'; exception when raise_exception then assert sqlerrm='study_result_identity_immutable'; end;
  foreach fn in array array['public.guard_study_wave_lineage()'::regprocedure,
    'public.guard_study_wave_initial_domain()'::regprocedure,'public.guard_study_result_identity()'::regprocedure,
    'public.study_family_status(text)'::regprocedure] loop
    assert not has_function_privilege('anon',fn,'EXECUTE');
    assert not has_function_privilege('authenticated',fn,'EXECUTE');
    assert (select proconfig @> array['search_path=""'] from pg_proc where oid=fn);
  end loop;
end $$;
rollback;

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
  -- Historical charges cannot be reset to test another boundary.
  update public.study_runs set budget_cents=3001,dispatch_cost_microusd=20000,max_dispatches=max_dispatches+1 where cohort=t.cohort;
  update public.study_runs set state='pilot' where cohort=t.cohort;
  assert public.dispatch_readiness_study(t.cohort)='paused', 'cost reserve prevents overspend estimate';
  update public.study_runs set state='pilot',deadline_at=clock_timestamp()-interval '1 second' where cohort=t.cohort;
  assert public.dispatch_readiness_study(t.cohort)='paused', 'deadline stop';
end $$;

-- Changing a continuation rate must not discount any historical reservation.
insert into public.study_runs(cohort,research_protocol_version) values('test-cost-ledger',4);
insert into public.study_run_targets(cohort,domain_key,url,vertical,region,source_ref,sample_rank)
  values('test-cost-ledger','ledger.com','https://ledger.com','retail','CA','fixture-ledger',repeat('f',64));
update public.study_runs set source_frozen_at=clock_timestamp(),state='pilot' where cohort='test-cost-ledger';
do $$
declare before_reserved numeric;
begin
  assert (select success_limit=500 and max_attempts=1500 and max_dispatches=500
    and dispatch_cost_microusd=5000 and dispatch_reserved_microusd=0
    from public.study_runs where cohort='test-cost-ledger'), 'ledger preserves active defaults';
  assert public.dispatch_readiness_study('test-cost-ledger')='dispatched';
  assert (select dispatch_reserved_microusd=5000 from public.study_runs where cohort='test-cost-ledger');
  begin update public.study_runs set dispatch_cost_microusd=2700 where cohort='test-cost-ledger';
    raise exception 'active rate changed'; exception when raise_exception then assert sqlerrm='study_rate_change_requires_stopped_run'; end;
  update public.study_runs set state='pilot_review' where cohort='test-cost-ledger';
  select (public.study_run_status('test-cost-ledger')->>'reservedEstimateCents')::numeric into before_reserved;
  update public.study_runs set dispatch_cost_microusd=2700 where cohort='test-cost-ledger';
  assert (public.study_run_status('test-cost-ledger')->>'reservedEstimateCents')::numeric=before_reserved, 'past charges retained at original rate';
  begin update public.study_runs set dispatch_reserved_microusd=0 where cohort='test-cost-ledger';
    raise exception 'ledger reset'; exception when raise_exception then assert sqlerrm='study_dispatch_reserve_immutable'; end;
  begin update public.study_runs set dispatches=0 where cohort='test-cost-ledger';
    raise exception 'dispatch count reset'; exception when raise_exception then assert sqlerrm='study_dispatch_reserve_immutable'; end;
  begin update public.study_runs set other_cost_reserve_cents=2999 where cohort='test-cost-ledger';
    raise exception 'base reserve lowered'; exception when raise_exception then assert sqlerrm='study_dispatch_reserve_immutable'; end;
  begin update public.study_runs set dispatch_cost_microusd=2699 where cohort='test-cost-ledger';
    raise exception 'unsupported cost floor'; exception when check_violation then null; end;
  begin update public.study_runs set max_attempts=150001 where cohort='test-cost-ledger';
    raise exception 'attempt ceiling removed'; exception when check_violation then null; end;
  begin update public.study_runs set max_dispatches=25001 where cohort='test-cost-ledger';
    raise exception 'dispatch ceiling removed'; exception when check_violation then null; end;
  update public.study_runs set max_attempts=150000,max_dispatches=25000 where cohort='test-cost-ledger';
  -- Back-to-back scheduling is forced only in this local rollback fixture.
  update public.study_run_dispatches set finished_at=clock_timestamp() where cohort='test-cost-ledger';
  update public.study_runs set state='running',last_dispatch_at=null where cohort='test-cost-ledger';
  assert public.dispatch_readiness_study('test-cost-ledger')='dispatched';
  assert (select dispatches=2 and dispatch_reserved_microusd=7700 from public.study_runs where cohort='test-cost-ledger');
  assert (public.study_run_status('test-cost-ledger')->>'reservedEstimateCents')::numeric=3000.77;
  update public.study_runs set budget_cents=3001 where cohort='test-cost-ledger';
  -- 7,700 historical micro-USD plus 2,700 exceeds the remaining 10,000.
  -- Repricing both old dispatches at 2,700 would incorrectly permit this.
  assert public.dispatch_readiness_study('test-cost-ledger')='paused', 'budget uses original charged rates';
  assert (select dispatches=2 and dispatch_reserved_microusd=7700 from public.study_runs where cohort='test-cost-ledger');
end $$;

-- Exact budget boundary is allowed, the next dispatch stops without charging.
insert into public.study_runs(cohort,budget_cents,other_cost_reserve_cents)
  values('test-exact-budget',3001,3000);
insert into public.study_run_targets(cohort,domain_key,url,vertical,region,source_ref,sample_rank)
  values('test-exact-budget','boundary.com','https://boundary.com','retail','CA','fixture-boundary',repeat('e',64));
update public.study_runs set source_frozen_at=clock_timestamp(),state='pilot' where cohort='test-exact-budget';
do $$ begin
  assert public.dispatch_readiness_study('test-exact-budget')='dispatched';
  update public.study_run_dispatches set finished_at=clock_timestamp() where cohort='test-exact-budget';
  update public.study_runs set last_dispatch_at=null where cohort='test-exact-budget';
  assert public.dispatch_readiness_study('test-exact-budget')='dispatched';
  assert (public.study_run_status('test-exact-budget')->>'reservedEstimateCents')::numeric=3001;
  update public.study_run_dispatches set finished_at=clock_timestamp() where cohort='test-exact-budget';
  update public.study_runs set last_dispatch_at=null where cohort='test-exact-budget';
  assert public.dispatch_readiness_study('test-exact-budget')='paused';
  assert (select dispatches=2 and dispatch_reserved_microusd=10000 from public.study_runs where cohort='test-exact-budget');
end $$;

-- Protocol 2 is a new cohort, never a relabeling of frozen old observations.
insert into public.study_runs(cohort,target_successes,success_limit,research_protocol_version)
  values('test-quality',60000,2,2),('test-quality-failures',60000,500,2);
insert into public.study_run_targets(cohort,domain_key,url,vertical,region,source_ref,sample_rank)
  select c,'quality'||i||'.com','https://quality'||i||'.com','retail','CA','fixture-'||i,
    encode(sha256(convert_to(i::text,'UTF8')),'hex')
  from unnest(array['test-quality','test-quality-failures']) c cross join generate_series(1,6) i;
update public.study_runs set source_frozen_at=clock_timestamp(),state='pilot' where cohort in ('test-quality','test-quality-failures');
do $$
begin
  assert (public.study_run_status('test-quality')->>'researchProtocolVersion')::integer=2;
  assert (public.study_run_status('test-study')->>'researchProtocolVersion')::integer=1;
  assert (select success_limit=2 and max_attempts=1500 and max_dispatches=500 and budget_cents=10000
    from public.study_runs where cohort='test-quality'), 'extended target does not change active caps';
  begin update public.study_runs set research_protocol_version=2 where cohort='test-study';
    raise exception 'frozen protocol changed'; exception when raise_exception then assert sqlerrm='study_protocol_frozen'; end;
  begin insert into public.study_runs(cohort,target_successes) values('test-unbounded',100001);
    raise exception 'unbounded target accepted'; exception when check_violation then null; end;
  begin update public.study_runs set budget_cents=10001 where cohort='test-quality';
    raise exception 'budget ceiling bypassed'; exception when check_violation then null; end;
  assert public.dispatch_readiness_study('test-quality')='dispatched';
  assert public.dispatch_readiness_study('test-quality-failures')='dispatched';
end $$;
set local role service_role;
do $$
declare d uuid; t public.study_run_targets; good jsonb; reason text; i integer:=0;
begin
  select id into d from public.study_run_dispatches where cohort='test-quality';
  assert (select count(*) from public.claim_study_run_batch('test-quality',d))=2, 'protocol 2 still respects pilot limit';
  good := '{"source":"study","scanner_version":2,"research_protocol_version":2,"score":50,"http_status":200}';
  for t in select * from public.study_run_targets where cohort='test-quality' and state='running' loop
    begin perform public.finish_study_run_target(t.cohort,t.id,t.lease_token,good-'research_protocol_version',repeat('c',64),null,1,2,3);
      raise exception 'old observation mixed into new protocol'; exception when raise_exception then assert sqlerrm='invalid_study_metrics'; end;
    begin perform public.finish_study_run_target(t.cohort,t.id,t.lease_token,good||'{"pageText":"private"}',repeat('c',64),null,1,2,3);
      raise exception 'raw content accepted'; exception when raise_exception then assert sqlerrm='invalid_study_metrics'; end;
    i:=i+1;
    assert public.finish_study_run_target(t.cohort,t.id,t.lease_token,good,repeat(i::text,64),null,1,2,3);
  end loop;
  assert (select state='pilot_review' from public.study_runs where cohort='test-quality'), 'protocol 2 automatic review stop';
  select id into d from public.study_run_dispatches where cohort='test-quality-failures';
  assert (select count(*) from public.claim_study_run_batch('test-quality-failures',d))=6;
  foreach reason in array array['non_html','insufficient_content','challenge_page','parked_domain','unavailable_page','excluded_destination'] loop
    select * into t from public.study_run_targets where cohort='test-quality-failures' and state='running' limit 1;
    assert public.finish_study_run_target(t.cohort,t.id,t.lease_token,null,null,reason,1,2,3);
    assert (select state='failed' and failure_code=reason from public.study_run_targets where id=t.id), 'quality exclusions do not retry';
  end loop;
  assert (select count(*) from public.study_run_results where cohort='test-quality-failures')=0, 'unusable pages never scored';
end $$;
reset role;

-- Protocol 3 retains earlier cohorts for audit, with a separate frozen frame.
insert into public.study_runs(cohort,research_protocol_version) values('test-v3-defaults',3);
insert into public.study_runs(cohort,target_successes,success_limit,research_protocol_version)
  values('test-v3',60000,2,3);
insert into public.study_run_targets(cohort,domain_key,url,vertical,region,source_ref,sample_rank)
  select 'test-v3','v3target'||i||'.com','https://v3target'||i||'.com','retail','CA','v3-'||i,
    encode(sha256(convert_to(i::text,'UTF8')),'hex') from generate_series(1,3) i;
update public.study_runs set source_frozen_at=clock_timestamp(),state='pilot' where cohort='test-v3';
do $$
begin
  assert (select success_limit=500 and max_attempts=1500 and max_dispatches=500 and budget_cents=10000
    from public.study_runs where cohort='test-v3-defaults'), 'v3 preserves pilot and budget defaults';
  assert (public.study_run_status('test-v3')->>'researchProtocolVersion')::integer=3;
  begin update public.study_runs set research_protocol_version=3 where cohort='test-quality';
    raise exception 'protocol 2 relabeled'; exception when raise_exception then assert sqlerrm='study_protocol_frozen'; end;
  begin insert into public.study_runs(cohort,research_protocol_version) values('test-unknown-protocol',8);
    raise exception 'unknown protocol accepted'; exception when check_violation then null; end;
  assert public.dispatch_readiness_study('test-v3')='dispatched';
end $$;
set local role service_role;
do $$
declare d uuid; t public.study_run_targets; good jsonb; i integer:=0;
begin
  select id into d from public.study_run_dispatches where cohort='test-v3';
  assert (select count(*) from public.claim_study_run_batch('test-v3',d))=2, 'v3 cannot overshoot pilot';
  good := '{"source":"study","scanner_version":2,"research_protocol_version":3,"score":50,"http_status":200}';
  for t in select * from public.study_run_targets where cohort='test-v3' and state='running' loop
    begin perform public.finish_study_run_target(t.cohort,t.id,t.lease_token,good||'{"research_protocol_version":2}',repeat('d',64),null,1,2,3);
      raise exception 'protocol 2 observation accepted'; exception when raise_exception then assert sqlerrm='invalid_study_metrics'; end;
    i:=i+1;
    assert public.finish_study_run_target(t.cohort,t.id,t.lease_token,good,repeat(i::text,64),null,1,2,3);
  end loop;
  assert (select state='pilot_review' from public.study_runs where cohort='test-v3'), 'v3 automatic review stop';
end $$;
reset role;
do $$ begin assert public.dispatch_readiness_study('test-v3')='inactive'; end $$;

-- Protocol 4 must not relabel or consume any frozen protocol-3 observations.
insert into public.study_runs(cohort,research_protocol_version) values('test-v4-defaults',4);
insert into public.study_runs(cohort,target_successes,success_limit,research_protocol_version)
  values('test-v4',60000,2,4);
insert into public.study_run_targets(cohort,domain_key,url,vertical,region,source_ref,sample_rank)
  select 'test-v4','v4target'||i||'.com','https://v4target'||i||'.com','retail','CA','v4-'||i,
    encode(sha256(convert_to(i::text,'UTF8')),'hex') from generate_series(1,3) i;
update public.study_runs set source_frozen_at=clock_timestamp(),state='pilot' where cohort='test-v4';
do $$
begin
  assert (select success_limit=500 and max_attempts=1500 and max_dispatches=500
    and budget_cents=10000 and dispatch_cost_microusd=5000
    from public.study_runs where cohort='test-v4-defaults'), 'v4 preserves all pilot and cost defaults';
  assert (public.study_run_status('test-v4')->>'researchProtocolVersion')::integer=4;
  begin update public.study_runs set research_protocol_version=4 where cohort='test-v3';
    raise exception 'protocol 3 relabeled'; exception when raise_exception then assert sqlerrm='study_protocol_frozen'; end;
  assert public.dispatch_readiness_study('test-v4')='dispatched';
end $$;
set local role service_role;
do $$
declare d uuid; t public.study_run_targets; good jsonb; i integer:=0;
begin
  select id into d from public.study_run_dispatches where cohort='test-v4';
  assert (select count(*) from public.claim_study_run_batch('test-v4',d))=2, 'v4 cannot overshoot pilot';
  good := '{"source":"study","scanner_version":2,"research_protocol_version":4,"score":50,"http_status":200}';
  for t in select * from public.study_run_targets where cohort='test-v4' and state='running' loop
    begin perform public.finish_study_run_target(t.cohort,t.id,t.lease_token,good||'{"research_protocol_version":3}',repeat('d',64),null,1,2,3);
      raise exception 'protocol 3 observation accepted'; exception when raise_exception then assert sqlerrm='invalid_study_metrics'; end;
    i:=i+1;
    assert public.finish_study_run_target(t.cohort,t.id,t.lease_token,good,repeat(i::text,64),null,1,2,3);
  end loop;
  assert (select state='pilot_review' from public.study_runs where cohort='test-v4'), 'v4 automatic review stop';
end $$;
reset role;
do $$ begin assert public.dispatch_readiness_study('test-v4')='inactive'; end $$;

-- Exercise LIMIT under larger, multi-cohort plans as well as the tiny fixture.
insert into public.study_runs(cohort,research_protocol_version) values('test-plan-padding',3);
insert into public.study_run_targets(cohort,domain_key,url,vertical,region,source_ref,sample_rank)
  select 'test-plan-padding','pad'||i||'.com','https://pad'||i||'.com','retail','CA','pad-'||i,
    encode(sha256(convert_to(i::text,'UTF8')),'hex') from generate_series(1,2000) i;
analyze public.study_run_targets;
do $$
declare c text; d uuid; plan text;
begin
  foreach plan in array array['on','off'] loop
    perform set_config('enable_hashjoin',plan,true);
    perform set_config('enable_mergejoin',plan,true);
    c:='test-plan-'||plan;
    insert into public.study_runs(cohort,target_successes,success_limit,research_protocol_version) values(c,1000,2,3);
    insert into public.study_run_targets(cohort,domain_key,url,vertical,region,source_ref,sample_rank)
      select c,'plan'||i||'.com','https://plan'||i||'.com','retail','CA','plan-'||i,
        encode(sha256(convert_to(i::text,'UTF8')),'hex') from generate_series(1,100) i;
    update public.study_runs set source_frozen_at=clock_timestamp(),state='pilot' where cohort=c;
    assert public.dispatch_readiness_study(c)='dispatched';
    select id into d from public.study_run_dispatches where cohort=c;
    assert (select count(*) from public.claim_study_run_batch(c,d))=2, 'batch LIMIT must survive planner changes';
    assert (select count(*) from public.study_run_targets where cohort=c and state='running')=2;
    assert (select attempts_reserved from public.study_runs where cohort=c)=2;
  end loop;
end $$;
-- A stage can retain results beyond 50,000 and still stop at its exact bound.
insert into public.study_runs(cohort,research_protocol_version,target_successes,success_limit,max_attempts,max_dispatches)
  values('test-above-50k',4,100000,50001,150000,25000);
insert into public.study_run_targets(cohort,domain_key,url,vertical,region,source_ref,sample_rank)
  select 'test-above-50k','large'||i||'.com','https://large'||i||'.com','retail','CA','large-'||i,
    encode(sha256(convert_to('large-'||i,'UTF8')),'hex') from generate_series(1,50002) i;
insert into public.study_run_results(target_id,cohort,final_domain_hash,metrics)
  select id,cohort,encode(sha256(convert_to(source_ref,'UTF8')),'hex'),
    '{"source":"study","scanner_version":2,"research_protocol_version":4,"score":50,"http_status":200}'::jsonb
  from public.study_run_targets where cohort='test-above-50k' and source_ref not in ('large-50001','large-50002');
update public.study_run_targets set state='succeeded',attempts=1,finished_at=clock_timestamp()
  where cohort='test-above-50k' and source_ref not in ('large-50001','large-50002');
update public.study_runs set source_frozen_at=clock_timestamp(),state='running',attempts_reserved=50000 where cohort='test-above-50k';
do $$
declare d uuid; t public.study_run_targets; good jsonb;
begin
  assert public.dispatch_readiness_study('test-above-50k')='dispatched';
  select id into d from public.study_run_dispatches where cohort='test-above-50k';
  assert (select count(*) from public.claim_study_run_batch('test-above-50k',d))=1, 'bounded claim beyond 50k';
  select * into t from public.study_run_targets where cohort='test-above-50k' and state='running';
  good := '{"source":"study","scanner_version":2,"research_protocol_version":4,"score":50,"http_status":200}';
  assert public.finish_study_run_target(t.cohort,t.id,t.lease_token,good,repeat('9',64),null,1,2,3);
  assert (select count(*) from public.study_run_results where cohort=t.cohort)=50001, 'extra qualifying result retained';
  assert (select state='pilot_review' from public.study_runs where cohort=t.cohort), 'stage checkpoint beyond 50k';
  assert public.dispatch_readiness_study(t.cohort)='inactive';
  update public.study_run_dispatches set finished_at=clock_timestamp() where cohort=t.cohort;
  update public.study_runs set target_successes=50002,success_limit=50002,state='running',last_dispatch_at=null where cohort=t.cohort;
  assert public.dispatch_readiness_study(t.cohort)='dispatched';
  select id into d from public.study_run_dispatches where cohort=t.cohort and finished_at is null;
  select * into t from public.claim_study_run_batch(t.cohort,d);
  assert public.finish_study_run_target(t.cohort,t.id,t.lease_token,good,repeat('8',64),null,1,2,3);
  assert (select count(*) from public.study_run_results where cohort=t.cohort)=50002;
  assert (select state='completed' from public.study_runs where cohort=t.cohort), 'final bounded completion beyond 50k';
end $$;

rollback;

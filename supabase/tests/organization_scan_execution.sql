-- Run against a disposable database. Every fixture and control change rolls back.
\set ON_ERROR_STOP on
begin;
set local plpgsql.check_asserts = on;
insert into auth.users(id) values ('c1000000-0000-4000-8000-000000000001'), ('c1000000-0000-4000-8000-000000000002');
insert into public.organizations(id,slug,name,status) values
  ('c2000000-0000-4000-8000-000000000001','scan-fixture-a','Scan fixture A','active'),
  ('c2000000-0000-4000-8000-000000000002','scan-fixture-b','Scan fixture B','active');
insert into public.organization_members(org_id,user_id,role) values
  ('c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','owner'),
  ('c2000000-0000-4000-8000-000000000002','c1000000-0000-4000-8000-000000000002','owner');
insert into private.organization_scan_entitlements(org_id,enabled,starts_at,expires_at) values
  ('c2000000-0000-4000-8000-000000000001',true,now()-interval '1 day',now()+interval '14 days');
update private.organization_runtime_controls set workspace_enabled=true,scan_submission_enabled=true,scan_policy_approved=false;
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000001',true);

do $$
declare rel text; r text; fn record;
begin
  foreach rel in array array['public.organization_scan_batches','public.organization_scan_batch_targets',
    'private.organization_scan_receipts','private.organization_scan_daily_usage','private.organization_scan_actor_usage',
    'private.organization_scan_events','private.scan_network_controls','private.scan_target_denylist',
    'private.scan_network_windows','private.scan_network_leases','private.organization_scan_cooldowns'] loop
    assert (select relrowsecurity from pg_class where oid=rel::regclass), 'RLS required: '||rel;
    foreach r in array array['anon','authenticated','service_role'] loop
      assert not has_table_privilege(r,rel,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'), 'direct access: '||r||' '||rel;
    end loop;
  end loop;
  for fn in select p.oid::regprocedure signature, p.proname, p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private') and (p.proname like '%organization_scan%' or p.proname like '%scan_network_slot') loop
    assert fn.proconfig @> array['search_path=""'], 'pinned function search path';
    assert not has_function_privilege('anon',fn.signature,'EXECUTE'), 'anonymous command denied';
  end loop;
  assert not has_function_privilege('authenticated','public.claim_organization_scan_target(uuid,uuid)','EXECUTE'), 'caller cannot self-claim';
  assert not has_function_privilege('authenticated','public.acquire_scan_network_slot(text,uuid,uuid)','EXECUTE'), 'caller cannot bypass worker';
  assert not has_function_privilege('service_role','public.submit_organization_scan_batch(uuid,uuid,text[],boolean)','EXECUTE'), 'submission needs a real actor';
  assert has_function_privilege('service_role','public.complete_organization_scan_target(uuid,uuid,uuid,jsonb,text,integer,integer,integer)','EXECUTE'), 'worker can complete';
end $$;

set local role authenticated;
do $$
declare a uuid := 'c2000000-0000-4000-8000-000000000001';
begin
  begin perform public.submit_organization_scan_batch(a,gen_random_uuid(),array['https://acme.com'],true);
    raise exception 'policy gate bypass'; exception when sqlstate 'PT409' then null; end;
  begin perform public.submit_organization_scan_batch('c2000000-0000-4000-8000-000000000002',gen_random_uuid(),array['https://acme.com'],true);
    raise exception 'foreign organization submission'; exception when sqlstate 'PT404' then null; end;
  assert public.read_organization_scan_batches('c2000000-0000-4000-8000-000000000002') is null, 'foreign organization read';
  begin perform public.claim_organization_scan_target(a,gen_random_uuid());
    raise exception 'client claimed a job'; exception when insufficient_privilege then null; end;
  begin perform * from public.organization_scan_batch_targets;
    raise exception 'client read raw targets'; exception when insufficient_privilege then null; end;
end $$;
reset role;
update private.organization_runtime_controls set scan_policy_approved=true;

do $$
declare a uuid := 'c2000000-0000-4000-8000-000000000001'; other uuid := 'c2000000-0000-4000-8000-000000000002';
  k uuid := gen_random_uuid(); receipt jsonb; replay jsonb; b uuid; c jsonb; c2 jsonb; c3 jsonb; token uuid; tid uuid;
  good jsonb; bad jsonb; input text[]; n integer; new_member uuid;
begin
  foreach input slice 1 in array array[array['http://127.0.0.1'],array['https://acme.com/path'],array['https://acme.com?key=secret'],
    array['https://user:pass@acme.com'],array['https://acme.com:8443'],array['https://foo.local'],array['https://foo.test'],array[null::text]] loop
    begin perform public.submit_organization_scan_batch(a,gen_random_uuid(),input,true);
      raise exception 'malformed target accepted'; exception when sqlstate 'PT400' then null; end;
  end loop;
  begin perform public.submit_organization_scan_batch(a,gen_random_uuid(),array[]::text[],true);
    raise exception 'empty batch'; exception when sqlstate 'PT400' then null; end;
  begin perform public.submit_organization_scan_batch(a,gen_random_uuid(),array['https://acme.com'],false);
    raise exception 'missing attestation'; exception when sqlstate 'PT400' then null; end;
  begin perform public.submit_organization_scan_batch(a,gen_random_uuid(),array(select 'https://site'||i||'.com' from generate_series(1,51) i),true);
    raise exception 'oversized batch'; exception when sqlstate 'PT400' then null; end;
  receipt := public.submit_organization_scan_batch(a,k,array['https://beta.com','https://acme.com','https://acme.com'],true);
  b := (receipt->>'batch_id')::uuid;
  assert receipt->>'reserved'='2' and receipt->>'replayed'='false', 'deduplicated reservation';
  replay := public.submit_organization_scan_batch(a,k,array['https://acme.com','https://beta.com'],true);
  assert replay->>'batch_id'=b::text and replay->>'replayed'='true', 'canonical replay';
  assert (select reserved=2 from private.organization_scan_daily_usage where org_id=a), 'replay charged twice';
  assert public.find_organization_scan_receipt(a,k,array['https://beta.com','https://acme.com'])=replay, 'preflight replay';
  begin perform public.submit_organization_scan_batch(a,k,array['https://changed.com'],true);
    raise exception 'changed idempotent request'; exception when sqlstate 'PT409' then null; end;
  update private.organization_scan_entitlements set max_targets_per_batch=3,max_targets_per_day=3 where org_id=a;
  begin perform public.submit_organization_scan_batch(a,gen_random_uuid(),array['https://one.com','https://two.com'],true);
    raise exception 'quota overflow'; exception when sqlstate 'PT429' then null; end;
  assert (select reserved=2 from private.organization_scan_daily_usage where org_id=a), 'failed quota reserved units';
  update private.organization_scan_entitlements set max_targets_per_batch=50,max_targets_per_day=250 where org_id=a;
  assert public.claim_organization_scan_target(other,b) is null, 'wrong-org claim';
  c := public.claim_organization_scan_target(a,b); tid := (c->>'target_id')::uuid; token := (c->>'lease_token')::uuid;
  assert c->>'attempt'='1', 'first claim';
  assert exists(select 1 from private.organization_scan_events where batch_subject=b and event='claimed' and queue_wait_ms between 0 and 1200000), 'bounded queue wait telemetry';
  assert exists(select 1 from private.organization_scan_events where batch_subject=b and event='submitted' and actor_subject='c1000000-0000-4000-8000-000000000001'), 'pseudonymous initiating actor audit';
  assert not public.complete_organization_scan_target(a,tid,gen_random_uuid(),null,'network_error',1,1,1), 'wrong lease accepted';
  assert not public.complete_organization_scan_target(other,tid,token,null,'network_error',1,1,1), 'wrong org accepted';
  select jsonb_build_object('version',2,'score',70,'checks',jsonb_agg(jsonb_build_object('id',id,'status','pass'))) into good
    from unnest(array['reachable','speed','robots','agent_docs','llms_txt','semantics','jsonld','business_identity','offer_schema','pricing','action_path','availability','offer_details','structured_action','https','contact','policies','freshness']) id;
  foreach bad in array array[good||'{"pageText":"secret"}'::jsonb,good||'{"score":999}'::jsonb,good||'{"version":"2"}'::jsonb,
    jsonb_set(good,'{checks,0,id}','"raw-html"'),jsonb_set(good,'{checks,1,id}','"reachable"'),jsonb_set(good,'{checks,0,status}','"unknown"')] loop
    begin perform public.complete_organization_scan_target(a,tid,token,bad,null,1,1,1);
      raise exception 'unbounded result accepted'; exception when raise_exception then
        assert sqlerrm in ('invalid_scan_result','invalid_scan_checks'), 'unexpected result validation error: '||sqlerrm;
    end;
  end loop;
  assert public.acquire_scan_network_slot('acme.com',token,a)='allowed', 'first shared permit';
  assert public.acquire_scan_network_slot('acme.com',token,a)='allowed', 'same lease is idempotent';
  assert public.acquire_scan_network_slot('acme.com',gen_random_uuid(),null)='busy', 'anonymous work shares organization domain cap';
  assert public.complete_organization_scan_target(a,tid,token,good,null,10,100,2), 'valid completion';
  assert not public.complete_organization_scan_target(a,tid,token,good,null,10,100,2), 'duplicate completion';
  perform public.release_scan_network_slot(token);
  assert public.acquire_scan_network_slot('acme.com',gen_random_uuid(),a)='cooldown', 'successful domain cooldown';
  token := gen_random_uuid();
  assert public.acquire_scan_network_slot('acme.com',token,other)='allowed', 'cooldown does not disclose another org';
  perform public.release_scan_network_slot(token);
  assert public.change_organization_scan_batch(a,b,'follow_up',tid,true), 'mark useful result';
  assert (select follow_up from public.organization_scan_batch_targets where id=tid), 'follow-up persisted';
  assert exists(select 1 from private.organization_scan_events where batch_subject=b and event='follow_up_changed'), 'follow-up audit';
  begin perform public.change_organization_scan_batch(other,b,'delete');
    raise exception 'foreign delete'; exception when sqlstate 'PT404' then null; end;
  c := public.claim_organization_scan_target(a,b); tid := (c->>'target_id')::uuid; token := (c->>'lease_token')::uuid;
  assert public.complete_organization_scan_target(a,tid,token,null,'pressure_deferred',1,0,0), 'capacity wait';
  assert (select attempts=0 and state='queued' from public.organization_scan_batch_targets where id=tid), 'capacity wait spends no attempt';
  for n in 1..3 loop
    update public.organization_scan_batch_targets set available_at=clock_timestamp()-interval '1 second' where id=tid;
    c := public.claim_organization_scan_target(a,b); token := (c->>'lease_token')::uuid;
    assert (c->>'attempt')::integer=n, 'retry attempt increases once';
    assert public.complete_organization_scan_target(a,tid,token,null,'network_error',1,1,1), 'retry complete';
  end loop;
  assert (select state='failed' and attempts=3 from public.organization_scan_batch_targets where id=tid), 'retry bound';
  assert (public.read_organization_scan_batches(a,b)->'batches'->0->>'succeeded')='1', 'aggregate success count';
  assert (public.read_organization_scan_batches(a,b)->'batches'->0->>'failed')='1', 'aggregate terminal count';
  assert public.change_organization_scan_batch(a,b,'delete'), 'delete results';
  assert not exists(select 1 from public.organization_scan_batch_targets where batch_id=b), 'delete removes all prospect payload';
  assert not public.complete_organization_scan_target(a,tid,token,good,null,1,1,1), 'deleted target resurrected';
  begin perform public.submit_organization_scan_batch(a,k,array['https://acme.com','https://beta.com'],true);
    raise exception 'deleted receipt replayed'; exception when sqlstate 'PT410' then null; end;
  assert (select reserved=2 from private.organization_scan_daily_usage where org_id=a), 'deletion refunded quota';

  receipt := public.submit_organization_scan_batch(a,gen_random_uuid(),array['https://a.com','https://b.com','https://c.com','https://d.com'],true);
  b := (receipt->>'batch_id')::uuid;
  c := public.claim_organization_scan_target(a,b); c2 := public.claim_organization_scan_target(a,b); c3 := public.claim_organization_scan_target(a,b);
  assert c is not null and c2 is not null and c3 is not null, 'three distinct claims';
  assert public.claim_organization_scan_target(a,b) is null, 'organization concurrency cap';
  tid := (c->>'target_id')::uuid; token := (c->>'lease_token')::uuid;
  update public.organization_scan_batch_targets set lease_until=clock_timestamp()-interval '1 second' where id=tid;
  c := public.claim_organization_scan_target(a,b);
  assert c->>'target_id'=tid::text and c->>'lease_token'<>token::text and c->>'attempt'='2', 'abandoned lease recovered';
  assert not public.complete_organization_scan_target(a,tid,token,good,null,1,1,1), 'old worker overwrote new lease';
  assert public.change_organization_scan_batch(a,b,'cancel'), 'cancel running batch';
  assert not public.complete_organization_scan_target(a,tid,(c->>'lease_token')::uuid,good,null,1,1,1), 'cancelled worker persisted';
  assert (select count(*)=4 from public.organization_scan_batch_targets where batch_id=b and state='cancelled' and result is null), 'cancellation covers all pending targets';

  receipt := public.submit_organization_scan_batch(a,gen_random_uuid(),array['https://revocation.com'],true); b := (receipt->>'batch_id')::uuid;
  c := public.claim_organization_scan_target(a,b);
  delete from public.organization_members where org_id=a;
  insert into public.organization_members(org_id,user_id,role) values(a,'c1000000-0000-4000-8000-000000000001','owner') returning id into new_member;
  assert (select membership_id is null from public.organization_scan_batches where id=b), 'deleted membership severs job authority';
  assert not public.complete_organization_scan_target(a,(c->>'target_id')::uuid,(c->>'lease_token')::uuid,good,null,1,1,1), 're-enrollment revived old work';
  assert (select state='cancelled' and result is null from public.organization_scan_batch_targets where batch_id=b), 'revoked result discarded';
  receipt := public.submit_organization_scan_batch(a,gen_random_uuid(),array['https://kill.com'],true); b := (receipt->>'batch_id')::uuid;
  update private.organization_runtime_controls set scan_submission_enabled=false;
  assert public.claim_organization_scan_target(a,b) is null, 'kill switch prevents external work';
  assert (select state='cancelled' from public.organization_scan_batch_targets where batch_id=b), 'kill switch terminalizes job';
  update private.organization_runtime_controls set scan_submission_enabled=true;
  receipt := public.submit_organization_scan_batch(a,gen_random_uuid(),array['https://expiry.com'],true); b := (receipt->>'batch_id')::uuid;
  update public.organization_scan_batches set deadline_at=clock_timestamp()-interval '1 second' where id=b;
  perform public.cleanup_organization_scans();
  assert (select state='cancelled' and failure_code='expired' from public.organization_scan_batch_targets where batch_id=b), 'deadline cleanup';
  assert exists(select 1 from private.organization_scan_events where batch_subject=b and event='expired'), 'deadline event';
  update public.organization_scan_batches set expires_at=clock_timestamp()-interval '1 second' where id=b;
  assert jsonb_array_length(public.read_organization_scan_batches(a,b)->'batches')=0, 'expired results hidden before cleanup';
  assert public.cleanup_organization_scans()>=1, 'retention sweep deletes data';
  assert not exists(select 1 from public.organization_scan_batch_targets where batch_id=b), 'retention deletes prospects';
  assert exists(select 1 from private.organization_scan_events where org_subject=a and event='submitted' and retain_until>clock_timestamp()+interval '23 months'), 'security event retention';
  assert exists(select 1 from private.organization_scan_events where org_subject=a and event='claimed' and retain_until<clock_timestamp()+interval '31 days'), 'short telemetry retention';

  insert into private.scan_target_denylist values('denied.com');
  assert public.acquire_scan_network_slot('denied.com',gen_random_uuid(),null)='denied', 'denylist enforcement';
  update private.scan_network_controls set enabled=false;
  assert public.acquire_scan_network_slot('safe.com',gen_random_uuid(),null)='denied', 'network kill switch';
  delete from private.scan_network_controls;
  assert public.acquire_scan_network_slot('safe.com',gen_random_uuid(),null)='denied', 'missing limiter fails closed';
  raise notice 'Organization execution: authority, quotas, receipts, leases, result policy, cancellation, deletion, retention and shared pressure passed.';
end $$;
rollback;

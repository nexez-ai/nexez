\set ON_ERROR_STOP on
begin;
set local plpgsql.check_asserts=on;
set local statement_timeout='30s';
insert into auth.users(id) values ('ad000000-0000-4000-8000-000000000001'),('ad000000-0000-4000-8000-000000000002');
alter table public.pages disable trigger user;
insert into public.pages(id,owner_id,name,slug,website_url) values
  ('bd000000-0000-4000-8000-000000000001','ad000000-0000-4000-8000-000000000001','Website fixture','website-baseline-a','https://example.com/PRIVATE_PATH?PRIVATE_QUERY'),
  ('bd000000-0000-4000-8000-000000000002','ad000000-0000-4000-8000-000000000002','Other website','website-baseline-b','https://example.com');
create function pg_temp.expect_website_error(command text,code text) returns void language plpgsql as $$
declare actual text;
begin
  begin execute command; exception when others then actual:=sqlstate; end;
  assert actual=code, format('Expected %s, got %s for %s',code,coalesce(actual,'success'),command);
end $$;
select set_config('website_test.result',jsonb_build_object('version',2,'score',75,'checks',
  (select jsonb_agg(jsonb_build_object('id',id,'status','pass')) from unnest(array['reachable','speed','robots','agent_docs','llms_txt','semantics','jsonld','business_identity','offer_schema','pricing','action_path','availability','offer_details','structured_action','https','contact','policies','freshness']) id))::text,true);
do $$ declare r text; t text; f text; begin
  assert not (select collection_enabled from private.merchant_website_controls where singleton), 'collection defaults off';
  foreach t in array array['merchant_website_controls','merchant_website_associations','merchant_website_collections','website_readiness_snapshots'] loop
    assert (select relrowsecurity from pg_class where oid=('private.'||t)::regclass), 'RLS required';
    foreach r in array array['anon','authenticated','service_role'] loop
      assert not has_table_privilege(r,'private.'||t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'), 'no direct table privileges';
    end loop;
  end loop;
  foreach f in array array['read_merchant_website_baseline(uuid)','read_merchant_report_with_website(uuid,date)','command_merchant_website(uuid,text,text,uuid,uuid,boolean,text)'] loop
    assert not (select prosecdef from pg_proc where oid=('public.'||f)::regprocedure), 'public invoker';
    assert has_function_privilege('authenticated','public.'||f,'EXECUTE'), 'session can execute';
    assert not has_function_privilege('anon','public.'||f,'EXECUTE'), 'anonymous cannot execute';
    assert not has_function_privilege('service_role','public.'||f,'EXECUTE'), 'service cannot impersonate a reader/approver';
  end loop;
  foreach f in array array['claim_merchant_website_collection(uuid)','complete_merchant_website_collection(uuid,uuid,jsonb,text,text)','cleanup_merchant_website_baselines()'] loop
    assert has_function_privilege('service_role','public.'||f,'EXECUTE'), 'worker can execute';
    assert not has_function_privilege('authenticated','public.'||f,'EXECUTE'), 'session cannot forge evidence';
    assert not has_function_privilege('anon','public.'||f,'EXECUTE'), 'anonymous cannot forge evidence';
  end loop;
  assert not has_function_privilege('authenticated','private.lock_merchant_website_owner(uuid,uuid,boolean)','EXECUTE'), 'internal authority helper inaccessible';
end $$;
select set_config('request.jwt.claim.sub','ad000000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$ begin
  assert public.read_merchant_website_baseline('bd000000-0000-4000-8000-000000000002') is null, 'foreign listing denies';
  assert public.read_merchant_website_baseline('bd000000-0000-4000-8000-000000000099') is null, 'missing listing denies equally';
  assert public.read_merchant_website_baseline('bd000000-0000-4000-8000-000000000001')->>'collectionEnabled'='false', 'pilot off';
  perform pg_temp.expect_website_error($q$select public.command_merchant_website('bd000000-0000-4000-8000-000000000001','approve','https://example.com',null,gen_random_uuid(),true,'merchant-website-v1')$q$,'PT503');
end $$;
reset role;
insert into private.merchant_report_access(owner_id,enabled,expires_at) values
  ('ad000000-0000-4000-8000-000000000001',true,clock_timestamp()+interval '14 days'),
  ('ad000000-0000-4000-8000-000000000002',true,clock_timestamp()+interval '14 days');
set local role authenticated;
select pg_temp.expect_website_error($q$select public.command_merchant_website('bd000000-0000-4000-8000-000000000001','approve','https://example.com',null,gen_random_uuid(),true,'merchant-website-v1')$q$,'PT503');
reset role;
update private.merchant_website_controls set collection_enabled=true;
set local role authenticated;
do $$ declare bad text; a jsonb; begin
  foreach bad in array array['https://other.com','http://127.0.0.1','https://example.com/','https://example.com?secret','https://example.com:8443','https://user@example.com','https://example.com#x'] loop
    perform pg_temp.expect_website_error(format('select public.command_merchant_website(%L,%L,%L,null,gen_random_uuid(),true,%L)','bd000000-0000-4000-8000-000000000001','approve',bad,'merchant-website-v1'),'PT400');
  end loop;
  perform pg_temp.expect_website_error($q$select public.command_merchant_website('bd000000-0000-4000-8000-000000000001','approve','https://example.com',null,gen_random_uuid(),false,'merchant-website-v1')$q$,'PT400');
  perform pg_temp.expect_website_error($q$select public.command_merchant_website('bd000000-0000-4000-8000-000000000001','approve','https://example.com',null,gen_random_uuid(),true,'domain_verified')$q$,'PT400');
  a:=public.command_merchant_website('bd000000-0000-4000-8000-000000000001','approve','https://example.com',null,'cd000000-0000-4000-8000-000000000001',true,'merchant-website-v1');
  perform set_config('website_test.association',a->>'id',true);
  assert a=public.command_merchant_website('bd000000-0000-4000-8000-000000000001','approve','https://example.com',null,'cd000000-0000-4000-8000-000000000001',true,'merchant-website-v1'), 'approval replay stable';
  perform pg_temp.expect_website_error($q$select public.command_merchant_website('bd000000-0000-4000-8000-000000000001','approve','https://example.com',null,gen_random_uuid(),true,'merchant-website-v1')$q$,'PT409');
  a:=public.read_merchant_website_baseline('bd000000-0000-4000-8000-000000000001');
  assert a#>>'{association,method}'='merchant_approved' and a->'latest'='null', 'approval is not domain verification or a baseline';
  assert a::text !~ 'PRIVATE|request_key|lease_token|website_url_at_approval', 'safe projection';
  a:=public.command_merchant_website('bd000000-0000-4000-8000-000000000001','collect',null,current_setting('website_test.association')::uuid,'cd000000-0000-4000-8000-000000000002',null,null);
  perform set_config('website_test.collection',a->>'id',true);
  assert a=public.command_merchant_website('bd000000-0000-4000-8000-000000000001','collect',null,current_setting('website_test.association')::uuid,'cd000000-0000-4000-8000-000000000002',null,null), 'collection replay stable';
  perform pg_temp.expect_website_error($q$select public.command_merchant_website('bd000000-0000-4000-8000-000000000001','collect',null,current_setting('website_test.association')::uuid,gen_random_uuid(),null,null)$q$,'PT409');
  perform pg_temp.expect_website_error($q$select public.claim_merchant_website_collection(current_setting('website_test.collection')::uuid)$q$,'42501');
  perform pg_temp.expect_website_error($q$select public.complete_merchant_website_collection(current_setting('website_test.collection')::uuid,gen_random_uuid(),null,'network_error','site-scan-2.1')$q$,'42501');
end $$;
reset role;
set local role service_role;
do $$ declare c uuid:=current_setting('website_test.collection')::uuid; claim jsonb; bad jsonb; begin
  claim:=public.claim_merchant_website_collection(c);
  perform set_config('website_test.token',claim->>'leaseToken',true);
  assert claim->>'origin'='https://example.com' and claim::text !~ 'PRIVATE', 'fresh minimal claim';
  assert public.claim_merchant_website_collection(c) is null, 'one claim only';
  assert not public.complete_merchant_website_collection(c,gen_random_uuid(),current_setting('website_test.result')::jsonb,null,'site-scan-2.1'), 'wrong token denies';
  foreach bad in array array[
    current_setting('website_test.result')::jsonb||'{"rawHtml":"PRIVATE"}',
    jsonb_set(current_setting('website_test.result')::jsonb,'{score}','101'),
    jsonb_set(current_setting('website_test.result')::jsonb,'{version}','3'),
    jsonb_set(current_setting('website_test.result')::jsonb,'{checks,0,id}','"foreign_check"'),
    jsonb_set(current_setting('website_test.result')::jsonb,'{checks,0,status}','"unknown"'),
    jsonb_set(current_setting('website_test.result')::jsonb,'{checks,0,id}','"speed"')
  ] loop
    perform pg_temp.expect_website_error(format('select public.complete_merchant_website_collection(%L,%L,%L,null,%L)',c,claim->>'leaseToken',bad,'site-scan-2.1'),'P0001');
  end loop;
  assert public.complete_merchant_website_collection(c,(claim->>'leaseToken')::uuid,current_setting('website_test.result')::jsonb,null,'site-scan-2.1'), 'valid service result commits';
  assert not public.complete_merchant_website_collection(c,(claim->>'leaseToken')::uuid,current_setting('website_test.result')::jsonb,null,'site-scan-2.1'), 'duplicate completion does not append';
end $$;
reset role;
do $$ begin
  assert (select count(*) from private.website_readiness_snapshots where owner_id='ad000000-0000-4000-8000-000000000001')=1, 'exactly one snapshot';
  perform pg_temp.expect_website_error($q$update private.website_readiness_snapshots set result=result where owner_id='ad000000-0000-4000-8000-000000000001'$q$,'42501');
  perform pg_temp.expect_website_error($q$update private.merchant_website_associations set method='domain_verified' where id=current_setting('website_test.association')::uuid$q$,'42501');
end $$;
set local role authenticated;
do $$ declare v jsonb; begin
  v:=public.read_merchant_website_baseline('bd000000-0000-4000-8000-000000000001');
  assert v#>>'{latest,result,score}'='75' and v#>>'{latest,provenance}'='merchant_website_snapshot', 'snapshot result and provenance';
  assert v#>>'{latest,sourceVersion}' ~ '^sha256:[a-f0-9]{64}$', 'fingerprint';
  assert public.read_merchant_report_with_website('bd000000-0000-4000-8000-000000000001',(date_trunc('month',statement_timestamp() at time zone 'UTC')-interval '1 month')::date)->'websiteSnapshot'=v->'latest', 'single-statement report source';
  perform set_config('website_test.collection',(public.command_merchant_website('bd000000-0000-4000-8000-000000000001','collect',null,current_setting('website_test.association')::uuid,gen_random_uuid(),null,null)->>'id'),true);
end $$;
reset role;
set local role service_role;
select set_config('website_test.token',public.claim_merchant_website_collection(current_setting('website_test.collection')::uuid)->>'leaseToken',true);
reset role;
update public.pages set website_url='https://www.example.com' where id='bd000000-0000-4000-8000-000000000001';
set local role service_role;
do $$ begin assert not public.complete_merchant_website_collection(current_setting('website_test.collection')::uuid,current_setting('website_test.token')::uuid,current_setting('website_test.result')::jsonb,null,'site-scan-2.1'), 'website changes discard in-flight result'; end $$;
reset role;
set local role authenticated;
do $$ begin
  assert public.read_merchant_website_baseline('bd000000-0000-4000-8000-000000000001')->'association'='null', 'changed website cannot expose old history';
  perform set_config('website_test.association',(public.command_merchant_website('bd000000-0000-4000-8000-000000000001','approve','https://www.example.com',null,gen_random_uuid(),true,'merchant-website-v1')->>'id'),true);
  assert public.read_merchant_website_baseline('bd000000-0000-4000-8000-000000000001')->'latest'='null', 'new association requires fresh baseline';
  perform set_config('website_test.collection',(public.command_merchant_website('bd000000-0000-4000-8000-000000000001','collect',null,current_setting('website_test.association')::uuid,gen_random_uuid(),null,null)->>'id'),true);
end $$;
reset role;
set local role service_role;
select set_config('website_test.token',public.claim_merchant_website_collection(current_setting('website_test.collection')::uuid)->>'leaseToken',true);
do $$ begin assert public.complete_merchant_website_collection(current_setting('website_test.collection')::uuid,current_setting('website_test.token')::uuid,null,'robots_denied','site-scan-2.1'), 'bounded failed observation stored'; end $$;
reset role;
set local role authenticated;
do $$ declare v jsonb; begin
  v:=public.read_merchant_website_baseline('bd000000-0000-4000-8000-000000000001');
  assert v#>'{latest,result}'='null' and v#>>'{latest,failure}'='robots_denied', 'failure is unavailable, not zero';
  perform pg_temp.expect_website_error($q$select public.command_merchant_website('bd000000-0000-4000-8000-000000000001','collect',null,current_setting('website_test.association')::uuid,gen_random_uuid(),null,null)$q$,'PT429');
  perform public.command_merchant_website('bd000000-0000-4000-8000-000000000001','revoke',null,current_setting('website_test.association')::uuid,null,null,null);
  assert public.read_merchant_website_baseline('bd000000-0000-4000-8000-000000000001')->'latest'='null', 'revocation hides observations';
end $$;
reset role;
delete from public.pages where id='bd000000-0000-4000-8000-000000000001';
do $$ begin
  assert not exists(select 1 from private.website_readiness_snapshots where owner_id='ad000000-0000-4000-8000-000000000001'), 'merchant resource deletion cascades evidence';
  assert (select count(*) from private.merchant_website_collections where owner_id='ad000000-0000-4000-8000-000000000001')=3, 'resource deletion cannot erase quota receipts';
end $$;
-- Cleanup is bounded and independent of collection enablement. These deliberately
-- backdated, private test inserts exercise retention only, not the producer.
select set_config('request.jwt.claim.sub','ad000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select set_config('website_test.association',(public.command_merchant_website('bd000000-0000-4000-8000-000000000002','approve','https://example.com',null,gen_random_uuid(),true,'merchant-website-v1')->>'id'),true);
reset role;
insert into private.website_readiness_snapshots(collection_id,owner_id,listing_id,association_id,origin,scanner_version,result,failure,evaluated_at,created_at,source_version)
  select gen_random_uuid(),'ad000000-0000-4000-8000-000000000002','bd000000-0000-4000-8000-000000000002',current_setting('website_test.association')::uuid,
    'https://example.com','site-scan-2.1',null,'network_error',clock_timestamp()-interval '31 days',clock_timestamp()-interval '31 days','sha256:'||repeat('a',64)
  from generate_series(1,101);
update private.merchant_website_controls set collection_enabled=false;
set local role authenticated;
do $$ begin assert public.read_merchant_website_baseline('bd000000-0000-4000-8000-000000000002')->'latest'='null', 'expired evidence excluded before cleanup'; end $$;
reset role;
set local role service_role;
do $$ begin
  assert public.cleanup_merchant_website_baselines()=100, 'one cleanup is bounded';
  assert public.cleanup_merchant_website_baselines()=1, 'cleanup continues with collection disabled';
  assert public.cleanup_merchant_website_baselines()=0, 'cleanup converges';
end $$;
reset role;
rollback;

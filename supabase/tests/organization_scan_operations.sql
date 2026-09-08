-- Disposable fixtures only. No production activation or prospect data; everything rolls back.
\set ON_ERROR_STOP on
begin;
set local plpgsql.check_asserts = on;

do $$
declare r text; fn text;
begin
  assert (select relrowsecurity from pg_class where oid='private.organization_scan_operations'::regclass), 'operations RLS';
  foreach r in array array['anon','authenticated','service_role'] loop
    assert not has_table_privilege(r,'private.organization_scan_operations','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'), 'no direct operations access';
  end loop;
  foreach fn in array array['public.get_organization_scan_operations()','public.record_organization_scan_recovery(text)','public.cleanup_organization_scans()'] loop
    assert has_function_privilege('service_role',fn,'EXECUTE'), 'service command permitted';
    assert not has_function_privilege('anon',fn,'EXECUTE'), 'anonymous command denied';
    assert not has_function_privilege('authenticated',fn,'EXECUTE'), 'actor command denied';
    assert (select proconfig @> array['search_path=""'] from pg_proc where oid=fn::regprocedure), 'fixed search path';
  end loop;
end $$;

set local role anon;
do $$ begin
  begin perform public.get_organization_scan_operations(); raise exception 'anonymous operations read'; exception when insufficient_privilege then null; end;
  begin perform public.record_organization_scan_recovery(repeat('a',40)); raise exception 'anonymous recovery forgery'; exception when insufficient_privilege then null; end;
  begin perform public.cleanup_organization_scans(); raise exception 'anonymous cleanup'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role authenticated;
do $$ begin
  begin perform public.get_organization_scan_operations(); raise exception 'actor operations read'; exception when insufficient_privilege then null; end;
  begin perform public.record_organization_scan_recovery(repeat('a',40)); raise exception 'actor recovery forgery'; exception when insufficient_privilege then null; end;
  begin perform public.cleanup_organization_scans(); raise exception 'actor cleanup'; exception when insufficient_privilege then null; end;
end $$;
reset role;

update private.organization_runtime_controls set workspace_enabled=false,scan_submission_enabled=false,scan_policy_approved=false;
update private.organization_scan_operations set cleanup_completed_at=null,recovery_completed_at=null,recovery_commit_sha=null;
set local role service_role;
do $$
declare state jsonb; bad text; before_marker jsonb;
begin
  begin perform * from private.organization_scan_operations; raise exception 'service direct read'; exception when insufficient_privilege then null; end;
  state := public.get_organization_scan_operations();
  assert (select count(*) from jsonb_object_keys(state))=6, 'only a bounded operations projection';
  assert state->'cleanup_completed_at'='null'::jsonb and state->'recovery_completed_at'='null'::jsonb, 'no invented completion markers';
  assert state->>'scan_submission_enabled'='false', 'disabled pilot remains explicit';
  assert public.record_organization_scan_recovery(repeat('a',40)), 'service records deployment';
  state := public.get_organization_scan_operations();
  assert state->>'recovery_commit_sha'=repeat('a',40), 'revision retained';
  assert (state->>'recovery_completed_at')::timestamptz <= (state->>'checked_at')::timestamptz, 'database timestamps are ordered';
  before_marker := state->'recovery_completed_at';
  foreach bad in array array['',repeat('a',39),repeat('a',41),repeat('A',40),repeat('a',40)||E'\n','https://secret.example'] loop
    begin perform public.record_organization_scan_recovery(bad); raise exception 'unbounded revision accepted'; exception when sqlstate 'PT400' then null; end;
    assert public.get_organization_scan_operations()->'recovery_completed_at'=before_marker, 'invalid revision cannot refresh evidence';
  end loop;
  assert public.record_organization_scan_recovery(null), 'local completion permits an unknown revision';
  assert public.get_organization_scan_operations()->'recovery_commit_sha'='null'::jsonb, 'unknown revision is not forged';
end $$;
reset role;

insert into public.organizations(id,slug,name,status) values
  ('c6000000-0000-4000-8000-000000000001','operations-fixture','Operations fixture','disabled');
insert into public.organization_scan_batches(org_id,expires_at)
  select 'c6000000-0000-4000-8000-000000000001',clock_timestamp()-interval '1 hour' from generate_series(1,101);
insert into public.organization_scan_batch_targets(org_id,batch_id,origin)
  select org_id,id,'https://example.com' from public.organization_scan_batches where org_id='c6000000-0000-4000-8000-000000000001';
insert into private.scan_network_windows(domain_key,window_start,starts) values
  ('operations-expired',clock_timestamp()-interval '25 hours',1),('operations-current',clock_timestamp(),1);
insert into private.scan_network_leases(token,domain_key,expires_at) values
  (gen_random_uuid(),'operations-expired',clock_timestamp()-interval '1 minute'),
  (gen_random_uuid(),'operations-current',clock_timestamp()+interval '1 minute');

set local role service_role;
do $$ begin
  assert public.get_organization_scan_operations()->>'expired_batches_overdue'='true', 'overdue retention is visible';
  assert public.cleanup_organization_scans()=100, 'cleanup batch bound holds while pilot is off';
  assert public.get_organization_scan_operations()->'cleanup_completed_at'<>'null'::jsonb, 'successful cleanup is recorded';
  assert public.get_organization_scan_operations()->>'expired_batches_overdue'='true', 'a fresh marker cannot hide the remaining backlog';
end $$;
reset role;

do $$
declare original timestamptz;
begin
  assert (select count(*)=1 from public.organization_scan_batches where org_id='c6000000-0000-4000-8000-000000000001'), '100 expired batches deleted';
  assert (select count(*)=1 from public.organization_scan_batch_targets where org_id='c6000000-0000-4000-8000-000000000001'), 'target deletion cascades';
  assert not exists(select 1 from private.scan_network_windows where domain_key='operations-expired'), 'anonymous network window removed';
  assert not exists(select 1 from private.scan_network_leases where domain_key='operations-expired'), 'anonymous lease removed';
  assert exists(select 1 from private.scan_network_windows where domain_key='operations-current'), 'current pressure window retained';
  assert exists(select 1 from private.scan_network_leases where domain_key='operations-current'), 'live permit retained';
  select cleanup_completed_at into original from private.organization_scan_operations;
  begin
    assert public.cleanup_organization_scans()=1, 'remaining batch cleaned';
    raise exception using errcode='PT499',message='Deliberate transaction rollback';
  exception when sqlstate 'PT499' then null; end;
  assert (select cleanup_completed_at=original from private.organization_scan_operations), 'rollback cannot refresh cleanup evidence';
  assert (select count(*)=1 from public.organization_scan_batches where org_id='c6000000-0000-4000-8000-000000000001'), 'rollback restores expired data';
  assert public.cleanup_organization_scans()=1, 'next cleanup converges';
  assert public.get_organization_scan_operations()->>'expired_batches_overdue'='false', 'backlog clears';
  assert (select not workspace_enabled and not scan_submission_enabled and not scan_policy_approved from private.organization_runtime_controls), 'no activation side effect';
end $$;

savepoint missing_controls;
delete from private.organization_runtime_controls;
do $$ begin assert public.get_organization_scan_operations() is null, 'missing runtime root fails closed'; end $$;
rollback to missing_controls;
savepoint missing_network;
delete from private.scan_network_controls;
do $$ begin assert public.get_organization_scan_operations() is null, 'missing network root fails closed'; end $$;
rollback to missing_network;

delete from private.organization_scan_operations;
do $$
declare denied boolean;
begin
  assert public.get_organization_scan_operations() is null, 'missing operations row fails closed';
  denied:=false;
  begin perform public.cleanup_organization_scans(); exception when raise_exception then denied:=true; end;
  assert denied, 'missing cleanup marker must fail visibly';
  denied:=false;
  begin perform public.record_organization_scan_recovery(repeat('a',40)); exception when raise_exception then denied:=true; end;
  assert denied, 'missing recovery marker must fail visibly';
end $$;
rollback;

-- Included by plan_entitlements.test.sql, which is already required in CI.
-- Also runnable directly with psql -X --set=ON_ERROR_STOP=1 --file=... .
\set ON_ERROR_STOP on
begin;
set local plpgsql.check_asserts = on;

insert into auth.users (id) values
  ('91000000-0000-4000-8000-000000000001'),
  ('91000000-0000-4000-8000-000000000002'),
  ('91000000-0000-4000-8000-000000000003'),
  ('91000000-0000-4000-8000-000000000004');
insert into public.organizations (id, slug, name) values
  ('92000000-0000-4000-8000-000000000001', 'workspace-a', 'Agency A'),
  ('92000000-0000-4000-8000-000000000002', 'workspace-b', 'Agency B');
insert into public.organization_members (org_id, user_id, role) values
  ('92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'owner'),
  ('92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000002', 'operator'),
  ('92000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000003', 'owner');
insert into private.organization_scan_entitlements (org_id, starts_at, expires_at) values
  ('92000000-0000-4000-8000-000000000001', now() - interval '1 day', now() + interval '14 days');
insert into public.pages (id, owner_id, name, slug, is_published) values
  ('93000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000003', 'Private merchant', 'organization-isolation-merchant', false);

do $$
declare relation_name text; actor_role text; function_name text;
begin
  foreach relation_name in array array['public.organizations', 'public.organization_members',
    'private.organization_scan_entitlements', 'private.organization_runtime_controls'] loop
    assert (select relrowsecurity from pg_class where oid = relation_name::regclass), 'RLS required: ' || relation_name;
    foreach actor_role in array array['anon', 'authenticated', 'service_role'] loop
      assert not has_table_privilege(actor_role, relation_name, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
        'unexpected direct grant: ' || actor_role || ' ' || relation_name;
    end loop;
  end loop;
  foreach function_name in array array['public.list_my_organizations(text)', 'public.get_organization_context(uuid,text)'] loop
    assert has_function_privilege('authenticated', function_name, 'EXECUTE'), 'member RPC executable';
    assert not has_function_privilege('anon', function_name, 'EXECUTE'), 'no anonymous RPC';
    assert not has_function_privilege('service_role', function_name, 'EXECUTE'), 'no service-role actor fallback';
    assert (select proconfig @> array['search_path=""'] from pg_proc where oid = function_name::regprocedure), 'pinned search path';
    assert (select provolatile = 's' from pg_proc where oid = function_name::regprocedure), 'single statement snapshot';
  end loop;
  assert not (select enabled from private.organization_scan_entitlements where org_id = '92000000-0000-4000-8000-000000000001'), 'entitlement defaults disabled';
  assert not exists (select 1 from public.organizations where id in ('92000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000002') and status <> 'disabled'), 'organizations default disabled';
end $$;

select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  assert (select count(*) = 0 from public.list_my_organizations()), 'default controls deny directory';
  assert (select count(*) = 0 from public.get_organization_context(null, 'workspace-a')), 'default controls deny context';
  begin
    perform * from public.organizations;
    raise exception 'client read base table';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.organization_members (org_id, user_id, role)
    values ('92000000-0000-4000-8000-000000000002', auth.uid(), 'owner');
    raise exception 'client self enrolled';
  exception when insufficient_privilege then null;
  end;
  begin
    update private.organization_runtime_controls set workspace_enabled = true;
    raise exception 'client enabled runtime';
  exception when insufficient_privilege then null;
  end;
  assert not exists (select 1 from public.pages where id = '93000000-0000-4000-8000-000000000001'), 'org ownership gives no foreign merchant read';
  update public.pages set name = 'Forbidden' where id = '93000000-0000-4000-8000-000000000001';
  assert not found, 'org ownership gives no foreign merchant write';
end $$;
reset role;

update public.organizations set status = 'active' where id in ('92000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000002');
update private.organization_runtime_controls set workspace_enabled = true;
set local role authenticated;
do $$
begin
  assert (select count(*) = 1 from public.list_my_organizations()), 'only member organization listed';
  assert (select org_slug = 'workspace-a' from public.list_my_organizations()), 'directory belongs to caller';
  assert (select scan_access = 'paused' from public.get_organization_context(null, 'workspace-a')), 'scanning remains paused';
  assert (select count(*) = 0 from public.get_organization_context(null, 'workspace-b')), 'foreign slug denied';
  assert (select count(*) = 0 from public.get_organization_context('92000000-0000-4000-8000-000000000002', null)), 'foreign UUID denied';
  assert (select count(*) = 0 from public.get_organization_context(null, 'missing-workspace')), 'unknown matches foreign denial';
  assert (select count(*) = 0 from public.get_organization_context()), 'missing selector denied';
  assert (select count(*) = 0 from public.get_organization_context('92000000-0000-4000-8000-000000000001', 'workspace-a')), 'ambiguous selectors denied';
  assert (select count(*) = 0 from public.list_my_organizations('WORKSPACE')), 'invalid cursor denied';
  assert (select count(*) = 0 from public.list_my_organizations('workspace-a')), 'cursor is exclusive';
end $$;
reset role;

do $$
declare a uuid := '92000000-0000-4000-8000-000000000001';
begin
  update private.organization_runtime_controls set scan_submission_enabled = true;
  assert (select scan_access = 'unconfigured' from public.get_organization_context(a, null)), 'disabled entitlement denied';
  update private.organization_scan_entitlements set enabled = true where org_id = a;
  assert (select scan_access = 'available' and max_targets_per_batch = 50 and max_targets_per_day = 250 and max_concurrent_targets = 3 from public.get_organization_context(a, null)), 'finite active pilot limits';
  update private.organization_scan_entitlements set starts_at = now() + interval '1 day', expires_at = now() + interval '15 days' where org_id = a;
  assert (select scan_access = 'scheduled' from public.get_organization_context(a, null)), 'future entitlement denied';
  update private.organization_scan_entitlements set starts_at = now() - interval '2 days', expires_at = now() - interval '1 second' where org_id = a;
  assert (select scan_access = 'expired' from public.get_organization_context(a, null)), 'expired entitlement denied';
  begin
    update private.organization_scan_entitlements set expires_at = 'infinity' where org_id = a;
    raise exception 'infinite entitlement accepted';
  exception when check_violation then null;
  end;
  begin
    update private.organization_scan_entitlements set expires_at = starts_at + interval '91 days' where org_id = a;
    raise exception 'unbounded pilot accepted';
  exception when check_violation then null;
  end;
  begin
    update private.organization_scan_entitlements set max_targets_per_batch = 51 where org_id = a;
    raise exception 'batch ceiling bypassed';
  exception when check_violation then null;
  end;
  begin
    update private.organization_scan_entitlements set max_targets_per_day = 251 where org_id = a;
    raise exception 'daily ceiling bypassed';
  exception when check_violation then null;
  end;
  begin
    update private.organization_scan_entitlements set max_concurrent_targets = 4 where org_id = a;
    raise exception 'concurrency ceiling bypassed';
  exception when check_violation then null;
  end;
  begin
    insert into public.organization_members (org_id, user_id, role) values (a, '91000000-0000-4000-8000-000000000004', 'owner');
    raise exception 'second owner accepted';
  exception when unique_violation then null;
  end;
  begin
    insert into public.organization_members (org_id, user_id, role) values (a, '91000000-0000-4000-8000-000000000004', 'admin');
    raise exception 'unrecognized role accepted';
  exception when check_violation then null;
  end;
  delete from private.organization_scan_entitlements where org_id = a;
  assert (select scan_access = 'unconfigured' from public.get_organization_context(a, null)), 'missing entitlement denied';
  update public.organization_members set status = 'suspended' where org_id = a and role = 'owner';
  assert (select count(*) = 0 from public.get_organization_context(a, null)), 'suspension applies to next read';
  assert (select count(*) = 0 from public.list_my_organizations()), 'suspension applies to directory';
  update public.organization_members set status = 'active' where org_id = a and role = 'owner';
  update public.organizations set status = 'disabled' where id = a;
  assert (select count(*) = 0 from public.get_organization_context(a, null)), 'disabled org denied';
  update public.organizations set status = 'active' where id = a;
  update auth.users set banned_until = now() + interval '1 day' where id = '91000000-0000-4000-8000-000000000001';
  assert (select count(*) = 0 from public.get_organization_context(a, null)), 'banned actor denied despite existing JWT';
  update auth.users set banned_until = null, is_anonymous = true where id = '91000000-0000-4000-8000-000000000001';
  assert (select count(*) = 0 from public.get_organization_context(a, null)), 'anonymous auth user denied';
  update auth.users set is_anonymous = false where id = '91000000-0000-4000-8000-000000000001';
  delete from private.organization_runtime_controls;
  assert (select count(*) = 0 from public.get_organization_context(a, null)), 'missing runtime root fails closed';
  insert into private.organization_runtime_controls (singleton, workspace_enabled, scan_submission_enabled) values (true, true, false);
end $$;

select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"91000000-0000-4000-8000-000000000002","role":"authenticated","user_metadata":{"org_id":"92000000-0000-4000-8000-000000000002","role":"owner"}}', true);
set local role authenticated;
do $$
begin
  assert (select member_role = 'operator' from public.get_organization_context(null, 'workspace-a')), 'database role beats forged metadata';
  assert (select count(*) = 0 from public.get_organization_context(null, 'workspace-b')), 'metadata cannot select another org';
end $$;
reset role;

select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000004', true);
select set_config('request.jwt.claims', '{"sub":"91000000-0000-4000-8000-000000000004","role":"authenticated","user_metadata":{"org_id":"92000000-0000-4000-8000-000000000001","role":"owner"}}', true);
set local role authenticated;
do $$
begin
  assert (select count(*) = 0 from public.list_my_organizations()), 'nonmember cannot discover an organization';
  assert (select count(*) = 0 from public.get_organization_context(null, 'workspace-a')), 'nonmember metadata grants nothing';
end $$;
reset role;

set local role anon;
do $$
begin
  begin
    perform * from public.list_my_organizations();
    raise exception 'anonymous directory executed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.get_organization_context(null, 'workspace-a');
    raise exception 'anonymous context executed';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- Multiple memberships are paginated, never returned as an unbounded roster.
insert into public.organizations (id, slug, name, status)
select gen_random_uuid(), 'org-page-' || lpad(n::text, 3, '0'), 'Pagination fixture', 'active'
from generate_series(1, 55) n;
insert into public.organization_members (org_id, user_id, role)
select id, '91000000-0000-4000-8000-000000000004', 'operator'
from public.organizations where slug like 'org-page-%';
set local role authenticated;
do $$
begin
  assert (select count(*) = 51 from public.list_my_organizations()), 'bounded directory plus one continuation sentinel';
  assert (select count(*) = 5 from public.list_my_organizations('org-page-050')), 'keyset cursor reaches remaining memberships';
end $$;
reset role;

-- User deletion removes authority even if a previously issued JWT still exists.
delete from auth.users where id = '91000000-0000-4000-8000-000000000004';
set local role authenticated;
do $$
begin
  assert (select count(*) = 0 from public.list_my_organizations()), 'deleted actor denied';
end $$;
reset role;
rollback;

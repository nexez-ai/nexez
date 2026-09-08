#!/usr/bin/env python3
"""Prove that a committed suspension affects a later read in an open session."""
import json
import os
import subprocess
import uuid
from urllib.parse import urlparse

database_url = os.environ.get('NEXEZ_TEST_DATABASE_URL', '')
parsed = urlparse(database_url)
if parsed.scheme not in ('postgres', 'postgresql') or parsed.hostname not in ('127.0.0.1', 'localhost', '::1'):
    raise SystemExit('NEXEZ_TEST_DATABASE_URL must identify an isolated local test database.')

command = [os.environ.get('PSQL', 'psql'), database_url, '-XAtq', '--set=ON_ERROR_STOP=1']
actor, org = str(uuid.uuid4()), str(uuid.uuid4())
slug = 'boundary-' + org


def sql(statement):
    return subprocess.run(command, input=statement, text=True, capture_output=True, check=True, timeout=15).stdout.strip()


controls = json.loads(sql("select coalesce(json_agg(c), '[]') from private.organization_runtime_controls c;"))
session = None
try:
    sql(f"""begin;
      insert into auth.users(id) values ('{actor}');
      insert into public.organizations(id, slug, name, status) values ('{org}', '{slug}', 'Boundary fixture', 'active');
      insert into public.organization_members(org_id, user_id, role) values ('{org}', '{actor}', 'owner');
      insert into private.organization_runtime_controls(singleton, workspace_enabled) values (true, true)
        on conflict (singleton) do update set workspace_enabled = true;
      commit;""")
    session = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

    def read(statement):
        session.stdin.write(statement + '\n')
        session.stdin.flush()
        value = session.stdout.readline().strip()
        if not value:
            raise AssertionError('The organization read returned no result.')
        return value

    first = read(f"set statement_timeout = '5s'; begin isolation level read committed; set local role authenticated; set local request.jwt.claim.sub = '{actor}'; select count(*) from public.get_organization_context(null, '{slug}');")
    assert first == '1', 'The first read must exercise an active membership.'
    sql(f"update public.organization_members set status = 'suspended' where org_id = '{org}' and user_id = '{actor}';")
    second = read(f"select count(*) from public.get_organization_context(null, '{slug}');")
    assert second == '0', 'A committed suspension must deny the next statement even in an existing transaction.'
    assert read('select count(*) from public.list_my_organizations();') == '0', 'The directory must also observe suspension.'
    sql(f"update public.organization_members set status = 'active' where org_id = '{org}' and user_id = '{actor}';")
    assert read(f"select count(*) from public.get_organization_context(null, '{slug}');") == '1', 'A later read must observe reinstatement.'
    sql('update private.organization_runtime_controls set workspace_enabled = false;')
    assert read(f"select count(*) from public.get_organization_context(null, '{slug}');") == '0', 'Runtime disablement must deny the next statement.'
    session.stdin.write('rollback;\n')
    session.stdin.close()
    assert session.wait(timeout=10) == 0, session.stderr.read()
    print('Organization read boundary: active, suspended, directory, reinstated, runtime disabled checks passed.')
finally:
    if session is not None and session.poll() is None:
        session.terminate()
        session.wait(timeout=5)
    restore = 'delete from private.organization_runtime_controls;'
    if controls:
        row = controls[0]
        restore = f"update private.organization_runtime_controls set workspace_enabled = {str(row['workspace_enabled']).lower()}, scan_submission_enabled = {str(row['scan_submission_enabled']).lower()} where singleton;"
    sql(f"begin; delete from public.organizations where id = '{org}'; delete from auth.users where id = '{actor}'; {restore} commit;")

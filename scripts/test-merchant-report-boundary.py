#!/usr/bin/env python3
"""Prove current ownership, coverage and pilot state in an open local session."""
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
owner, recipient, page = (str(uuid.uuid4()) for _ in range(3))
month_sql = "(date_trunc('month', statement_timestamp() at time zone 'UTC') - interval '1 month')::date"


def sql(statement):
    result = subprocess.run(command, input=statement, text=True, capture_output=True, timeout=15)
    if result.returncode:
        # Only this loopback fixture database is permitted. Do not include the
        # connection string in an exception when a fixture fails in CI.
        raise RuntimeError('Local report fixture SQL failed: ' + result.stderr.strip())
    return result.stdout.strip()


def attest():
    sql(f"""insert into private.merchant_report_coverage
      (owner_id, listing_id, metric, period_start, covered_from, covered_to_exclusive, evidence_sha256)
      select '{owner}', '{page}', 'traffic', m, m::timestamp at time zone 'UTC',
        (m + interval '1 month') at time zone 'UTC', 'sha256:' || repeat('a',64)
      from (select {month_sql} m) period;""")


session = None
try:
    sql(f"""begin;
      insert into auth.users(id) values ('{owner}'), ('{recipient}');
      insert into public.pages(id, owner_id, name, slug, is_published)
        values ('{page}', '{owner}', 'Report boundary fixture', 'report-boundary-{page}', false);
      insert into private.merchant_report_access(owner_id, enabled, expires_at)
        values ('{owner}', true, statement_timestamp() + interval '1 hour'),
        ('{recipient}', true, statement_timestamp() + interval '1 hour');
      commit;""")
    attest()
    session = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

    def read(statement):
        session.stdin.write(statement + '\n')
        session.stdin.flush()
        value = session.stdout.readline().strip()
        if not value:
            raise AssertionError('The merchant report read returned no result.')
        return json.loads(value)

    setup = f"""set statement_timeout = '5s';
      create function pg_temp.report_probe(p uuid, m date) returns jsonb
      language plpgsql security invoker as $$begin
        return jsonb_build_object('data', public.read_merchant_report_with_website(p, m));
        exception when others then return jsonb_build_object('code', SQLSTATE);
      end;$$;
      begin isolation level read committed; set local role authenticated;
      set local request.jwt.claim.sub = '{owner}';"""
    probe = f"select pg_temp.report_probe('{page}', {month_sql});"
    first = read(setup + probe)['data']
    assert first['ownerId'] == owner and first['traffic']['value']['totalVisits'] == 0
    assert first['traffic']['coverage']['state'] == 'complete'
    # Optional fixture transport exercises the real SQL projection through the
    # TypeScript DAL/API test, using only these randomly named local fixtures.
    fixture_path = os.environ.get('NEXEZ_REPORT_SQL_FIXTURE')
    if fixture_path:
        with open(fixture_path, 'w', encoding='utf-8') as fixture_file:
            json.dump(first, fixture_file)

    sql(f"delete from private.merchant_report_coverage where owner_id = '{owner}' and listing_id = '{page}';")
    assert read(probe)['data']['traffic'] == {'state': 'no_coverage'}, 'withdrawal must affect the next statement'
    attest()
    assert read(probe)['data']['traffic']['state'] == 'available', 'reattested coverage must be observed'
    # Normal writes deliberately pin owner_id, even for the service role. Prove
    # that guard first. Then simulate a privileged data repair in this isolated
    # database only, with trigger bypass local to the writer transaction. No
    # production guard or shared trigger definition is disabled or replaced.
    sql(f"""do $$begin
      begin update public.pages set owner_id = '{recipient}' where id = '{page}';
        raise exception 'normal ownership update bypassed the owner guard';
      exception when insufficient_privilege then null; end;
      end;$$;
      begin; set local session_replication_role = 'replica';
      update public.pages set owner_id = '{recipient}' where id = '{page}'; commit;""")
    assert read(probe)['data'] is None, 'former owner must lose access immediately after committed transfer'
    received = read(f"set local request.jwt.claim.sub = '{recipient}';" + probe)['data']
    assert received['ownerId'] == recipient
    assert received['traffic'] == {'state': 'no_coverage'}, 'recipient must not inherit former owner coverage'
    assert received['orders'] == {'state': 'no_coverage'}, 'recipient must not inherit account order coverage'
    sql(f"update private.merchant_report_access set enabled = false where owner_id = '{recipient}';")
    assert read(probe) == {'code': 'PT503'}, 'pilot disablement must affect the next statement'
    sql(f"update private.merchant_report_access set enabled = true, expires_at = statement_timestamp() - interval '1 second' where owner_id = '{recipient}';")
    assert read(probe) == {'code': 'PT503'}, 'pilot expiry must deny'
    sql(f"update private.merchant_report_access set expires_at = statement_timestamp() + interval '1 hour' where owner_id = '{recipient}';")
    sql(f"update auth.users set banned_until = statement_timestamp() + interval '1 hour' where id = '{recipient}';")
    assert read(probe)['data'] is None, 'a stale token must not bypass a current ban'
    session.stdin.write('rollback;\n')
    session.stdin.close()
    assert session.wait(timeout=10) == 0, session.stderr.read()
    print('Merchant report boundary: coverage withdrawal, reattestation, transfer, recipient isolation, pilot disablement, expiry and stale-token ban checks passed.')
finally:
    if session is not None and session.poll() is None:
        session.terminate()
        session.wait(timeout=5)
    sql(f"""begin; delete from public.pages where id = '{page}';
      do $$begin
        if to_regclass('private.public_identifier_claims') is not null then
          delete from private.public_identifier_claims where namespace = 'page_slug'
            and identifier = 'report-boundary-{page}' and owner_id in ('{owner}', '{recipient}');
        end if;
      end;$$;
      delete from auth.users where id in ('{owner}', '{recipient}'); commit;""")

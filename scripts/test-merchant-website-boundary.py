#!/usr/bin/env python3
"""Exercise website collection commits against concurrently changed authority."""
import json
import os
import subprocess
import uuid
from urllib.parse import urlparse
from concurrent.futures import ThreadPoolExecutor

database_url = os.environ.get('NEXEZ_TEST_DATABASE_URL', '')
parsed = urlparse(database_url)
if parsed.scheme not in ('postgres', 'postgresql') or parsed.hostname not in ('127.0.0.1', 'localhost', '::1') or parsed.query or parsed.fragment:
    raise SystemExit('Use an isolated loopback PostgreSQL database for website boundary tests.')
command = [os.environ.get('PSQL', 'psql'), database_url, '-XAtq', '--set=ON_ERROR_STOP=1']
owner, recipient = (str(uuid.uuid4()) for _ in range(2))
pages = []
session = None


def sql(statement):
    result = subprocess.run(command, input="set statement_timeout='5s';" + statement,
                            text=True, capture_output=True, timeout=10)
    if result.returncode:
        raise RuntimeError('Local website boundary SQL failed: ' + result.stderr.strip())
    return result.stdout.strip()


def actor(expression):
    return json.loads(sql(f"begin; set local role authenticated; set local request.jwt.claim.sub='{owner}'; select coalesce(to_jsonb({expression}),'null'::jsonb); commit;"))


def reserve(page, association):
    return actor(f"public.command_merchant_website('{page}','collect',null,'{association}','{uuid.uuid4()}',null,null)")['id']


def worker(expression):
    session.stdin.write(f"select coalesce(to_jsonb({expression}),'null'::jsonb);\n")
    session.stdin.flush()
    line = session.stdout.readline().strip()
    if not line:
        raise AssertionError('Worker session returned no result.')
    return json.loads(line)


old_enabled = sql('select collection_enabled from private.merchant_website_controls where singleton;')
try:
    sql(f"""insert into auth.users(id) values ('{owner}'),('{recipient}');
      insert into private.merchant_report_access(owner_id,enabled,expires_at)
        values ('{owner}',true,clock_timestamp()+interval '14 days'),('{recipient}',true,clock_timestamp()+interval '14 days');
      update private.merchant_website_controls set collection_enabled=true;""")
    session = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    session.stdin.write("set statement_timeout='5s'; set role service_role;\n")
    session.stdin.flush()
    checks = ['withdrawal', 'website_change', 'pilot_disabled', 'pilot_expired', 'global_disabled',
              'user_banned', 'anonymous_user', 'user_deleted', 'ownership_transfer', 'page_deleted', 'lease_expired']
    for check in checks:
        page = str(uuid.uuid4())
        pages.append(page)
        # Only fixture receipts are removed between independent cases, so the
        # fixed three-per-day quota does not hide the authority case being tested.
        sql(f"""delete from private.merchant_website_collections where owner_id='{owner}';
          insert into public.pages(id,owner_id,name,slug,website_url)
          values ('{page}','{owner}','Website boundary fixture','website-boundary-{page}','https://example.com');""")
        association = actor(f"public.command_merchant_website('{page}','approve','https://example.com',null,'{uuid.uuid4()}',true,'merchant-website-v1')")['id']
        job = reserve(page, association)
        claim = worker(f"public.claim_merchant_website_collection('{job}')")
        assert claim['id'] == job and claim['ownerId'] == owner
        # The worker claim committed and released its locks before this independent
        # writer runs. A lock held across simulated network work would time out.
        if check == 'withdrawal':
            actor(f"public.command_merchant_website('{page}','revoke',null,'{association}',null,null,null)")
        elif check == 'website_change':
            sql(f"update public.pages set website_url='https://www.example.com' where id='{page}';")
        elif check == 'pilot_disabled':
            sql(f"update private.merchant_report_access set enabled=false where owner_id='{owner}';")
        elif check == 'pilot_expired':
            sql(f"update private.merchant_report_access set expires_at=clock_timestamp()-interval '1 second' where owner_id='{owner}';")
        elif check == 'global_disabled':
            sql('update private.merchant_website_controls set collection_enabled=false;')
        elif check == 'user_banned':
            sql(f"update auth.users set banned_until=clock_timestamp()+interval '1 hour' where id='{owner}';")
        elif check == 'anonymous_user':
            sql(f"update auth.users set is_anonymous=true where id='{owner}';")
        elif check == 'user_deleted':
            sql(f"update auth.users set deleted_at=clock_timestamp() where id='{owner}';")
        elif check == 'ownership_transfer':
            # The normal immutable-owner guard remains in force. Simulate only a
            # privileged repair, confined to this disposable writer transaction.
            sql(f"begin; set local session_replication_role='replica'; update public.pages set owner_id='{recipient}' where id='{page}'; commit;")
        elif check == 'page_deleted':
            sql(f"delete from public.pages where id='{page}';")
        elif check == 'lease_expired':
            sql(f"update private.merchant_website_collections set lease_until=clock_timestamp()-interval '1 second' where id='{job}';")
        committed = worker(f"public.complete_merchant_website_collection('{job}','{claim['leaseToken']}',null,'network_error','site-scan-2.1')")
        assert committed is False, f'{check}: authority loss must discard the result'
        assert sql(f"select count(*) from private.website_readiness_snapshots where collection_id='{job}';") == '0'
        if check == 'ownership_transfer':
            assert actor(f"public.read_merchant_website_baseline('{page}')") is None
            received = json.loads(sql(f"begin; set local role authenticated; set local request.jwt.claim.sub='{recipient}'; select public.read_merchant_website_baseline('{page}'); commit;"))
            assert received['association'] is None and received['latest'] is None
        sql(f"""update private.merchant_report_access set enabled=true,expires_at=clock_timestamp()+interval '14 days' where owner_id='{owner}';
          update private.merchant_website_controls set collection_enabled=true;
          update auth.users set banned_until=null,is_anonymous=false,deleted_at=null where id='{owner}';""")
    # Concurrent retries of one request must produce one quota receipt.
    page = str(uuid.uuid4())
    pages.append(page)
    sql(f"""delete from private.merchant_website_collections where owner_id='{owner}';
      insert into public.pages(id,owner_id,name,slug,website_url)
        values ('{page}','{owner}','Website concurrency fixture','website-boundary-{page}','https://example.com');""")
    association = actor(f"public.command_merchant_website('{page}','approve','https://example.com',null,'{uuid.uuid4()}',true,'merchant-website-v1')")['id']
    key = str(uuid.uuid4())
    expression = f"public.command_merchant_website('{page}','collect',null,'{association}','{key}',null,null)"
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(actor, [expression, expression]))
    assert results[0]['id'] == results[1]['id'], 'concurrent replay must reserve once'
    assert sql(f"select count(*) from private.merchant_website_collections where owner_id='{owner}';") == '1'
    job = results[0]['id']
    claim = worker(f"public.claim_merchant_website_collection('{job}')")
    assert worker(f"public.complete_merchant_website_collection('{job}','{claim['leaseToken']}',null,'network_error','site-scan-2.1')") is True
    # Independent requests competing for the one active slot cannot both reserve.
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(reserve, page, association) for _ in range(2)]
    errors = [future.exception() for future in futures if future.exception()]
    assert len(errors) == 1 and 'collection_busy' in str(errors[0]), 'one concurrent reservation must deny'
    assert sql(f"select count(*) from private.merchant_website_collections where owner_id='{owner}';") == '2'
    job = next(future.result() for future in futures if future.exception() is None)
    claim = worker(f"public.claim_merchant_website_collection('{job}')")
    ids = ['reachable', 'speed', 'robots', 'agent_docs', 'llms_txt', 'semantics', 'jsonld', 'business_identity',
           'offer_schema', 'pricing', 'action_path', 'availability', 'offer_details', 'structured_action', 'https', 'contact', 'policies', 'freshness']
    result = json.dumps({'version': 2, 'score': 100, 'checks': [{'id': code, 'status': 'pass'} for code in ids]})
    assert worker(f"public.complete_merchant_website_collection('{job}','{claim['leaseToken']}','{result}',null,'site-scan-2.1')") is True
    projection = actor(f"public.read_merchant_report_with_website('{page}',(date_trunc('month',statement_timestamp() at time zone 'UTC')-interval '1 month')::date)")
    assert projection['websiteSnapshot']['result']['score'] == 100
    if os.environ.get('NEXEZ_WEBSITE_SQL_FIXTURE'):
        with open(os.environ['NEXEZ_WEBSITE_SQL_FIXTURE'], 'w', encoding='utf-8') as fixture_file:
            json.dump(projection, fixture_file)
    print(f'Website collection boundary: {len(checks)} independent-writer authority and expiry cases, concurrent replay and concurrent reservation passed.')
finally:
    if session is not None:
        session.stdin.close()
        try:
            session.wait(timeout=5)
        except subprocess.TimeoutExpired:
            session.terminate()
            session.wait(timeout=5)
    identifiers = ','.join("'" + 'website-boundary-' + page + "'" for page in pages) or "''"
    sql(f"""begin; delete from public.pages where owner_id in ('{owner}','{recipient}') and slug in ({identifiers});
      delete from auth.users where id in ('{owner}','{recipient}');
      do $$begin
        if to_regclass('private.public_identifier_claims') is not null then
          delete from private.public_identifier_claims where namespace='page_slug' and identifier in ({identifiers}) and owner_id in ('{owner}','{recipient}');
        end if;
      end;$$;
      update private.merchant_website_controls set collection_enabled={'true' if old_enabled == 't' else 'false'}; commit;""")

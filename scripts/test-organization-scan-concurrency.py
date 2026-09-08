#!/usr/bin/env python3
"""Real concurrent commands against a disposable, loopback-only Postgres DB."""
import concurrent.futures
import json
import os
import subprocess
import time
import uuid
from urllib.parse import urlparse

database_url = os.environ.get('NEXEZ_TEST_DATABASE_URL', '')
parsed = urlparse(database_url)
if parsed.scheme not in ('postgres', 'postgresql') or parsed.hostname not in ('127.0.0.1', 'localhost', '::1'):
    raise SystemExit('NEXEZ_TEST_DATABASE_URL must identify an isolated local test database.')
command = [os.environ.get('PSQL', 'psql'), database_url, '-XAtq', '--set=ON_ERROR_STOP=1']
actor, org, other = (str(uuid.uuid4()) for _ in range(3))
prefix = f"set statement_timeout='10s'; set request.jwt.claim.sub='{actor}';"
tokens = []
holders = []


def sql(statement, fail=False):
    result = subprocess.run(command, input=prefix + statement, text=True, capture_output=True, timeout=15)
    if fail:
        return result
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()


def parallel(statements):
    with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
        return list(pool.map(lambda statement: sql(statement, fail=True), statements))


def submit(target_org, key, count=50):
    return f"select public.submit_organization_scan_batch('{target_org}','{key}',array(select 'https://site'||i||'.com' from generate_series(1,{count}) i),true);"


def blocked_by(mutation, contender):
    holder = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    holders.append(holder)
    holder.stdin.write(prefix + f"begin; {mutation}; select 'locked';\n")
    holder.stdin.flush()
    assert holder.stdout.readline().strip() == 'locked', 'Holder never acquired the authority lock.'
    app = 'scan-contender-' + str(uuid.uuid4())
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(sql, f"set application_name='{app}'; {contender}")
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if sql(f"select exists(select 1 from pg_stat_activity where application_name='{app}' and wait_event_type='Lock');") == 't':
                break
            assert not future.done(), 'Contender did not wait for the authority update.'
            time.sleep(0.03)
        else:
            raise AssertionError('Contender did not reach the lock boundary.')
        holder.stdin.write('commit;\n')
        holder.stdin.close()
        assert holder.wait(timeout=5) == 0, holder.stderr.read()
        return future.result(timeout=10)


controls = json.loads(sql('select row_to_json(c) from private.organization_runtime_controls c;'))
network = json.loads(sql('select row_to_json(c) from private.scan_network_controls c;'))
try:
    sql(f"""begin;
      insert into auth.users(id) values('{actor}');
      insert into public.organizations(id,slug,name,status) values
        ('{org}','race-{org}','Concurrency fixture','active'),('{other}','race-{other}','Other concurrency fixture','active');
      insert into public.organization_members(org_id,user_id,role) values('{org}','{actor}','owner'),('{other}','{actor}','owner');
      insert into private.organization_scan_entitlements(org_id,enabled,starts_at,expires_at) values
        ('{org}',true,now()-interval '1 day',now()+interval '7 days'),('{other}',true,now()-interval '1 day',now()+interval '7 days');
      update private.organization_runtime_controls set workspace_enabled=true,scan_submission_enabled=true,scan_policy_approved=true;
      update private.scan_network_controls set enabled=true,max_concurrent=8;
      commit;""")
    key = str(uuid.uuid4())
    replay = parallel([submit(org, key)] * 12)
    assert all(r.returncode == 0 for r in replay), [r.stderr for r in replay]
    receipts = [json.loads(r.stdout) for r in replay]
    assert len({r['batch_id'] for r in receipts}) == 1, 'Concurrent replay duplicated batches.'
    assert sum(not r['replayed'] for r in receipts) == 1, 'Only one submission may reserve quota.'
    assert sql(f"select reserved from private.organization_scan_daily_usage where org_id='{org}';") == '50'
    overflow = parallel([submit(org if i % 2 else other, str(uuid.uuid4())) for i in range(12)])
    assert sum(r.returncode == 0 for r in overflow) == 4, 'Cross-org actor allowance exceeded 250.'
    assert all(r.returncode == 0 or 'daily_limit' in r.stderr for r in overflow), [r.stderr for r in overflow]
    assert sql(f"select reserved from private.organization_scan_actor_usage where user_id='{actor}';") == '250'
    assert sql(f"select sum(reserved) from private.organization_scan_daily_usage where org_id in ('{org}','{other}');") == '250'
    print('Concurrent idempotency and cross-organization actor quota: passed.')

    batch = receipts[0]['batch_id']
    claims = parallel([f"select public.claim_organization_scan_target('{org}','{batch}');"] * 12)
    assert all(r.returncode == 0 for r in claims), [r.stderr for r in claims]
    claimed = [json.loads(r.stdout) for r in claims if r.stdout.strip()]
    assert len(claimed) == 3 and len({r['target_id'] for r in claimed}) == 3, 'Concurrent claim cap or uniqueness failed.'
    first = claimed[0]
    completion = f"select public.complete_organization_scan_target('{org}','{first['target_id']}','{first['lease_token']}',null,'network_error',1,1,1);"
    assert blocked_by(f"update public.organization_members set status='suspended' where org_id='{org}'", completion) == 'f', 'In-flight revocation persisted a result.'
    assert sql(f"select count(*) from public.organization_scan_batch_targets where batch_id='{batch}' and state='cancelled';") == '50'
    sql(f"update public.organization_members set status='active' where org_id='{org}';")
    sql(f"delete from private.organization_scan_actor_usage where user_id='{actor}'; delete from private.organization_scan_daily_usage where org_id='{org}';")
    fresh = json.loads(sql(submit(org, str(uuid.uuid4()), 1)))['batch_id']
    assert blocked_by('update private.organization_runtime_controls set scan_submission_enabled=false', f"select public.claim_organization_scan_target('{org}','{fresh}');") == '', 'Kill switch raced past claim.'
    sql('update private.organization_runtime_controls set scan_submission_enabled=true;')
    fresh = json.loads(sql(submit(org, str(uuid.uuid4()), 1)))['batch_id']
    first = json.loads(sql(f"select public.claim_organization_scan_target('{org}','{fresh}');"))
    completed = parallel([
      f"select public.change_organization_scan_batch('{org}','{fresh}','delete');",
      f"select public.complete_organization_scan_target('{org}','{first['target_id']}','{first['lease_token']}',null,'network_error',1,1,1);",
    ])
    assert all(r.returncode == 0 for r in completed), [r.stderr for r in completed]
    assert sql(f"select count(*) from public.organization_scan_batch_targets where batch_id='{fresh}';") == '0', 'Deletion race resurrected a target.'
    print('Concurrent claims, uncommitted revocation, kill switch and deletion race: passed.')

    for _ in range(20):
        tokens.append(str(uuid.uuid4()))
    pressure = parallel([f"select public.acquire_scan_network_slot('race-{i}-{org}.com','{token}',null);" for i, token in enumerate(tokens)])
    assert all(r.returncode == 0 for r in pressure), [r.stderr for r in pressure]
    assert sum(r.stdout.strip() == 'allowed' for r in pressure) == 8, 'Shared concurrency exceeded eight scans.'
    sql(''.join(f"select public.release_scan_network_slot('{token}');" for token in tokens))
    domain = f'domain-race-{org}.com'
    pressure = parallel([f"select public.acquire_scan_network_slot('{domain}','{token}',null);" for token in tokens])
    assert sum(r.stdout.strip() == 'allowed' for r in pressure) == 1, 'Per-domain concurrency exceeded one scan.'
    sql(''.join(f"select public.release_scan_network_slot('{token}');" for token in tokens))
    token = tokens[0]
    repeated = parallel([f"select public.acquire_scan_network_slot('replay-{org}.com','{token}',null);"] * 12)
    assert all(r.returncode == 0 and r.stdout.strip() == 'allowed' for r in repeated), 'Duplicate permits must be idempotent.'
    assert sql(f"select count(*) from private.scan_network_leases where token='{token}';") == '1'
    print('Concurrent shared pressure, per-domain pressure and duplicate permits: passed.')

    # A dropped send is redispatched after its reservation, with identifiers only.
    due = json.loads(sql(submit(org, str(uuid.uuid4()), 1)))['batch_id']
    rows = parallel(['select batch_id from public.dispatch_organization_scan_batches();'] * 6)
    assert all(r.returncode == 0 for r in rows), [r.stderr for r in rows]
    assert sum(due in r.stdout for r in rows) == 1, 'Concurrent outbox dispatch duplicated a reservation.'
    sql(f"update public.organization_scan_batches set dispatch_after=clock_timestamp()-interval '1 second' where id='{due}';")
    assert due in sql('select batch_id from public.dispatch_organization_scan_batches();'), 'Lost dispatch was not recoverable.'
    print('Concurrent outbox dispatch and recovery: passed.')
finally:
    for holder in holders:
        if holder.poll() is None:
            holder.terminate()
            holder.wait(timeout=5)
    sql(''.join(f"select public.release_scan_network_slot('{token}');" for token in tokens))
    sql(f"""begin;
      delete from public.organizations where id in ('{org}','{other}');
      delete from auth.users where id='{actor}';
      delete from private.organization_scan_events where org_subject in ('{org}','{other}');
      update private.organization_runtime_controls set workspace_enabled={str(controls['workspace_enabled']).lower()},
        scan_submission_enabled={str(controls['scan_submission_enabled']).lower()},scan_policy_approved={str(controls['scan_policy_approved']).lower()};
      update private.scan_network_controls set enabled={str(network['enabled']).lower()},max_concurrent={network['max_concurrent']};
      commit;""")

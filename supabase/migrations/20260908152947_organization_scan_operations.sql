-- Scanner operations are independent of pilot activation and contain no prospect data.
begin;

create table private.organization_scan_operations (
  singleton boolean primary key default true check (singleton),
  cleanup_completed_at timestamptz,
  recovery_completed_at timestamptz,
  recovery_commit_sha text check (recovery_commit_sha is null
    or (char_length(recovery_commit_sha)=40 and recovery_commit_sha ~ '^[a-f0-9]{40}$'))
);
insert into private.organization_scan_operations(singleton) values(true);
alter table private.organization_scan_operations enable row level security;
revoke all on table private.organization_scan_operations from public,anon,authenticated,service_role;

create or replace function public.cleanup_organization_scans()
returns integer language plpgsql security definer set search_path = '' as $$
declare b record; removed integer := 0;
begin
  -- Preserve command lock order and run even while the capability is off.
  perform 1 from private.organization_runtime_controls where singleton for update;
  for b in select id,org_id from public.organization_scan_batches where expires_at<=clock_timestamp() order by expires_at limit 100 loop
    perform 1 from public.organizations where id=b.org_id for update;
    delete from public.organization_scan_batches where id=b.id and org_id=b.org_id;
    if found then perform private.organization_scan_event(b.org_id,b.id,'deleted'); removed:=removed+1; end if;
  end loop;
  for b in select id,org_id from public.organization_scan_batches b0 where deadline_at<=clock_timestamp()
    and exists(select 1 from public.organization_scan_batch_targets t where t.org_id=b0.org_id and t.batch_id=b0.id and t.state in ('queued','running'))
    order by deadline_at limit 100 loop
    update public.organization_scan_batch_targets set state='cancelled',failure_code='expired',lease_token=null,lease_until=null,finished_at=clock_timestamp()
      where org_id=b.org_id and batch_id=b.id and state in ('queued','running');
    if found then perform private.organization_scan_event(b.org_id,b.id,'expired'); end if;
  end loop;
  delete from private.organization_scan_receipts where expires_at<=clock_timestamp();
  delete from private.organization_scan_daily_usage where day<(clock_timestamp() at time zone 'UTC')::date-2;
  delete from private.organization_scan_actor_usage where day<(clock_timestamp() at time zone 'UTC')::date-2;
  delete from private.organization_scan_cooldowns where expires_at<=clock_timestamp();
  delete from private.organization_scan_events where retain_until<=clock_timestamp();
  perform 1 from private.scan_network_controls where singleton for update;
  delete from private.scan_network_leases where expires_at<=clock_timestamp();
  delete from private.scan_network_windows where window_start<=clock_timestamp()-interval '1 day';
  -- Transaction rollback also rolls back this marker. A missing row fails visibly.
  update private.organization_scan_operations set cleanup_completed_at=clock_timestamp() where singleton;
  if not found then raise exception 'Scanner operations unavailable'; end if;
  return removed;
end $$;

create function public.record_organization_scan_recovery(p_commit_sha text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_commit_sha is not null and (char_length(p_commit_sha)<>40 or p_commit_sha !~ '^[a-f0-9]{40}$') then
    raise exception using errcode='PT400',message='Invalid deployment revision.';
  end if;
  update private.organization_scan_operations set recovery_completed_at=clock_timestamp(),recovery_commit_sha=p_commit_sha
    where singleton;
  if not found then raise exception 'Scanner operations unavailable'; end if;
  return true;
end $$;

-- One bounded projection. Missing roots return null, never an invented healthy state.
create function public.get_organization_scan_operations()
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object(
    'checked_at',clock_timestamp(),
    'scan_submission_enabled',c.scan_submission_enabled,
    'cleanup_completed_at',o.cleanup_completed_at,
    'recovery_completed_at',o.recovery_completed_at,
    'recovery_commit_sha',o.recovery_commit_sha,
    'expired_batches_overdue',exists(select 1 from public.organization_scan_batches
      where expires_at<clock_timestamp()-interval '15 minutes')
  ) from private.organization_scan_operations o
    join private.organization_runtime_controls c on c.singleton=o.singleton
    join private.scan_network_controls n on n.singleton=o.singleton
  where o.singleton;
$$;

revoke all on function public.record_organization_scan_recovery(text),public.get_organization_scan_operations()
  from public,anon,authenticated,service_role;
grant execute on function public.record_organization_scan_recovery(text),public.get_organization_scan_operations() to service_role;
-- CREATE OR REPLACE preserves the cleanup function's existing service-only grant.

commit;

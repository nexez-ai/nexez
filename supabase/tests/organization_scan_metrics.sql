-- Read-only operational report for a database operator. No prospect payloads.
-- Run with psql. The two optional prices must come from the actual provider bill,
-- after accounting for plan allowances. Without them, dollar cost stays unknown.
\set ON_ERROR_STOP on
\if :{?scan_step_usd}
\else
  \set scan_step_usd ''
\endif
\if :{?scan_processed_gib_usd}
\else
  \set scan_processed_gib_usd ''
\endif
begin read only;
set local statement_timeout = '5s';
with usage as (
  select org_subject,
    count(*) filter(where event='claimed') as target_attempts,
    sum(units) filter(where event='submitted') as reserved_targets,
    count(*) filter(where event='succeeded') as useful_results,
    count(*) filter(where event='failed') as terminal_failures,
    count(*) filter(where event='retry') as retries,
    count(*) filter(where event='pressure_deferred') as pressure_deferrals,
    round((percentile_cont(0.95) within group(order by queue_wait_ms) filter(where event='claimed'))::numeric) as p95_queue_wait_ms,
    round((percentile_cont(0.95) within group(order by elapsed_ms) filter(where event in ('succeeded','failed','retry')))::numeric) as p95_execution_ms,
    sum(elapsed_ms)/1000.0 as observed_execution_seconds,
    sum(bytes_read) as processed_bytes,
    sum(probe_count) as probe_count
  from private.organization_scan_events where created_at>=clock_timestamp()-interval '30 days'
  group by org_subject
)
select *,
  target_attempts * nullif(:'scan_step_usd','')::numeric
    + processed_bytes / 1073741824.0 * nullif(:'scan_processed_gib_usd','')::numeric as estimated_variable_usd
from usage order by target_attempts desc limit 100;
rollback;

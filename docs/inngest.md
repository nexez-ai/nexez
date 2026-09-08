# Inngest: durable background jobs

Inngest is the durable job runner for Nexez background work. Functions live in
`lib/inngest/functions/`, are registered by the serve route at
`app/api/inngest/route.ts`, and run as signature-verified invocations of that
route on Vercel. Steps are memoized: a retried run never repeats work that
already succeeded (a delivered webhook is never re-delivered, a sent email is
never re-sent).

The integration needs event and signing keys plus a synced app. Webhook and
freshness emitters retain their existing inline fallback. Organization scans
require the durable runner, current database authority and an explicitly enabled
pilot. Configured keys alone do not prove that hosted functions are running.

## Registered functions

| Function id | Trigger | What it does |
| --- | --- | --- |
| `outbound-webhooks-dispatch` | event `nexez/outbound-webhooks.dispatch` | Owner + per-page outbound webhook fan-out. Plan-gated at dispatch time (Pro+). One retried step per endpoint; delivery bookkeeping on `outbound_webhooks` rows preserved. Emitted by checkout logging and the verified Calendly receiver. |
| `freshness-nudge` | event `nexez/freshness.nudge` | One stale-listing re-interview nudge: resolve recipient, send the seller-facet email (retried), then stamp the `page_freshness_nudges` cooldown ledger only after a successful send. Emitted per due page by the daily freshness cron. |
| `feed-regenerate` | event `nexez/feed.regenerate` + cron `0 */6 * * *` | Fetches the public agent feed surfaces (`/acp/feed.json`, `/ucp/feed.json`, `/agent-pages.json`, `/llms.txt`) off the request path, revalidating expired CDN entries and failing visibly when a surface breaks. IndexNow pings will attach here. |
| `organization-scan-batch` | event `nexez/organization-scan.batch` | Bounded public website scans. Each target is claimed, fetched and completed in one step with fresh database authority. Events contain only organization and batch IDs. |
| `organization-scan-recovery` | cron `* * * * *` | Cleans expired scanner records and wakes due batches. Records completion and deployment revision only after any recovery events are accepted. |

Future jobs register by adding their function to `lib/inngest/functions/index.ts`.

## Event vocabulary

Event names and payload types live in `lib/inngest/events.ts` so emitters and
functions never drift. Emit with:

```ts
import { hasInngestEnv, inngest } from '@/lib/inngest/client'
import { FEED_REGENERATE } from '@/lib/inngest/events'

if (hasInngestEnv()) {
  await inngest.send({ name: FEED_REGENERATE, data: { reason: 'publish' } })
}
```

## Setup (one time)

1. Create an Inngest account (inngest.com) and an app named `nexez`, or install
   the Inngest Vercel integration (which sets the env vars for you).
2. If configuring manually, set in Vercel (Production at minimum):
   - `INNGEST_EVENT_KEY`: from Inngest dashboard, Events, Event Keys
   - `INNGEST_SIGNING_KEY`: from the same Inngest environment's Signing Keys
   Set `INNGEST_SERVE_ORIGIN=https://app.nexez.ai` for Production so registered
   functions use the canonical app host. In Inngest's Vercel integration, set the
   Nexez project's **Custom Production Domain** to `app.nexez.ai` so automatic
   sync requests also use that host. Keep its path as `/api/inngest`. Do not
   apply the production origin to Preview or Development.
3. Register the app URL: `https://app.nexez.ai/api/inngest`. Unlisted `/api/*`
   routes are private-by-default in `lib/site.ts`, so the serve route is
   canonical on the APP host. Do not register the marketing or runtime host.
4. Redeploy so the env vars take effect, then confirm the app shows as synced in
   the Inngest dashboard. Verify the two organization scan functions are present
   and the recovery cron completes on the current deployment. With the pilot
   disabled, this verifies recovery without creating a prospect batch or fetching
   a target. Check Launch Control for recent recovery evidence as well.

Function configuration changes require a new app sync. The Vercel integration can
sync deployments automatically; otherwise use the app's Resync action. Verify the
endpoint and deployment rather than treating an unsigned endpoint request as a
successful invocation. See [Inngest app sync](https://www.inngest.com/docs/apps/cloud).

For the Vercel-managed account, use the existing resource's **Open in Inngest**
link. A separate personal Inngest session can hide that account. Check that the
dashboard contains the Vercel deployment's sync history before registering; a
same-named organization does not establish that its signing key matches. Failed
automatic registrations appear under **Unattached syncs**.

The linked production account currently permits five concurrent steps. The scan
batch function caps concurrency at five across batches and three per organization.
Inngest rejects the whole app when a function's configured concurrency exceeds the
account limit, including while the pilot is disabled. Recheck account capacity
before raising these caps. The account also shares capacity with other functions.

## Scanner cleanup and activation readiness

`/api/cron/organization-scan-maintenance` is an independent Vercel cron scheduled
every five minutes. It requires the exact `CRON_SECRET` bearer header and the admin
database environment in every environment. It invokes the same transactional
cleanup as Inngest recovery and has no target-fetch or event-dispatch path. The
existing daily `/api/cron/scan-retention` continues its separate contact retention
policy. Vercel schedules run in production; preview verification must invoke the
endpoint explicitly with a preview credential. See
[Vercel cron management](https://vercel.com/docs/cron-jobs/manage-cron-jobs).

Launch Control requires a completed cleanup within 15 minutes and no batch more
than 15 minutes overdue for deletion. This remains required with the pilot off
because anonymous scans share the network retention tables. A cleanup marker is
transactional: failed or rolled-back cleanup cannot refresh it. A bounded cleanup
can remove at most 100 expired batches, so remaining overdue batches block readiness.

Recovery must complete within five minutes on the current `VERCEL_GIT_COMMIT_SHA`,
with runner configuration present. Recovery is an optional attention item while
`scan_submission_enabled` is false, and a required check when it is true. Missing
controls or an unavailable operations projection fail closed. Neither check changes
runtime controls or grants pilot access. Marker timestamps use the database clock;
future timestamps, malformed revisions and old deployment evidence cannot pass.

The operations singleton stores only two completion timestamps and one deployment
revision. API roles have no direct table access; service-only RPCs write and read
the bounded projection. Cron telemetry contains only a removed-batch count or the
closed `scanner.maintenance_failed` signal. These are readiness and failure signals,
not a claim that a downstream alert or log-retention policy has been configured.

Apply the additive operations migration before deploying this code. After migration,
run `select public.cleanup_organization_scans();` as an authorized database operator
and verify the projection before release certification. After deployment, observe
scheduled cleanup advance the timestamp, and verify hosted Inngest recovery. Never
manually write a completion timestamp to satisfy readiness. If certification reaches
the new deployment before its first required scheduled run, rerun certification
after the actual run completes. Preserve the additive schema on application rollback.

## Failure semantics

- A webhook endpoint rejected by the shared validator (SSRF, non-HTTPS, private
  host) is recorded as a permanent misconfiguration and never retried; it does
  not fail the run.
- Transient delivery and send failures retry with backoff (3 retries for
  webhooks and nudges, 2 for feed checks); exhausted retries mark the run
  failed in the Inngest dashboard, which is the alerting signal.
- The freshness cooldown ledger is stamped only after a successful send, so a
  page whose nudge ultimately failed is picked up again by the next daily cron
  run instead of being suppressed for a whole cooldown window.

# Organization workspace implementation

This is the delivery record for the v4 implementation plan. The first commitment
is the commercial/data decision pass (Stage 0) and a bounded public website scanner
(Stage 1). Connected merchant reports and merchant-reviewed changes have separate
evidence gates.

## Stage 0 decisions

Taio confirmed that the agency operator, merchant, reporting task, and pilot price
have not been chosen. These remain open decisions, not validated assumptions.

| Decision | Evidence required | Status |
|---|---|---|
| Agency and merchant | Named operator and plausible consenting merchant | Open, Taio |
| Task to replace | Representative report and baseline preparation time | Open with pilot operator |
| Source coverage | Available Nexez activity, missing sources, dates and currencies | Open with merchant |
| Commercial offer | Pilot price, continuation price, limits, decision date and price-specific commitment | Open, Taio |
| Consent and disclosure | Owner-account scope, history, expiry, capability dependencies and optional financial disclosure | Before connected reporting |
| Scanner policy | Quotas, target pressure, robots behavior, acceptable use, retention and incident owner | Before scanner activation |
| Attribution | Optional branch or separately priced amendment | Remains outside the first slice |

No external participant has been contacted, and no commercial commitment is
represented as obtained. Technical foundation work can proceed while these
decisions are open. Stages 2 and 3 require independent connected-report evidence.

## Slice A: organization identity and access

The additive schema introduces organizations, fixed owner/operator memberships,
private finite scan entitlements, and private runtime controls. Organization
membership never substitutes for a merchant's `owner_id` or existing page access.

The application adds:

- `/console`: the authenticated, paginated workspace directory
- `/console/[orgSlug]/scans`: the authorized pilot workspace entry page
- `GET /api/organizations?cursor=...`: up to 50 memberships and a continuation cursor
- `GET /api/organizations/[orgId]/context`: one current workspace projection

The console has explicit organization navigation and a link to the merchant
dashboard. It does not mount seller chrome or fetch seller attention. It does not
offer scan submission until the execution slice exists.
Sign-out is available directly in the console, affects only the current session,
and uses a full navigation to clear the browser's in-memory workspace state.

### Authorization contract

- Authenticated public RPCs derive `auth.uid()` and join current membership,
  organization, runtime controls and the existing auth user in one SQL statement.
- Only active memberships in active organizations are returned. Banned, deleted,
  and anonymous auth users receive no organization context.
- Foreign, disabled, missing and suspended contexts return the same API 404.
  Invalid authentication returns 401. Database failures return a generic 503.
- Directory and context responses are private and `no-store`, including failures.
  Pages are dynamic, have no-index metadata, and use leaf-level authorization.
- SQL functions have an empty `search_path`, fixed return types and a hard row
  bound. All four tables enable RLS and revoke direct access from PUBLIC, anon,
  authenticated and service_role. Only authenticated may execute the two reads.
- Role and organization claims in user metadata confer no authority. There is no
  service-role fallback, broad merchant query, or shared authorization cache.
- Each read uses its own statement snapshot. A suspension committed before that
  statement denies it, including when the caller already has an open transaction.
  A read authorized before suspension may finish. The application bounds RPC
  requests to five seconds.
- Returned scan limits are informational. They are never a reusable permit or a
  quota reservation. Group B must reauthorize inside each command and worker.

### Disabled defaults and finite limits

`private.organization_runtime_controls` starts with both `workspace_enabled` and
`scan_submission_enabled` false. New organizations start disabled and new scan
entitlements start disabled. Missing control rows deny access; missing entitlements
never grant scanning.

For this pilot implementation, entitlements must have a finite start/end window no
longer than 90 days. The initial engineering ceilings are 50 targets per batch, 250
per organization per day, and 3 concurrent targets. Smaller limits are supported.
These ceilings are not an agreed price, a measured capacity guarantee, or an
invitation to activate scanning. Stage 0 still confirms the launch policy.

The creating migration reserves `console` in both public-name namespaces. It aborts
if a merchant already owns a conflicting identifier. Web and mobile reserved-name
validation include the same reservation. Console routes get the existing app-host
authentication and framing protection.

### Provisioning and rollout

Production schema application and pilot activation are separate release steps.
No production organization or entitlement is provisioned by this slice.

Before applying the migration, check existing `console` claims, listing slugs and
storefront handles. A conflict requires a deliberate resolution with the owner.
Do not delete, reassign or silently overwrite an existing claim.

An authorized database operator provisions the initial pilot in one transaction:

1. Verify the named owner's real auth user, current status and participant consent.
2. Insert the organization with its reviewed slug and display name, initially disabled.
3. Insert its sole owner membership and any explicitly selected operator membership.
4. Insert a disabled entitlement with reviewed finite dates and limits.
5. Verify identity, membership and limits, then commit.

The application exposes no self-enrollment, membership mutation, custom role,
merchant consent, billing, or publication endpoint in this slice. Manual identity
provisioning ends when the later validated onboarding slice replaces it.

After additive schema deployment, deploy the code with controls still disabled.
An explicitly selected internal fixture can then enable workspace visibility for
verification, while `scan_submission_enabled` stays false. Turning off workspace
visibility denies new organization reads without altering direct merchant access.
Do not drop the additive tables to roll back application code.

Future mutation commands must lock stable roots in order: runtime controls,
organization, membership, entitlement, then job-specific rows. No external network
work may occur while these locks are held. Group B must test this protocol against
membership suspension, entitlement changes, cancellation and worker recovery.

### Verification entry points

- Application authorization and response tests: `lib/server/organization-context.test.ts`
  and `app/api/organizations/route.test.ts`.
- Routing and reserved-name tests run in the standard root Vitest suite.
- `supabase/tests/organization_workspace_foundation.sql` runs from the already
  required `plan_entitlements.test.sql` entry point, after its transaction rolls back.
- `scripts/test-organization-read-boundary.py` runs from the existing required
  `plan_entitlements_concurrency.sh` entry point. It rejects non-local database URLs
  and restores its synthetic fixtures and controls after testing.
- CI must replay every migration on a fresh Supabase database, lint the application
  schemas, run both SQL entry points, and pass the application build and dead-code
  checks before this slice is considered release-ready.

No workflow file is changed. The existing fixed workflow list still omits unrelated
older database suites from audit finding F13; this slice does not claim to fix that
wider coverage gap. Workflow-write access remains an outstanding platform prerequisite.

### Local evidence for Slice A

- 5,133 root tests passed. The existing opt-in live website importer benchmark
  stayed skipped. Five local-server tests initially hit the sandbox's loopback
  restriction; the complete suite passed when rerun with loopback access.
- TypeScript, ESLint, palette and em-dash checks passed. All 46 mobile platform
  contract checks passed, including the new reserved-name parity case.
- Fresh PostgreSQL 17 fixtures passed the isolation gauntlet and the five checks
  in the two-session read-boundary test. Existing claims, listings and storefront
  names each caused atomic migration rollback; a clean replay then succeeded.
- A 12-case browser matrix passed with synthetic loopback auth and the real local
  PostgreSQL RPCs. It covered signed-out return routing, member directory and
  workspace navigation, cross-org API/page denial, suspension, session switching,
  runtime disablement, RPC failure handling, both themes on mobile and local sign-out.
  No uncaught browser exceptions were observed in the final run.
- The Supabase advisor found no warnings on the organization objects. The minimal
  merchant fixtures initially generated two unrelated advisor notices; after
  aligning their row security with the test contract, the full fixture scan was clean.
- A read-only production precheck found zero conflicting console claims, listing
  slugs or storefront handles. The organization schema was not yet present.

The local database fixtures do not replace the full Supabase migration replay.
Production Supabase Auth, physical devices, real partner data and scanner execution
are not covered by this browser fixture. Root production build and dead-code checks
remain CI gates under the repository's documented sandbox limitations.

### E2E prerequisite found during CI

The initial PR's application build, dead-code check, mobile checks and full Supabase
replay passed, including the new SQL and concurrency tests. Its existing Settings /
Agent Lab E2E flow exposed a saved-history race: a successful save completed about
30 milliseconds before an older, empty history response overwrote the visible list.
The saved database row was not lost, but the interface reported zero saved runs.

A narrow follow-up refreshes history after persistence and ignores superseded
responses, loading changes and errors. Three deterministic component cases first
reproduced the failure and then passed for a late empty snapshot, server failure
and network failure. The original E2E assertion is unchanged. This prerequisite
fix is recorded separately from organization authorization.

### Slice A release

PR #282 merged at GitHub's `2026-09-08T03:20:01Z`, commit
`2d27842527116f826a51b1c5eea36a442821085e`. The approved foundation migration was
applied and verified before deployment. Production CI, full Supabase replay,
mobile checks and Vercel deployment passed. Release certification passed 13 checks;
the optional Stripe catalog check was skipped because its CI secret was absent.
Both production controls remained disabled, with no organization or entitlement
provisioned. Ten post-release HTTP smoke scenarios and the sign-in return path passed.

## Slice B: scanner execution and results

The scanner now accepts pasted origins or one-column CSV, reserves quota, runs
durable target work and displays a versioned readiness score with fixed findings.
Operators can cancel pending work, delete a batch early, and select a successful
result for manual follow-up. Uploaded CSV files are parsed in browser memory;
the server receives the bounded text input and stores only normalized origins.

### Commands and authority

- `/api/organizations/[orgId]/scan-batches` lists recent batches and accepts submissions.
  The batch-specific route reads results, cancels, selects follow-ups and deletes.
  Every route verifies the current session, and every SQL command checks current
  database membership. Reads and errors are private and `no-store`.
- Batches and targets use organization-scoped composite foreign keys. The original
  membership ID and actor remain attached to the batch; deleting and re-creating
  membership cannot revive its old jobs. Base-table access stays revoked for all
  API roles. User commands and worker commands have separate execute grants.
- Submission locks runtime, organization, membership and entitlement before
  atomically reserving quota and creating the batch, targets and receipt. The
  default ceilings remain 50 per batch, 250 per org per UTC day, and 3 concurrent
  targets per org. An additional durable 250-target actor limit spans organizations.
- The org and UUID request key identify one canonical, sorted, deduplicated target
  set. An exact replay returns the original receipt. A changed set returns 409;
  a deleted or expired batch returns 410. Receipt lookup precedes fresh DNS checks
  and runner availability so a lost response can be recovered during an outage.
- Accepted targets spend quota even if cancelled, blocked or unsuccessful. Retries
  and exact replays spend no additional quota. Deletion does not refund quota.

### Durable work and target policy

- Inngest events contain only org and batch UUIDs. Claim, network work and completion
  occur inside a single step that returns only a progress boolean. Origins,
  fetched content, scan results and authorization decisions are never memoized
  as step output. The existing Inngest serve route registers both new functions.
- Claims receive a unique 75-second lease and at most three network attempts.
  Network errors retry after 30 seconds. Shared pressure defers without spending
  an attempt. Completion rechecks current actor, membership, entitlement, runtime,
  batch deadline and exact lease token. Revoked, cancelled, deleted and stale work
  cannot write results. Counts are derived from target states, preventing drift.
- The database queue acts as an outbox. A one-minute recovery job reserves up to
  20 batches for dispatch, with a two-minute redispatch interval. Dropped sends and
  abandoned leases recover without a new reservation. Batches stop accepting work
  after 20 minutes; the periodic sweep terminalizes remaining work on its next run.
- Inputs allow normalized public HTTP(S) origins on standard ports. Credentials,
  paths, query strings, fragments, IP literals and reserved private suffixes are
  rejected. Execution revalidates the origin. Every actual connection and redirect
  checks public DNS answers and pins its socket to the validated address.
- A shared database limiter covers every default signal-gathering caller, including
  the anonymous and deep scanners. It permits at most 8 active scan tokens globally,
  1 per registrable domain, 30 scan starts per domain per minute, and 4 redirect
  domains per scan. Private suffixes distinguish hosted tenants. Missing or disabled
  limiter state denies work. Network leases expire after 50 seconds.
- `NexezBot` checks robots rules before the homepage and every auxiliary request.
  Missing robots files (404/410) allow crawling. Denial, indeterminate responses,
  overlong rules and oversized files stop the relevant work. Robots redirects must
  remain on the same registrable domain and `/robots.txt` path. Glob matching avoids
  attacker-controlled regular-expression backtracking.
- Each org scan has a 28-second network deadline, 32 transport attempts and 3 MiB of
  processed response bytes. Existing per-file caps and redirect limits still apply.
  Successful domains have an organization-specific 24-hour cooldown. The transient
  shared limiter and cooldown use privately salted domain hashes.
  Default anonymous callers use a 20-second network deadline, leaving time for
  lease cleanup inside their existing 30-second route budget.

### Data lifecycle and operations

Stored results contain only rubric version 2, a bounded score and 18 closed check
IDs/status codes. All labels and suggested actions come from application copy.
The database rejects fetched text, extra JSON fields, duplicate check IDs, unknown
statuses and unbounded metrics. Redirect URLs, query strings, HTML, response
headers and raw transport errors are absent from results and operational events.

Targets and results expire after 90 days, and expired data is hidden before the
cleanup job deletes it. Early deletion removes both tables' rows and retains only
the receipt needed to reject a replay. Receipts expire after 90 days. Daily counters
are retained for two days; shared windows for one day; cooldowns for 24 hours.
Operational events retain only opaque identifiers, closed codes and bounded
queue-wait/duration/byte/probe counters for 30 days. Submission, cancellation, deletion,
revocation and follow-up audit records retain those minimal fields for 24 months,
including the authenticated actor's pseudonymous UUID when present.

The API emits closed quota-denial events, and scanner contexts emit separate
limiter-unavailable events, through the existing observability sink without URLs,
request keys or raw errors. Set that sink's retention to at most 30 days before
pilot activation. `supabase/tests/organization_scan_metrics.sql` provides a bounded,
read-only org usage report: reservations, outcomes, retries, pressure deferrals,
queue/execute p95, processed bytes and probes. Dollar estimates remain null until
an operator supplies observed per-attempt and per-GiB unit prices from the actual
provider bill. These estimates exclude fixed plans and unallocated platform overhead;
wall duration and processed bytes do not pretend to be exact provider CPU/egress meters.

Before activation, the operator must approve this policy, confirm an incident
owner and the `/support` complaint route, and verify the Inngest cron is registered
on `https://app.nexez.ai/api/inngest`. The new `scan_policy_approved` flag defaults
false, in addition to the existing disabled runtime and entitlement defaults.
Check the event/signing keys and service-role environment before enabling a pilot.

For a scanning incident, turn off `scan_submission_enabled` to deny new org
claims and completion, or turn off `private.scan_network_controls.enabled` to
stop all new scanner transport. Add a registrable domain to
`private.scan_target_denylist` for a complaint. A request already on the wire may
finish within its bounded deadline; an org result still requires fresh authority.
Keep recovery running so retention and cancellation cleanup continue. Application
rollback preserves additive data and leaves the pilot disabled.

### Verification evidence and limits

- Root suite: 5,208 tests passed before the browser-origin regression was added.
  The existing opt-in live importer benchmark stayed skipped. TypeScript, ESLint,
  palette and em-dash checks passed. Production build and dead-code remain CI gates.
- The browser exposed Next's loopback URL reconstruction (`localhost` versus the
  requested `127.0.0.1`). The origin check now uses the browser's Host header and
  ignores `X-Forwarded-Host`; the focused API regression passed after this fix.
- Fresh PostgreSQL 17 replay passed the lifecycle gauntlet, including wrong-org
  access, exact/conflicting/deleted replay, quota rollback, result validation,
  stale leases, cancellation, re-enrollment, revocation, kill switch and retention.
- Real parallel sessions proved one batch from 12 simultaneous replays, a shared
  250-target actor quota across orgs, three distinct org claims, blocking against
  an uncommitted suspension, deletion without resurrection, eight global permits,
  one per domain, idempotent permits and recoverable outbox dispatch.
- The real Next UI, local Inngest server, synthetic auth adapter and PostgreSQL
  commands completed a three-site public sample (example.com, nexez.ai, schema.org).
  All three succeeded on attempt one. Target durations were 314, 1,991 and 419 ms;
  processed bytes were 559, 296,421 and 3,308. Each stored result was 750 or 751 bytes,
  containing only `score`, `checks` and `version`. Follow-up persisted with an audit
  event; browser deletion left zero batch/target rows and one replay receipt.
- The local Inngest callback needed the fixture's localhost redirect changed from
  port 3000 to port 3117. The initial queue delay belongs to preview setup, not a
  production performance measurement. Production auth and Inngest cloud execution
  are separate deployment checks. No production org or scan data was created.
- Mobile rendering and findings were inspected in both themes without overflow or
  an error overlay. Component tests cover retry-key preservation, authorization
  loss, late stale responses, follow-up and deletion confirmation.

The SQL and concurrency suites run from the existing required entitlement test
entry points, without a workflow edit. Full Supabase replay, advisors, build and
dead-code checks must still pass in CI before release. The three-site sample is
an integration check, not a representative capacity benchmark. Pilot acceptance
still needs at least 95 percent of accepted targets reaching a documented outcome
within the budget, with useful results and terminal failures reported separately.

Pilot success then requires actionable findings, a selected real follow-up, repeat
use or a scheduled next use within 14 days, and plausible unit economics. Scanner
evidence permits scanner expansion; it does not establish demand for connected
merchant reporting.

### Slice B release

PR #283 merged at GitHub's `2026-09-08T05:50:16Z`, commit
`9933f2104b34e9dee0f40afe0a271dea73ed6a1d`. The approved execution migration was
applied and its exact SQL and grants verified before deployment. Production CI,
full Supabase replay and Vercel deployment passed. Release certification passed
13 required checks; the optional Stripe catalog check lacked its CI secret.
The public scanner and seven signed-out workspace boundaries passed production
smoke checks. All three pilot controls remained false, with no organizations or
entitlements provisioned. Event and signing key names were present in production;
a successful hosted Inngest recovery invocation was not verified by this release.

## Slice C: scanner operations readiness

The independent five-minute maintenance endpoint keeps scanner retention running
without Inngest or pilot activation. Both cleanup paths record a transactional
completion timestamp. Recovery records its deployment revision only after dispatch
succeeds. Launch Control now reports fresh cleanup, overdue batch retention and
recovery from the current deployment. Scanner data and raw errors never enter the
operations projection or cron telemetry.

Cleanup is a required platform check even with the pilot off. Recovery is required
when submissions are enabled, and an optional attention item while disabled.
Unavailable controls never imply a disabled pilot or a healthy runner. These checks
report readiness; activation still requires the Stage 0 policy and participant
decisions above. The detailed rollout and recovery procedure is in `docs/inngest.md`.

### Local verification

- All 5,265 root tests passed, including 55 operations cases. The existing opt-in
  live importer benchmark remained skipped. TypeScript passed. ESLint had zero
  errors and 14 existing warnings in unrelated files.
- The prior scanner lifecycle suite and new operations gauntlet passed on a fresh
  clone of the disposable PostgreSQL 17 execution fixture. The new suite covers
  role denial, fixed grants/search paths, disabled-pilot cleanup, 100-batch limits,
  remaining retention debt, cascading target deletion, shared anonymous record
  cleanup, transaction rollback, malformed revisions and missing control roots.
- Six local HTTP scenarios passed through the real Next route and SQL commands
  behind a synthetic Supabase adapter: absent/wrong cron credentials, successful
  cleanup, Launch Control integration, unproven-runner blocking and sanitized
  failure when the marker row is absent. These fixtures use no production secrets.
- The operations SQL suite uses the existing required entitlement test entry point.
  No workflow changes are needed. Full Supabase replay, build and dead-code checks
  remain CI gates under the repository's documented sandbox limitations.

Hosted Inngest verification still needs dashboard sign-in. Successful synthetic
tests do not prove cloud app sync, scheduled execution, delivered alerts, pilot
usefulness or unit economics. Production schema and deployment for this slice
remain pending approval after the reviewed branch passes its release gates.

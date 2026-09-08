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

- 5,130 root tests passed. The existing opt-in live website importer benchmark
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

## Next slice: scanner execution and results

Group B adds same-organization batches/targets, normalized paste/CSV input, atomic
quota reservation and canonical idempotency, durable Inngest execution, bounded
target claims and leases, cancellation, retry/recovery and safe results. It must
also implement shared target pressure, runtime stop controls, cost/latency metrics
and retention cleanup before enabling scanning.

Its acceptance evidence must include wrong-organization denial, URL/SSRF tests,
parallel quota tests, abandoned-worker recovery, no resurrection after deletion,
safe logs/storage, and real bounded-domain results. At least 95 percent of accepted
work must reach a documented terminal outcome within the configured budget; useful
results and terminal failures are measured separately.

Pilot success then requires actionable findings, a selected real follow-up, repeat
use or a scheduled next use within 14 days, and plausible unit economics. Scanner
evidence permits scanner expansion; it does not establish demand for connected
merchant reporting.

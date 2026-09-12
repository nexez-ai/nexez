# Merchant report inputs

This slice adds an owner-only source reader for the candidate report contract.
It advances Stage 2's technical foundation. It does not close the participant,
report-purpose, period or source-coverage decisions, produce a merchant website
baseline, or give an organization access to merchant data.

## Entry point and authority

`GET /api/merchant/report-inputs?listingId=<uuid>&month=YYYY-MM` returns the strict
`OrganizationReport` contract with `dataBasis: merchant_sources`. The route accepts
exactly those two parameters, derives the actor from the verified cookie or bearer
session, and uses that session's Supabase client. Duplicate parameters, owner IDs,
organization IDs, caller-supplied coverage and report bodies are not accepted.

The public `read_merchant_report_inputs(uuid,date)` RPC is a security invoker.
Its implementation is a security definer in the non-exposed `private` schema,
with an empty search path and explicit current-user/current-page-owner checks.
Neither anonymous nor service-role callers can execute it. Actual anonymous,
banned or soft-deleted user rows deny even if an old token still exists.
Organization membership and collaborator access never substitute for ownership.

`private.merchant_report_access` is empty on migration. An operator must explicitly
enroll an owner with a finite expiry and enable the row after the report and source
decisions are approved. This is a separate pilot entitlement, not an extension of
the internal scanner entitlement or an agency consent grant. The API and RPC
remain unavailable to an unenrolled owner. No production enrollment accompanies
this implementation.

Every read checks the current owner, account status, pilot enablement/expiry and
coverage in one stable PostgreSQL statement snapshot. A bounded read already in
progress may finish using that snapshot. A subsequent statement under the normal
read-committed API transaction sees committed withdrawal or transfer immediately.
The server adapter has no shared cache, service-role fallback or owner-rollup reuse.
Successful and unsuccessful API responses use `private, no-store` and vary by
Cookie and Authorization.

## Data and bounds

| Source | Returned inputs | Boundaries |
|---|---|---|
| Current listing | Name, description, publication state and eleven canonical readiness presence signals | Current owner and selected listing; no draft, offer, contact, URL or integration payload |
| Recorded traffic | Total records, detected AI subset and verified-server/unverified-client/legacy partition | Both stored owner and selected listing; attested collection interval |
| Durable orders | Proven-live supported payment counts plus disjoint test/unknown-mode/unsupported-status exclusions | Stored owner account, including other or deleted listings; attested interval |
| Website | `not_collected` | No approved association or merchant snapshot producer exists yet |
| Financial summary and attribution | Existing disabled/unavailable states | No amounts, buyer details, transaction identifiers or inferred conversion rate |

The candidate period is one of the previous twelve completed UTC calendar months.
Bounds are inclusive at the start and exclusive at the end. The database supplies
the observation time; the application does not rely on its host's clock to claim
that a month is complete. Payment status is the state observed now for orders
created in the covered interval, not a historical month-end status. Refund and
dispute states remain counts; no monetary refund or currency arithmetic occurs.

SQL classifies order mode first. A test order with an unknown status counts once
as excluded test mode. An unknown-mode order counts once as unknown mode. Only a
proven-live order can enter the supported-status or unsupported-status categories.
Traffic means recorded visits, not unique visitors or verified agent identity.

Each source reads at most 100,001 matching records. Up to 100,000 produces exact
counts. The sentinel row makes a larger source `calculation_failed`, with no
partial total or raw record returned. A new owner/page/time index supports visits;
orders use the existing owner/time index. HTTP reads are limited to six per minute
per authenticated user, fail closed on limiter failure and have a five-second
client deadline. Direct session RPC calls retain the owner/pilot and row bounds.

Listing presence signals use the current `nexez.agent-ready` / `2026.1` semantics
and order. The server constructs the canonical criteria and score, then validates
the entire report. Malformed collection JSON and oversized listing copy produce
`calculation_failed`. TypeScript exercises all 2,048 signal combinations; SQL covers
the 1,536 combinations allowed by the published-listing slug constraint.

The server hashes each metric's bounded values, definition version, exact scope
and coverage evidence. Order hashes use account scope; listing and traffic hashes
use account plus listing. These are reproducible input fingerprints, not signatures,
authorization tokens, frozen historical reports or immutable website snapshots.

## Collection coverage

`private.merchant_report_coverage` is also empty on migration. Authenticated,
anonymous and service-role clients have no direct table privileges. Only an
operator with database privileges can record or withdraw reviewed collection
evidence. There is no application endpoint for self-attestation.

Before enrollment, retain a dated evidence artifact with the approved report
purpose, owner/listing scope, collection paths, operational checks, retention
limits, known gaps and exact UTC interval. Its SHA-256 digest is required on the
coverage row. A hash does not itself prove collection was working: the operator
must review the evidence. This slice does not automate that judgment.

Coverage is scoped to owner, source, calendar month and, for traffic, listing.
Orders require an account-level row with no listing ID. The single reviewed
interval must fit inside the month and end by its attestation time. An attestation
dated after the read is ignored. A complete label requires the exact full month;
otherwise the report counts only the declared partial interval and labels it.
Disjoint collection intervals are not silently joined across a gap.

Existing events, account age, listing creation time and scanner enrollment never
establish coverage. Without evidence the metric is `no_coverage`, including when
rows exist. With valid evidence and no matching rows, an available zero is honest.
Evidence withdrawal affects the next read. Ownership transfer neither grants the
former owner access nor gives the recipient the former owner's coverage or visits.

## Verification and release

- `supabase/tests/merchant_report_inputs.sql` exercises real PostgreSQL grants,
  current identity, owner isolation, month bounds, readiness, source privacy,
  coverage/missingness, order classification and the exact/overflow row limits.
  All fixtures and adversarial source changes roll back.
- `scripts/test-merchant-report-boundary.py` uses two local PostgreSQL sessions to
  prove committed coverage withdrawal, reattestation, ownership transfer, recipient
  isolation, pilot disablement/expiry and stale-token ban behavior. Its fixtures
  are uniquely named and cleaned up. It refuses non-loopback databases.
  Normal owner updates remain forbidden by the existing owner-pin trigger. The
  test proves that denial, then simulates a privileged repair with a writer-local
  trigger bypass to exercise current ownership without weakening the real guard.
- Both database checks are included in the existing required entitlement test
  entry points, so no workflow-write permission is needed. CI replays the entire
  Supabase schema; the targeted local PostgreSQL harness uses minimal source tables.
- The source-adapter and API tests cover strict projection, input validation,
  hashes, missingness, bounds, redaction, rate limits and cache headers. To transport
  an actual local SQL result through those tests, set `NEXEZ_REPORT_SQL_FIXTURE` to
  a temporary JSON path when running the boundary script and the API test.

The migration is additive and creates no enrollment, coverage evidence, scheduled
job or new navigation. Production migration application and merge/deployment are
separate release steps. Disable a pilot by clearing its enabled flag or expiring
its access row; remove a coverage row to stop that metric. Existing merchant
analytics and the internal scanner continue to use their existing paths.

The next source slice is merchant-approved website association and immutable
baseline collection. Agency reporting still requires the Stage 3 consent,
capability and current-authority boundary. Real participant/source evidence and
the operator's confirmation of the candidate period remain open.

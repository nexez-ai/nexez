# Merchant website baselines

This Stage 2 slice lets an enrolled listing owner approve the listing's current
public website, request a fresh observation, inspect its result, and revoke that
approval. It creates no organization access, attribution, scheduled collection,
domain ownership claim, prospect-history import, or pilot enrollment.

## Owner flow

The Website baseline panel appears in listing settings for the current owner
when collection is enabled, or when an active association remains readable. An
inactive, empty pilot adds no controls to ordinary settings. Editors and viewers
do not receive the panel, and all API/RPC commands independently check ownership.

The owner explicitly confirms the displayed origin and collection terms. This is
labelled `merchant_approved`; it does not reuse the separate website verification
feature's badge or imply independently verified domain ownership. Approval lasts
until the earlier of the report pilot's expiry and 30 days. The original website
URL is held privately as a change fence. Changing that field, even to another URL
on the same origin, invalidates the approval for collection and report reads.

Collection follows a separate click. One observation is a baseline, not a trend.
An on-demand recheck produces another immutable observation. A failed collection
has a bounded failure code and no score. An interrupted request expires visibly;
the owner can refresh and submit a new request. There is no automatic network retry.

`GET /api/merchant/website-baseline?listingId=<uuid>` returns the current owner view.
`POST /api/merchant/website-baseline` accepts a strict `approve`, `collect`, or
`revoke` command. Owner IDs, organization IDs, scores, provenance and verification
claims cannot be submitted. Mutations enforce same-origin browser requests,
bounded JSON, verified sign-in and a fail-closed per-owner rate limiter. Every
response, including errors, is private and no-store and varies by Cookie and
Authorization. An uncertain browser retry preserves its request key.

## Database and commit boundary

The additive migration creates four private tables with RLS and no direct grants
to anonymous, authenticated or service-role clients:

- `merchant_website_controls` contains an initially false collection switch.
- `merchant_website_associations` binds the owner, listing, approved origin,
  approval version, confirmation time, expiry and private website-change fence.
  Its evidence is immutable; only one-way revocation is allowed.
- `merchant_website_collections` records bounded request receipts, state and
  one-use worker leases. Its minimal owner/listing/association UUID references
  deliberately survive resource deletion so deletion cannot reset daily usage.
  It holds no website URL, fetched content or organization identity.
- `website_readiness_snapshots` stores immutable merchant observations, exact
  association scope, scanner/rubric versions, bounded results or failure codes,
  observation/creation times and source fingerprints. A composite foreign key
  prevents mixed owner, listing, association or origin records.

Session commands derive `auth.uid()` and check the actual current user row. A
missing, anonymous, banned or soft-deleted user cannot authorize work. A short
transaction locks controls, the user, the current listing, pilot access and the
association before reserving work. Requests are limited to three per owner per
UTC day, across listings, with one active collection. Replays reserve once. The
approval-record cap is 100 per owner until old records are removed by retention.

Only the service worker can claim or complete a collection. It receives the stored
origin and an unguessable, single-use 45-second lease. The entire request has a
90-second deadline. No database locks remain held while fetching. Completion
rechecks current ownership, account status, pilot access, the collection switch,
the original website field, association validity and the lease before inserting
a snapshot. Withdrawal or expiry before that check discards the result. A command
that already passed its locked check may finish before a waiting revocation
commits; later reads and commands see the committed revocation.

The public RPC wrappers are security invokers. Privileged implementations remain
in the private schema with empty search paths and explicit function grants. The
session cannot finalize evidence; the service role cannot approve on behalf of a
merchant. Error responses never expose SQL details, lease tokens or fetched text.

## Website fetching and report inputs

The collector uses the existing scanner with pinned DNS, private-network checks,
robots enforcement, shared target/concurrency pressure, a 20-second network
deadline, a 3 MiB aggregate body budget and at most 32 requests including redirects
and auxiliary probes. Every request must remain on the exact approved origin,
including robots redirects. An apex-to-www redirect therefore requires the owner
to save and approve the final website address; it cannot silently change scope.

Only the rubric's eighteen check IDs and `pass`/`warn`/`fail` statuses are stored.
No HTML, fetched labels, page text, credentials or prospect results enter snapshots.
Scanner version `site-scan-2.1` and website rubric version 2 identify this producer.
The database hashes canonical JSONB containing the scope, collection, observation
time, versions, result and failure. This is an input fingerprint, not a signature
or authorization token. Future scanner changes must advance their version.

`read_merchant_report_with_website(uuid,date)` combines the existing source reader
and the latest observation for the currently approved association in one stable
statement snapshot. The old report RPC remains unchanged for older deployments.
The TypeScript adapter validates the projection and constructs the existing report
contract. A website observation is current evidence, independent of the completed
calendar month selected for traffic and order counts. The latest failed observation
is calculation unavailable; missing or withdrawn associations are not collected.

## Retention and release

Observations and minimal collection receipts are retained for 30 days. Reads
exclude expired observations even before cleanup runs. Approval metadata is kept
until 30 days after its expiry, at most 60 days after confirmation. Listing deletion
cascades associations and observations; account deletion also removes receipts.
The existing independent five-minute scanner-maintenance job calls a bounded
service-only cleanup function, deleting at most 100 rows per table per invocation
(association deletion can also cascade its remaining observations). Cleanup works
with collection disabled. A cleanup failure fails the maintenance job visibly.

Apply the migration before deploying the application, since the owner report
adapter and maintenance path call the new RPCs. The migration does not enroll an
owner or enable collection. Activation requires an approved owner report pilot,
the collection switch, and that owner's explicit in-app website approval. The
internal scanner entitlement does not satisfy these requirements. Disable the
collection switch to stop approvals, reservations, claims and result commits;
existing valid owner observations remain readable until withdrawal or expiry.

## Verification

`supabase/tests/merchant_website_baselines.sql` is part of required clean replay.
It exercises grants, current ownership, approval validation, duplicate requests,
single-use claims, immutable evidence, closed result fields, website changes,
failure semantics, reporting and quota preservation through resource deletion.

`scripts/test-merchant-website-boundary.py` uses independent local sessions for
eleven authority/expiry changes during collection, simultaneous retries and
competing reservations. It refuses non-loopback database URLs and connection query
overrides. Ownership transfer is only a synthetic privileged-repair fixture; the
production immutable-owner guard remains intact. An optional local fixture output
transports a real PostgreSQL snapshot through the TypeScript report adapter/API.

Unit and component tests cover RPC context matching, redaction, transport limits,
origin fencing, changing approval targets, uncertain retries and failure display.
The authenticated settings E2E uses a disposable listing and synthetic baseline
API responses, so it exercises the visible approval/collection/revocation flow
without creating production evidence or enabling a pilot. Full-schema replay,
production build and dead-code checks remain CI release gates.

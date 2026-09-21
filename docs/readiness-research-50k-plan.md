# 50,000-site research execution plan

Status: disabled production database migration installed; source extraction
and application deployment in progress. No production run started.

## Authorization and checkpoints

- User authorized end-to-end execution on 2026-09-21.
- Incremental cloud-cost ceiling: USD 100, excluding existing subscriptions.
- No paid data purchase without separate approval.
- User approved Overture as the new source on 2026-09-21. Use release
  `2026-08-19.0`, the latest release reported by its STAC catalog at selection.
- Target: 50,000 usable, unique US business websites in the existing five
  broad categories. This is a new expanded cross-section, not automatically a
  longitudinal comparison or a nationally representative sample.
- Gate 1: freeze and audit the source frame, eligibility rules and deduplication.
- Gate 2: deploy a disabled runner after local tests and CI.
- Gate 3: collect at most 500 successful pilot observations, inspect yield,
  category coverage, latency, customer-capacity protection and measured usage.
- Gate 4: approve the cost projection against the USD 100 ceiling before
  increasing the success target. Pause for the owner if costs or scope change.
- Gate 5: verify final accounting and prepare the research article, methodology,
  charts and promotional copy for owner approval before publication.

## Safety and measurement contract

- Cloud scheduler and durable database state, no continuously running laptop.
- At most three research network leases; preserve at least three global slots
  for non-research work. Never raise the customer's shared limit to accelerate.
- Bounded requests and bytes, honest NexezBot identity, robots and SSRF guards.
- Expiring per-target leases, fenced completion, atomic result persistence,
  bounded retry, and automatic pilot/target/budget/deadline stops.
- Failed fetches, robots exclusions and duplicate final domains are reported
  separately, never treated as zero-scoring successful observations.
- Source provenance and deterministic ordering are frozen before scanning.
- Public output contains only aggregates, not raw domains, page text, IPs or
  contact lists. This study does not send outreach or test actual AI ranking.
- Cost reservations are conservative operational estimates, not a real-time
  provider billing cap. Compare the pilot with provider usage before scaling.

## Work plan

1. Validate a sufficiently large free source and document sampling limitations.
2. Build the durable runner, capacity reservation and aggregate status.
3. Exercise SQL permissions, lease recovery, duplicate fencing and stop gates.
4. Run application tests, lint, typecheck and build; deploy through normal CI.
5. Freeze and import eligible candidates; launch the cloud pilot.
6. Audit the pilot and continue in bounded stages under the approved budget.
7. Finalize validated aggregates and approval-ready publication materials.

## Runtime and operations

- Endpoint: `POST https://app.nexez.ai/api/internal/readiness-research`.
- Research bearer authorization uses the separate `study_control.key=research`.
  The legacy runner key remains disabled and is not rotated or reused.
- `study_runs` is the control row. `study_run_targets` is the frozen frame and
  durable work queue. `study_run_results` contains one observation per unique
  final registrable domain. `study_run_dispatches` accounts for cloud requests.
- Store the new bearer only in Vault as `nexez_readiness_research_bearer`, with
  its SHA-256 in `study_control`. Never export either secret into this runbook.
- A postgres-owned cron invokes `dispatch_readiness_study(cohort)` once per
  minute. It reserves a cost allowance before sending the HTTP request.
- `study_run_status(cohort)` returns aggregates only. The status action on the
  endpoint uses the same projection. Never select target URLs into reports.
- Pause: set this cohort's state to `paused`. Emergency research-only stop:
  disable the `research` control key. Interactive scanning is unaffected.
- Finish: the runner automatically moves to `pilot_review`, `completed`,
  `exhausted`, or `paused` and stops dispatching. Unschedule its named cron at
  final completion. No polling of websites continues after a terminal gate.
- The application build and DB migration are additive and initially disabled.
  Rollback is to pause and disable research, then roll back application code.
  Retain source and result tables for audit instead of dropping study data.

## Source and reporting limitations

The source extract is limited to US states plus DC, records marked open, an
existence-confidence score of at least 0.9, a website, and no brand object.
Confidence is a relative filter, not a calibrated 90% guarantee. Missing brand
metadata does not prove independent ownership. Dataset coverage and website
availability are not a probability sample of all US businesses.

Use Overture's new `taxonomy` and `basic_category`, not its deprecated
`categories` field. Freeze the category mapping before scanning. Keep metadata
needed for provenance but do not collect names, emails, phones, street addresses
or page bodies into the source frame. Dedupe input and final domains separately.

The August study used OSM and different geography/selection. Do not claim that
the difference between the two studies measures change over time. A panel study
would require a separately identified comparable cohort and scanner audit.

Primary references:

- https://docs.overturemaps.org/guides/places/
- https://docs.overturemaps.org/attribution/
- https://docs.overturemaps.org/getting-data/duckdb/
- https://supabase.com/docs/guides/cron
- https://vercel.com/docs/functions/usage-and-pricing

## Verification so far

- Local PostgreSQL 17 fixture suite passed, including access controls, frame
  freeze, lease replay/expiry, atomic completion, final-domain dedupe, robots
  exclusion, pilot limit, budget/deadline gates and customer headroom.
- The fixture uses the actual existing limiter function. Only Vault storage and
  HTTP dispatch are stubbed locally, so production dispatch still needs a smoke
  test. Full Supabase clean replay belongs to the existing CI workflow.
- 5,599 application tests passed; one existing test skipped.
- Typecheck, lint (zero errors, existing warnings), palette, em-dash and dead-file
  gates passed. Production build passed with CI-style placeholder public env.
- The first build lacked public Supabase env values and failed configuration
  collection. No production secrets were copied into the build to fix it.
- PR 303 passed all CI checks, including full Supabase clean replay and E2E.
  The protected preview rejects unauthenticated research requests with HTTP 401.
- The additive migration was applied to production at version
  `20260921195549`. Research remains disabled until the separate smoke test.
  Security advisor warnings are unchanged from the pre-migration baseline.

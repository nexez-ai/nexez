# Website-readiness research execution plan

Status: two production pilots have been retained for audit only. Protocol 2
fixed HTML soft-404 discovery responses and unqualified HTTP 200 pages. Its
500-result spot audit then found a titleless expired-domain renewal page that
passed the readable-content gate. Protocol 3 excludes an explicit expiry notice
at the start of a short page. Deploy and run a separate frozen protocol-3 pilot
before scaling. Do not mix any prior pilot observations. See the private operations snapshot at
`outputs/research-50k-2026-09-21/STATUS.md` for current counts and rollout state.

## Authorization and checkpoints

- User authorized end-to-end execution on 2026-09-21.
- Incremental cloud-cost ceiling: USD 100, excluding existing subscriptions.
- No paid data purchase without separate approval.
- User approved Overture as the new source on 2026-09-21. Use release
  `2026-08-19.0`, the latest release reported by its STAC catalog at selection.
- Target: 50,000 usable, unique US business websites in the existing five
  broad categories. This is a new expanded cross-section, not automatically a
  longitudinal comparison or a nationally representative sample.
- The owner subsequently authorized including all additional qualifying results
  beyond 50,000 within USD 100. Do not truncate the final sample at that target.
  The schema permits a bounded target up to 100,000; this does not raise any
  active run's pilot, attempt, dispatch, deadline or cost limits.
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

## Research protocol 2

This section documents the superseded protocol. Its 500-result pilot is not
approved for publication or resumption.

The crawlability scorer remains version 2. An independent
`research_protocol_version=2` marks the revised research collection rules.
Customer scans do not opt into this protocol and retain their existing behavior.
The runner refuses incompatible cohorts before claiming work, and the database
rejects mixed-protocol observations. Protocol identity cannot change after a
cohort's source frame is frozen. Preserve the original pilot for audit, exclude
it from publication, and rescan into a separately identified protocol-2 cohort.

- Root llms.txt must be non-HTML/non-JSON text with the required Markdown H1.
  This is a bounded format check, not proof that any AI system uses the file.
  Subdirectory files and link-discovery are not part of this probe.
- Homepage responses must be HTML, have at least 80 extracted visible characters,
  and avoid the documented parked-domain, challenge and unavailable-page markers.
  These conservative heuristics need a pilot spot audit. They cannot prove a
  business is legitimate, independent or still trading.
- Exclude redirects to the same shared platforms excluded by source selection.
- Keep closed quality-failure codes separate from DNS/network failures, robots
  exclusions, and duplicate final domains. Do not give excluded pages a score.
- The visible-text threshold can omit legitimate minimalist or JavaScript-only
  sites. Report this exclusion and denominator; the results describe accessible
  qualifying HTML pages, not every business or every page on each website.

Each corrected pilot retains the 500-success checkpoint. Re-estimate final sample
size, source-frame size, attempts, dispatches and total cost using its yield.
The original 75,000-attempt and 14,000-dispatch limits are unchanged. Do not
enable a larger run just because its target ceiling was extended.

Format reference: https://llmstxt.org/ (proposal reviewed 2026-09-21).

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
- The original additive migration was applied to production at version
  `20260921195549`; its separate smoke test passed before the original pilot.
  Security advisor warnings are unchanged from the pre-migration baseline.
- The preview had applied the identical migration under its original filename.
  Its one matching history entry was aligned to the production timestamp after
  the renamed file exposed that mismatch. No schema or customer data was reset.
- Research protocol 2: both original defects reproduced as failing regression
  tests before the fix. Focused scanner, transport, network and research tests
  passed locally, as did the PostgreSQL fixture covering protocol fencing,
  privacy, expanded-but-bounded targets, quality exclusions and the pilot stop.
  Its additive production migration is `20260921232547`. Existing cohorts kept
  protocol 1 and their original limits. Security advisor counts stayed at the
  pre-existing baseline. Application deployment and full CI status belong in
  the operations snapshot.

## Research protocol 3

Protocol 3 retains the protocol-2 llms.txt and readable-HTML checks, and rejects
short pages beginning with an explicit expired-domain or expired-registration
notice. A registrar can return HTTP 200, omit its title and include hundreds of
characters of renewal and auction boilerplate. That is not a usable business
homepage. The rule is anchored to the leading notice to avoid excluding an
ordinary business page that discusses domain renewal later in its text.

The scorer remains version 2. Use a separately frozen protocol-3 cohort with
the original selection seed, candidates and ranks. Do not relabel or mix the
protocol-2 results. Carry all prior dispatch reservations into the new run's
other-cost reserve; this is still one USD 100 study allowance. The new migration
adds protocol 3 without changing active run limits. It also materializes the
locked batch selection: a non-materialized IN subquery with SKIP LOCKED could
be rescanned under some query plans and exceed the requested row count. The
local fixture reproduced a three-row claim for a two-row limit. Selection must
be evaluated once before updating targets. The 500-success pilot review and
every safety guard remain required.

## Offline frame tools

`research-source-overture.py` extracts minimal records without scanning sites.
After inspecting taxonomy counts, freeze exact category tokens in a mapping
JSON file with `release`, `version`, `selectedOn`, and `categories` keys.

`research-frame.mjs` accepts a JSONL export, mapping file, new output directory,
cohort, source Parquet path and optional per-category cap (default 15,000).
It emits a private target file and an aggregate manifest with input/output
checksums. It refuses insufficient category coverage and existing output paths.

`research-import.mjs` accepts that frame directory, an explicit project ref and
`--apply` (default: generate only). It verifies checksums and imports in resumable
1,000-record transactions. The cohort stays `preparing`; this cannot launch scans.
Inspect the imported counts and source manifest before freezing and enabling it.

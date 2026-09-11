# Organization report contract and review examples

This is a Stage 0 representative-report prototype and an executable prerequisite
for Stage 2. It is not a connected agency report. No route, database producer,
organization grant, financial release, website association or background job is
introduced. The React component is currently used by local examples and tests.

The proposed task is a short merchant update: establish current listing and
website readiness, show the limits of available Nexez activity, and select one
merchant-reviewed improvement. A real operator must still confirm that this
replaces useful work and is worth the proposed pilot price.

## Reviewable implementation

- `lib/organization-reports.ts` defines the versioned, strict report schema,
  minimal listing projection, fixed metric definitions and prioritized action.
- `components/organizations/OrganizationReport.tsx` renders a single report and
  refuses malformed data without displaying its contents. Its stylesheet uses
  the existing foreground, background and surface tokens.
- `lib/organization-report-examples.ts` contains three deliberately synthetic
  examples: illustrative activity, unavailable sources, and measured zero activity.
  The merchant, website observation, counts, identifiers and source digests are
  fixtures, not partner evidence. `example.com` was not scanned for this prototype.

Generate the local interactive review artifact from the same tested component:

```sh
ORGANIZATION_REPORT_PREVIEW_DIR=/private/tmp/nexez-report-examples \
  npx vitest run components/organizations/OrganizationReport.test.tsx
```

Open the resulting `index.html` to switch examples and themes. `examples.json`
contains the corresponding bounded data. The generator uses no network or
credentials and writes only when this output variable is explicitly supplied.
The example shell is a local review aid, not a production report-sharing mechanism.

## Metric definitions

All reports carry schema version, data basis, generation time, resource scope and
one completed UTC calendar month with an exclusive end. Available metrics have a
source observation time and a server-produced source digest. The schema checks
time ordering, canonical period boundaries, aggregate bounds and reconciliation.
The first candidate period is a single month even for nonfinancial counts; confirm
that choice with the operator before connecting sources.

| Metric | Source and definition | Unit, scope and time | Privacy and missing behavior |
|---|---|---|---|
| Listing readiness | Current `pages` content evaluated by `getReadinessScore` and `getReadinessCriteria`, standard `nexez.agent-ready` / `2026.1` | Integer percent and eleven ordered criteria, selected listing, observation time | Approved listing projection; source failure or missing permission has no numeric value |
| Website readiness | Fresh merchant-linked snapshot of the existing scanner's version 2 result with eighteen closed check codes | Percent and fixed findings, approved association, observation time | Merchant website history; failed observations are unavailable, never score zero |
| Recorded traffic | Count of `agent_visits` records, detected AI-agent subset, and a partition by ingestion trust | Recorded visits, selected listing, completed month or explicitly partial collection interval | Traffic aggregate; no raw visits, user agents, queries, referrers or client payloads |
| Live order counts | Durable `checkout_orders` with `stripe_livemode = true` and supported payment status | Orders created during the month, whole owner account, status known at observation time | Order-count aggregate; no rows, identifiers, offers, buyer data or monetary fields |

The traffic count measures records, not unique visitors or verified agent
identities. Its `verifiedServerVisits`, `unverifiedClientVisits` and
`legacyUnverifiedVisits` must sum to `totalVisits`; detected AI visits must be a
subset. Server-verified ingestion describes the recording path only. It does not
establish a buyer identity, a conversion, or sales attribution.

Supported payment statuses are `paid`, `refunded`, `disputed`, and `dispute_won`,
matching the current checkout-order schema. They sum to `eligibleLiveOrders`.
Separate bounded counts identify excluded test mode, unknown live mode and
unsupported statuses. These categories describe the same owner/month cohort and
must be mutually exclusive in the future producer: classify live mode first,
then classify supported status only for proven live orders. Payment state does
not represent fulfillment.

The candidate report has two intentionally different scopes. Listing readiness
and traffic concern the selected listing. Order counts concern the merchant's
whole account, and the interface labels this explicitly. The future consent
contract must allow that exact account scope. Do not forward owner-account totals
under a narrower page grant. If pilot scope changes, revise this contract before
introducing source queries.

## Missingness and coverage

An available zero is a measured value. The other states have no value, source
payload or raw error attached:

| State | Meaning |
|---|---|
| `no_permission` | The current report cannot access this source |
| `no_coverage` | The source does not support this metric |
| `suppressed` | Disclosure policy withholds the result |
| `not_collected` | A collection baseline does not yet exist |
| `calculation_failed` | The attempted result could not be calculated |

Counts carry either complete or partial collection coverage with explicit bounds.
Complete coverage must span the exact report month. Partial coverage is labelled
beside the count and in the source table. A future producer must establish coverage
from collection/instrumentation evidence, not infer it from the first row or turn
an empty query into a claim that collection was complete. Empty traffic does not
produce a misleading 100-percent trust statistic.

Listing and website scores remain separate. A current listing score is not a
historical series; one website snapshot is a baseline, not a trend. Future website
comparisons must require compatible rubric versions. The displayed website score
is rounded to at most one decimal, while the underlying result remains unchanged.

## Projection and authorization boundary

The minimal listing helper returns only name, description, publication state and
the canonical criterion flags/score. It never spreads the page row into a response.
Offer arrays, negotiation rules, unrestricted draft content, private notes,
integration settings and verification evidence are omitted. Unknown fields in
the report and its nested projections cause validation failure.

Schema validation is not authorization. The `merchant_sources` data-basis label,
scope UUIDs, source digest, association method and `merchant_website_snapshot`
provenance are assertions that a future trusted producer must establish. A caller
cannot gain authority by supplying any of them. The component cannot verify a
database relationship, ownership or a cryptographic provenance claim.

Before any production entry point mounts this component, the implementation must:

1. Derive the authenticated viewer and current merchant/organization context.
   Enforce the current immutable consent revision, resource scope, history and
   capabilities through the Stage 3 authorizer, including narrowing and revocation.
2. Build new bounded aggregate queries from that authorized context. Do not pass
   through `OwnerAnalyticsRollup`, whose shape includes monetary summaries,
   top queries, referrers, offers and broader owner data. Do not fetch all rows
   and aggregate a silently truncated client result.
3. Check the current merchant/page and approved website association before
   creating a new immutable merchant baseline. Prospect scans cannot be relabelled
   as merchant history. Different association methods retain different labels.
4. Produce source digests and observation/coverage metadata on the server under
   documented snapshot semantics. Source versions track the report input; they
   never replace current authority on a later read.
5. Return private, no-store output through a bounded, authorized endpoint. Keep
   raw records and error text out of responses, telemetry, example artifacts and
   organization caches. Test ownership transfer and revoked access explicitly.

None of those data access paths is implemented or proven by this presentation
slice. The renderer performs no fetch, write, download, scan or consent mutation.

## Financial and attribution exclusions

The contract accepts only a disabled financial summary and unavailable attribution.
An attempt to attach financial amounts, order IDs or buyer information fails
validation even when the payload also claims that disclosure is disabled.

Do not reuse the existing finance helper's `refundedCents` as actual refunds: it
also reduces remaining value for open disputes. A future monetary contract needs
proven live-mode orders, authoritative currency/minor units, actual refund coverage,
an explicit cohort/as-of definition, and the approved disclosure/release policy.
Unknown currency cannot become USD, currencies cannot be summed, and a JPY amount
cannot automatically be divided by 100. Monetary output remains disabled until
those decisions and the separate merchant permission exist.

No conversion rate is inferred by dividing these traffic and order totals. They
have different resource scopes and no proven transaction linkage.

## Evidence and remaining decisions

The focused suite passes 60 cases, including all 2,048 combinations of the eleven
canonical readiness criteria. It covers strict private-field rejection, disabled
financial output, inconsistent counts, unsafe website origins, prospect provenance,
completed UTC months, partial coverage, observation times, true zero versus all
five missing states, safe HTML escaping and malformed-report refusal. A malformed
date initially escaped validation as a rendering exception; a regression case
now proves invalid and out-of-range timestamps return an unavailable report.

The final root suite passed 5,401 tests, with the existing opt-in live benchmark
skipped. TypeScript, ESLint, palette and em-dash checks passed, as did all 46
seller-mobile contract tests. Local browser verification covered the three
examples, desktop and mobile layouts, light and dark themes, and maximum counts
with a long merchant name at 320px. An initial large-count overflow was corrected;
the final run showed no viewport overflow or uncaught browser exceptions.

Production build and dead-code verification are CI gates under the repository's
documented local sandbox limitations. This slice adds no database migration or
production route; the local examples do not prove live report access, source
reconciliation or consent behavior.

The examples make review concrete, but do not satisfy the Stage 0 commercial or
source gate. The remaining decisions still need real participants:

- Taio: select the operator/merchant and a price-specific pilot offer.
- Operator: identify the report/task replaced, baseline preparation time, useful
  period, one action the report enables, and willingness to pay for this scope.
- Merchant: confirm actual source coverage, website association and the proposed
  account/listing scopes. Review consent, history, expiry and disclosure wording.
- Implementation: build and adversarially test the source producers and consent
  boundary, then reconcile a real owner-safe report before agency access.

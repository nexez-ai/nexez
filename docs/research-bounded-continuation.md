# Research continuation preparation

This is infrastructure preparation, not activation or publication approval.
The current protocol-4 run still stops at 5,000 results, 15,000 attempts or
3,000 dispatches. Its USD 0.005 rate and USD 33.05 other-cost reserve stay
unchanged. The October 12 deadline, scanner, robots/SSRF controls and customer
headroom do not change. Every superseded pilot and smoke cohort stays excluded.

## Immutable source extension

`scripts/research-frame-extension.mjs` builds a nested 125,000-domain frame
from the original extract, mapping and selection seed. It requires the exact
75,000-row parent, checks source file hashes, and rebuilds the parent byte for
byte before adding the next 10,000 candidates per category. It preserves every
original row and scan rank. The extension contains 50,000 disjoint initial
domains and is below the unchanged 75,000-row per-wave import ceiling.

The selector's category ceiling is now explicitly 25,000. Its default remains
15,000, and selection/eligibility logic is unchanged. A new manifest records
both parent and nested hashes. Existing artifacts are never overwritten.
The generator only writes private local artifacts. It never imports, enables
scanning, buys data or makes website requests.

Example command, using private paths rather than committed data:

```sh
node scripts/research-frame-extension.mjs SOURCE.jsonl.gz MAPPING.json ORIGINAL_FRAME NEW_OUTPUT extension-cohort SOURCE.parquet YYYY-MM-DD
```

The original frame scans first, followed by the extension in original-seed
scan-rank order. A budget-truncated two-wave sample is not one random prefix of
the full nested frame. Additional observations do not fix coverage or selection
bias. This remains a new cross-section, not an August trend or a nationally
representative sample. The denominator is qualifying accessible websites,
not verified active or independently owned businesses.

## Historical cost ledger

Migration `20260923171429` backfills `dispatch_reserved_microusd` at each run's
existing rate. A trigger charges each subsequent dispatch increment at its
active rate. Neither the dispatch count nor historical ledger nor other-cost
reserve can decrease. A rate change requires a stopped run, with no simultaneous
dispatch increment. A future cheaper rate cannot retroactively discount any
past dispatch. Status and the scheduler both use this cumulative ledger.

The migration does not change any run state, rate, limit, source manifest or
cron. Schema ceilings are finite: 150,000 attempts and 25,000 dispatches per
run. Existing defaults remain 1,500 attempts and 500 dispatches. The USD 100
budget ceiling and 100,000-success schema ceiling remain. These are permitted
bounds, not approved active settings or separate budgets for each wave.

The prospective rate floor is USD 0.0027, with the default still USD 0.005.
The deployed production Resources page was checked September 23: IAD1,
Node.js 24.x, maximum duration 60 seconds. The project uses standard Fluid
resources, 1 vCPU and 2 GB. At current [Vercel list rates](https://vercel.com/docs/functions/usage-and-pricing),
60 seconds of CPU plus 120 GB-seconds of memory plus an invocation models
USD 0.0024872667. This is compute only. Separate reserves must cover database,
transfer, builds, previous pilots, billing lag and other study costs. Resource
or price changes invalidate the floor until reviewed. Neither the ledger nor
Supabase Spend Cap is a universal provider hard billing cap.

## Activation gates still required

1. Let the current 5,000-result stage stop. Audit fresh quality, category yield,
   exclusions, retries, recovered infrastructure failures and customer pressure.
   Do not resume a manually paused run without understanding its reason.
2. Recheck endpoint usage, provider billing and database usage. Carry all
   historical reservations, including the USD 0.005 dispatches since the pilot.
   Never reuse the stale 500-result cost projection.
3. Set a bounded cumulative attempt/dispatch allowance under the original
   deadline. Compute future capacity from the ledger, not dispatch count times
   the new rate. Keep a conservative separate reserve and extra headroom.
4. For any second wave, stop the first and carry its entire reserved total,
   rounded up to cents, into the second wave's other-cost reserve. Only one
   wave may run. Retain original protocol-4 results without relabelling.
5. Verify unchanged scanner/dependencies and hash-salt continuity. Before
   combined reporting, deduplicate final redirected domains across compatible
   protocol-4 waves. A disjoint initial-domain frame does not prove disjoint
   final websites. Superseded protocols cannot join this lineage.
6. Verify the imported extension against its separate manifest before freezing
   it. Never rewrite the original frozen manifest or original rows. Import
   alone must not enable scanning. Record the exact limits, stopping rule,
   review evidence, hashes and activation time in the private operations record.

The owner's 50,000 planning target is not a stopping ceiling. A permitted
bounded stage can retain more, but the report must state the actual qualifying,
deduplicated sample, including any shortfall. Final analysis and promotional
material require owner approval before publication or outreach.

## Regression coverage

Focused JavaScript tests cover deterministic selection, original row/rank
preservation, category balance, changed sources, duplicate/reseeded candidates
and import accounting. The disposable PostgreSQL harness uses a stubbed HTTP
function, never production website requests. It covers historical backfill,
rate changes, non-decreasing reserves, exact budget boundaries, bounded caps,
customer headroom, frozen protocols/frames, retry and completion fencing,
and an exact checkpoint/final completion at 50,001 and 50,002 results.

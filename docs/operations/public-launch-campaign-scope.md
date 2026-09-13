# Public Launch campaign scope

Public acquisition is opt-in through `seller_growth_campaigns.is_public_launch`.
New campaigns default to `false`, including active, open-enrollment internal or
certification campaigns. A database constraint permits public Launch designation
only when `grant_plan_id = 'launch'`.

Migration `20260913032439_isolate_public_seller_growth_campaigns.sql` designates
the existing `launch-six-month-2026` campaign using its stable business key. It
does not change campaign status, capacity, dates, invitation rows, business
claims, or previously issued promotional grants. The normal updated-at trigger
will update the designated campaign's modification timestamp.

## Consumers

- Automatic welcome/referral/cohort grant issuance checks public scope both
  before and after acquiring the existing campaign lock.
- The seller dashboard selects public campaigns whose signup window is open.
- Growth Control selects public campaigns, including paused/ended campaigns so
  operators can inspect them. It no longer defaults to a newer internal canary.
- Exact campaign lookups for an owner's existing grant remain unfiltered, so
  internal Pro grants still display correctly and retain their entitlements.
- Existing quota locks, identity checks, verified invitation matching, capacity
  limits, fixed expiry, privileges, and RLS are unchanged. Scope changes take the
  same campaign advisory lock as status/window changes.

When creating a future public Launch campaign, a trusted operator must explicitly
set `is_public_launch = true`. Do not turn this on for internal tests. Test
fixtures that exercise public acquisition also set it explicitly.

## Release order

1. Pass unit/type/lint gates and the clean Supabase migration replay.
2. Run the seller-growth gauntlet, entitlement pgTAP suite, and concurrency suite
   on an isolated database. Never reset production to run them.
3. Apply the migration to the approved production project.
4. Read back the public selection and compare internal-grant fingerprints and
   counts against the pre-migration baseline.
5. Deploy the application query filters only after the column exists.

The seller-growth gauntlet now includes the original failure (a newer exhausted
canary shadowing Launch), internal campaigns with spare capacity, preserving
existing Pro grants, non-Launch designation rejection, and browser-role denial.
It also retains its referral/cohort, eligibility, capacity and lifecycle checks.

The migration is additive. Do not delete certification campaigns or grants as a
rollback shortcut, and do not remove the scope filter to make a paused or full
public campaign issue grants. Investigate the gate that intentionally stopped
issuance. Email outreach remains a separate release decision.

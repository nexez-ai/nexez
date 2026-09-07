# High-priority platform remediation

This change addresses the five P1 findings from the September 5, 2026 audit.

| Finding | Result |
| --- | --- |
| F01: credential authority | Database triggers reject client-written credential metadata. Download and deletion paths must match the server record's owner, page, and document ID. Publication, verification, and sharing are checked before signing. |
| F02: repeated or concurrent refunds | Web and mobile persist one UUID per confirmation. Postgres reserves that immutable request, serializes competing operations, and records the provider identity before reconciliation. Lost responses reuse the same operation. |
| F03: interrupted webhooks | Verified events use a durable inbox with a five-minute lease. Only completed business processing is deduplicated. Expired claims are reclaimable, and stale workers cannot acknowledge a replacement lease. Persistence and provider lookup failures remain retryable. |
| F04: reordered reversals | Row-locked RPCs merge current metadata, preserve cumulative refund totals, and update linked staged obligations atomically. Current Stripe disputes determine outcomes. Current individual refunds must have settled before their totals are applied. Stale checkout writes cannot reopen refunded payments or erase dispute outcomes. |
| F05: broken checkout returns | Both session lookup helpers use only encrypted tokens and preserve buyer scoping. Database errors are surfaced separately from a checkout awaiting its first order record. |

## Adversarial verification

The local test run used synthetic identities and mocked Stripe responses. It sent no real payments, refunds, emails, or customer messages.

- Full web suite on current main: 625 test files passed, 5,034 tests passed, one test skipped.
- Mobile suite: 19 test files and 158 tests passed. Web and mobile TypeScript checks passed.
- ESLint, palette guard, em dash guard, and diff whitespace checks passed.
- All three migrations replayed successfully into a fresh isolated PostgreSQL 17 database containing the relevant schema. The SQL gauntlet exercises authenticated-role attacks, refund reservation/replay, terminal and disputed state, and lease fencing.
- Five separate-connection attacks passed: different refund amounts, identical concurrent retries, sequential partial refunds, an older webhook blocked behind a newer commit, and competing webhook leases.
- Additional route and provider tests cover foreign credential signing/deletion, lost responses, database failure after provider success, provider timeout, expired keys, pending/failed refunds, refund pagination, delayed duplicate browser responses, and checkout lookup failures.

The local database uses a focused schema fixture, not the complete historical Supabase schema. The existing checkout privacy CI test includes `high_priority_security.sql`, so the Supabase clean-replay job exercises it after every migration. The full build and `lint:dead` remain CI gates because this workspace's sandbox cannot fetch Google Fonts and knip has a known sandbox memory failure. Live provider settlement is not covered by mocked tests.

To rerun the concurrency attacks against an isolated local database:

```sh
NEXEZ_TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres' python3 scripts/test-payment-concurrency.py
```

The script refuses a nonlocal hostname, uses unique fixtures, and cleans up only its own records. Use `PSQL` to select a specific local PostgreSQL binary.

## Rollout

1. Require passing PR checks, including the complete Supabase migration replay, schema lint, application build, and browser suite.
2. Verify the linked Supabase project and run `supabase db push --linked --skip-vault --dry-run`. It must list only the three migrations in this change.
3. Apply those migrations before merging the application. They add server-only operations and tighten existing authority. They do not replay historical webhooks automatically.
4. Verify the new functions, table RLS, client revocations, and migration history in the target database, then merge and verify the production deployment revision.
5. Release the mobile client update. Older clients without an operation ID fail closed on refunds and must update; browser clients must reload the deployed application.
6. Ensure both platform and Connect Stripe endpoints deliver `charge.refunded` and the `refund.created`, `refund.updated`, and `refund.failed` lifecycle events. Refund updates allow a pending refund to be reconsidered when it settles. Launch Control verifies both endpoint roles, enabled state, and event coverage through Stripe's endpoint API. It reports only safe counts and missing event names. No endpoint settings are changed by this code.

## Recovery and limits

An unresolved refund with no recorded provider ID is not resubmitted after 23 hours, before Stripe's guaranteed 24-hour idempotency window expires. Reconcile that operation against its pinned Connect account, payment intent, amount, and `nexez_refund_operation` provider metadata. Record the proven provider refund ID before retrying. Never clear a reservation or mint a replacement operation merely because a response was lost.

Pending refunds remain retryable and are not counted as settled. Failed refunds, including a bank returning a previously submitted refund, require operator reconciliation. They do not automatically authorize another payment or decrease historical refund totals. Review the provider outcome before approving a new refund or a separate accounting correction. Do not edit cumulative amounts blindly to make a retry pass.

Stripe retry retention is finite. Uncompleted inbox rows remain available after retries expire and require verified event redelivery after the underlying failure is resolved. Inspect `stripe_webhook_events` rows whose state is not `completed` and `refund_operations` rows in `reserved`, `submitted`, or `failed`. Completed webhook payloads are cleared to reduce retained buyer data.

The lease protects business persistence and acknowledgement. Existing deferred email, push, calendar, and outbound notifications still have their previous best-effort delivery contract. A durable notification outbox and an automated operator recovery queue remain follow-up work. Medium- and low-priority audit findings are outside this change.

Provider references: [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests), [refund lifecycle and failed refunds](https://docs.stripe.com/refunds), and [webhook ordering](https://docs.stripe.com/webhooks#event-ordering).

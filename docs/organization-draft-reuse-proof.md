# Merchant draft reuse investigation

This Stage 0 investigation covers the existing merchant editor handoff required
by v4 sections 11.3 and 15.1. It establishes useful prerequisites for a later
merchant-reviewed proposal. It does not implement organization proposal authority,
consent, acceptance, application receipts, or an apply-to-draft endpoint.

## Result and prerequisite fixes

The existing seven-field draft model can preserve a partial change if omitted
fields retain their live values. The old publication helper instead supplied
empty arrays, nulls, and a false website preference for omitted fields. Publishing
a description-only draft could therefore erase unrelated merchant content.

The editor also loaded live content over an existing staged draft when reopened.
All three editor writes checked only database errors, so a stale tab could replace
newer work and a zero-row write could report success.

This slice changes the existing merchant path:

- Publish only explicitly staged fields. Preserve omitted fields and distinguish
  omission from an explicit null, empty array, or false value.
- Initialize the editor from supported staged fields over the current live page.
  Keep the actual server row separately as the write baseline.
- Reject unsupported top-level draft fields and malformed field shapes when
  saving or publishing a draft. Keep the saved draft intact for recovery.
- Filter live save, draft save, and draft publication by the loaded page ID,
  owner ID, and server `updated_at`. Existing Supabase RLS still authorizes the
  caller. The owner filter is a stale-ownership guard, not an authorization grant.
- Require a returned row and retain its server version after success. A zero-row
  response reports conflict or lost access and preserves the local edits.
- Serialize pending writes in the editor and restore controls after a connection
  failure. An uncertain response directs the merchant to reload and check before
  retrying, because this browser path has no durable application receipt.
- Keep draft publication separate from `is_published`. Applying content to a
  private listing does not make it public, and its success message says so.
- Correct the pending-team-approval message: Save changes writes live content,
  while Save as draft stages it. Existing approval history is not a publication
  authorization gate and must not be presented as one.

The pure helpers remain in `lib/draft.ts`; editor writes remain in
`components/editor/usePageEditor.ts`. No database migration or organization grant
is added. Ordinary Save changes still writes the displayed form to live columns;
Save as draft stages it, and Publish draft applies the saved staged content.

## Concurrency boundary and writer inventory

`20260603200000_add_pages_updated_at.sql` supplies a before-update trigger that
sets `pages.updated_at = now()`. Its transaction timestamp is not a proven
monotonic content version. This slice uses it as a conservative browser conflict
guard and does not replace it or claim the future server command is safe.

Any earlier row update can make an open editor stale, including unrelated
integration or settings metadata. The merchant must reload rather than having
the client silently rebase its edits. A later writer without its own version
check can still overwrite content saved by this editor.

The reviewed entry points below must participate in the Stage 4 concurrency
test inventory. This is a starting inventory, not a claim that every platform
writer has been converted or tested.

| Entry point | Current behavior and remaining implication |
|---|---|
| `components/editor/usePageEditor.ts` | Live save, draft save, and draft publish now check the loaded owner/version and consume the returned row. Version restore changes local form state and uses the guarded save. |
| `app/[slug]/page.tsx` | Existing authorized draft preview overlays supported fields; it does not mutate content. Include preview access and stale reviewed content in proposal tests. |
| `lib/agents/intake.ts`, re-interview commit | Replaces the page draft using owner-filtered RLS, without comparing the prior draft/version or requiring a returned row. Closing the intake session is a separate write. Preserving an existing draft, retries, and atomic handoff remain open work. |
| `apps/seller-mobile/src/lib/data.ts` | Mobile live updates return a row but lack an expected version. Publication toggles check only errors. Mobile has not received this browser guard. |
| `app/api/v1/pages/[id]/route.ts` | API-key writes use an explicit owner filter with the admin client and handle a missing returned row. They do not compare an expected content version. |
| `app/api/pages/[id]/team-approvals/route.ts` | Approval history already uses `updated_at` comparison. This metadata changes the page version; the editor's local approval response does not refresh that version, so a subsequent content write can require reload. |
| `app/dashboard/DashboardClient.tsx`, `components/PagesManager.tsx` | Single and bulk publication toggles are separate writers. A listing visibility change invalidates the editor's loaded row version. |
| Availability cron routes and `app/api/pages/[id]/calendly/sync/route.ts` | Can replace offer arrays or availability after provider reads. Their page writes do not share this editor's expected version. |
| `20260822224942_serialize_shopify_install_mapping.sql` | Shopify catalog application already locks its install and page, checks owner/mapping generation and expected page timestamp, then updates offers. Preserve its lock order when designing new commands. |
| Settings, credential verification, integration callbacks, reindexing, and database maintenance | Also mutate the page row. Classify them by content impact before selecting a monotonic version migration or digest scope. |

Before implementing a shared version protocol, repeat the repository search for
all page writes and triggers. Pay particular attention to privileged writers,
collaborator access, ownership transfer, and operations with multiple SQL calls.

## Initial description and FAQ contract

The following is a proposed version 1 contract for the later proposal command.
These engineering limits are not deployed validation or agreed pilot terms.
Confirm them with the representative report and merchant review before enabling
proposal creation.

| Field | Proposed semantics and bound |
|---|---|
| `description` | Optional plain text, 1 to 4,000 Unicode code points when supplied. Omission preserves the existing draft value. Initial proposals cannot clear it implicitly. |
| `faqs` | Optional complete replacement array of 0 to 20 items. An empty array explicitly clears FAQs; omission preserves them. The review must show all removals and additions. |
| FAQ item | Exactly `question` and `answer`, both nonempty plain text. At most 200 and 2,000 Unicode code points respectively. No extra keys or nested values. |
| Entire request | At most 64 KiB of UTF-8 JSON before parsing. At least one of the two fields is required. Reject unknown fields and unsupported schema versions. |

Normalize line endings once on the server before computing the canonical digest;
store and render the exact canonical values the merchant accepts. Do not accept
HTML, arbitrary patch paths, publication flags, offer/pricing/availability fields,
integration settings, CTA destinations, or private staged fields in this contract.
The agency receives only its authorized proposal projection. It must not receive
the merchant's complete draft through a comparison response or error message.

The existing draft validator intentionally has broader compatibility rules for
merchant-owned legacy content, including preserved nested offer configuration.
It is not the strict server validator for untrusted organization proposals.

## Required future application transaction

After Stages 2 and 3 establish the connected report and consent boundary, Stage 4
must implement and prove all of the following before offering Apply to draft:

1. Authenticate the current merchant and directly verify current page ownership.
   Organization membership or a proposal capability never confers this authority.
2. Lock the page and immutable proposal revision in a documented order consistent
   with other command roots. Check binding, accepted revision, expiry, schema,
   and a server-derived request digest with its idempotency key.
3. Compare server-produced live and staged content digests, or a separately proven
   monotonic version protocol, against the content the merchant reviewed. A
   client timestamp alone is insufficient; conflict requires refreshed review.
4. Build complete supported content from live fields, overlay the existing staged
   draft, then merge only the accepted description/FAQ fields. Preserve name,
   services, products, industry, website preference, and unrelated staged content.
   An unsupported legacy draft causes a recoverable conflict.
5. Update only the draft and expected metadata, insert the immutable application
   receipt and required audit event, and commit atomically. A failed receipt or
   audit insert must roll back the draft write. Exact retries return the receipt;
   changed input must not silently apply a different revision.
6. Verify the subsequent merchant preview/save/publication handoff and bind public
   verification to the actual approved values or resulting content digest.

Do not call `draftToLiveUpdate` from the proposal application command. Its sparse
mapping now preserves existing live fields, but application must create a complete
merchant draft and must never write live descriptive fields itself.

## Verification evidence

- The initial regression run failed 17 assertions before the fixes, reproducing
  destructive defaults, live-over-draft hydration, unsupported shapes, and missing
  stale-write handling. The final focused draft/editor suite passed 37 tests.
- The full local root suite passed 5,341 tests across 644 files. One existing
  opt-in live importer benchmark remained skipped. TypeScript passed; changed-file
  ESLint reported zero errors and one existing navigation warning.
- All 46 seller-mobile platform contract tests passed. No mobile API, entitlement,
  integration, notification, or reserved-name contract changes are introduced.
- Two real Chromium E2E tests passed against the local application and ordinary
  Supabase permissions using the dedicated test seller. A partial draft opened
  with staged text and published without resetting other fields. A second tab
  could not publish an older draft after a new save, and the current tab could
  publish using its returned version. Database read-back verified the results.
- Both E2E fixtures remained private and were deleted by their exact IDs in test
  cleanup. CI-mode retention disabled browser traces and failure screenshots.
- A separate local browser check rendered the login controls without a framework
  error overlay or recorded page errors. It does not substitute for the editor
  E2E assertions above.

Production build and dead-code checks belong in CI under the repository's
documented local environment limits. A deployed proposal transaction, real
collaborator revocation, simultaneous API/mobile writes, production merchant
publication, and pilot usefulness are not verified by this slice.

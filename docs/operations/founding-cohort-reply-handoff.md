# Founding-cohort reply and invitation handoff

This is an operator runbook, not approval to enroll or email prospects. Keep the
Apollo prospect sequence inactive until its suppression, recipient, mailbox and
final-send gates are independently cleared.

## The offer

Eligible businesses receive **180 days of Nexez Launch** at no subscription
cost. No card is required for this promotion. The clock starts when qualification
completes, not when a prospect receives an email, replies, claims an invitation or
publishes an unverified listing.

Qualification requires a confirmed account email, a live listing, a
server-verified business identity and the campaign's eligibility checks. Those
checks also include campaign availability and capacity, duplicate-business
protection and the absence of an already paid or qualifying trial plan. The
server remains the authority. An invitation is not a guarantee of a grant.

After the promotion, the account returns to Free unless the merchant chooses a
paid plan. The promotion does not create a paid renewal. The Free fallback keeps
the selected eligible listing, or the oldest published listing, within the
account's Free allowance; excess listings become drafts rather than being
deleted. A separately chosen paid plan must not be overwritten by expiry.

Use the actual `ends_at` supplied by the activated grant. Never calculate an end
date by adding six calendar months to an email or signup date.

## Reply triage

| Reply | Operator action |
| --- | --- |
| Interested | Confirm the business and the intended account email; check existing account, invitation and suppression records before generating a link. |
| Existing Nexez account | Use its exact account email. Check current plan and campaign eligibility; do not promise a second grant or ask them to create a duplicate account. |
| Wrong person or referred colleague | Hold the original contact. Independently review the colleague's role, business and address before a separate invitation or outreach approval. |
| Unsubscribe or do not contact | Stop outreach and record the opt-out in the campaign hold register and the sending platform's suppression controls. Verify the saved state; never resubscribe or send another email to test it. |
| Bounce, auto-reply or unclear response | Hold. Do not treat it as interest, consent, a verified address or successful qualification. |

While Apollo's internal unsubscribe discrepancy remains open, keep all prospect
sending paused. Reply-based opt-out text is an additional human-handled path,
not proof that Apollo's recipient-link suppression works.

## Generate the invitation without sending a wave

1. After the specific merchant handoff is approved, inspect Growth Control at
   `/admin/growth`. Resolve the actual public Launch campaign and check its
   current status, enrollment window and capacity. Do not substitute a newer
   internal certification campaign or change settings to force eligibility.
2. Check for an existing cohort member or invitation for the exact recipient.
   Avoid creating duplicates. Do not rotate or revoke an existing link just to
   inspect it.
3. The existing authenticated admin endpoint supports
   `PATCH /api/admin/growth-campaign` with `action: "cohort_add"`, the resolved
   `campaignId`, exact `email`, optional business `label`, an operational
   `reason`, and a fresh UUID `idempotencyKey`. It requires a signed-in platform
   admin and a same-origin request. Reuse that key only when retrying the same
   uncertain operation.
4. Read back `ok`, the matching `member`, `claimUrl`, and `emailed: false`.
   The returned recipient-bound link is the only link to put into the reply.
   Do not construct a token, reuse a sample URL or include another merchant's
   invitation. Treat the link as a credential and keep it out of public logs.
5. Prepare the reply below and check recipient, sender, business, link and terms.
   Send only under the applicable explicit send approval. Record the sent
   message ID and the cohort member ID without copying the token into the
   general campaign tracker.

The current roster UI exposes CSV staging and wave release, not a single-link
copy control. Do not click **Release wave** to obtain a manual reply link. That
action invokes real email delivery and may select up to 25 recipients. Likewise,
`cohort_resend` rotates an invitation token; it is not a read-only lookup.

No production invitation, grant, cohort member or message is created by this
runbook. If approved admin tooling cannot perform the single-link operation,
stop for that handoff instead of substituting a bulk release or a fake link.

## Reply drafts

Replace every bracketed field before sending. These are reference drafts, not
live messages, and no reply is queued by this document.

### Interested, account email not confirmed

> Hi [first name],
>
> Glad you're interested. Which work email do you want to use for [business]'s
> Nexez account? If you already have an account, please use that same email.
>
> The founding offer is 180 days of Launch at no subscription cost, subject to
> eligibility and availability. It starts once your email and business identity
> are verified, a listing is live, and the qualification checks pass. No card is
> required for the promotion, and it does not renew into a paid subscription.
>
> Tai

### Approved, recipient-bound invitation ready

> Hi [first name],
>
> Here is [business]'s invitation: [actual recipient-bound invitation URL]
>
> Open it and sign in or create your account with [exact invitee email]. Then
> finish your business verification and publish your first listing. Your
> dashboard will confirm when qualification is complete and show the actual
> end date of your 180 days of Launch.
>
> No card is required for this promotion. Afterward, your account returns to
> Free unless you choose a paid plan. The promotion does not renew into a paid
> subscription. Eligibility and availability still apply.
>
> Reply here if anything is unclear and I'll help you through it.
>
> Tai

Append the existing sender identity, business postal address and the appropriate
working opt-out method for the delivery channel. Do not duplicate Apollo's
configured signature or invent its recipient-specific unsubscribe URL.

## Claim-to-activation checks

The secure invitation route places its hash in an HTTP-only cookie, then opens
the claim page. A signed-out recipient is directed through signup or login while
retaining the claim path. A wrong-email session must not claim the invitation.
An invalid or expired invitation must not expose a working claim action.

An accepted invitation can remain **claimed but not activated** until the
remaining qualification gates pass. Confirm the dashboard's grant state rather
than inferring activation from a click or reply. Never backdate the grant or
modify production qualification fields to make a QA test pass.

## Verification boundary

The automated coverage includes claim-page states, non-sending cohort creation,
HTML/plain-text terms, and guarded cron expiry for both Free and separately paid
accounts. The isolated database gauntlet checks publication without
verification, business verification without email confirmation, exact 180-day
issuance at qualification, duplicate/capacity rules and Free fallback behavior.

Mocked route tests and transactional database tests are not a live merchant
journey or an external billing-provider certification. Production activation,
native email rendering and the real suppression path require their own evidence
and appropriate authorization.

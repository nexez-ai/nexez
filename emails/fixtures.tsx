import type { ReactElement } from 'react'
import {
  BookingEmail,
  BuyerReceiptEmail,
  BuyerRequestEmail,
  BuyerStatusEmail,
  EscrowFundedEmail,
  LaunchAccessStartedEmail,
  MoneyEventEmail,
  NegotiationEmail,
  OrderLookupEmail,
  PromotionExpiryEmail,
  PublishNudgeEmail,
  ScanResultsEmail,
  FoundingCohortEmail,
  SellerGrowthInviteEmail,
  StaleListingEmail,
  SupportReplyEmail,
  SupportRequesterReplyEmail,
  SupportTicketEmail,
  StripeConnectedEmail,
  TeamInviteEmail,
  WelcomeEmail,
} from './templates'

export type EmailPreviewFixture = {
  id: string
  element: ReactElement
  expectedCta: string
  /**
   * The badge text, or null for a template whose object has no state to report.
   * Null is a policy assertion, not a gap: the render test proves those emails
   * ship with no badge element at all, so a badge cannot creep back in as
   * decoration. See the content model at the top of templates.tsx.
   */
  expectedState: string | null
  /** Distinctive copy to pin. Required wherever expectedState is null. */
  expectedCopy?: string
}

const APP = 'https://app.nexez.ai'
const SITE = 'https://nexez.app'
const merchantRows: Array<[string, string]> = [
  ['Offer', 'Emergency plumbing visit'],
  ['Amount', '$149.00'],
  ['Buyer', 'buyer@example.com'],
]
const buyerRows: Array<[string, string]> = [
  ['Seller', 'Axle Plumbing Co.'],
  ['Item', 'Emergency plumbing visit'],
  ['Amount', '$149.00'],
]

export const emailPreviewFixtures: EmailPreviewFixture[] = [
  {
    id: 'support-new-ticket',
    element: <SupportTicketEmail requesterEmail="owner@example.com" subject="Checkout incident" rows={[
      ['Ticket', 'ticket_123'],
      ['Priority', 'urgent'],
      ['Message', 'Checkout is returning an unexpected error.'],
    ]} adminUrl="https://admin.nexez.ai/admin/support/ticket_123" />,
    expectedCta: 'https://admin.nexez.ai/admin/support/ticket_123',
    expectedState: 'Response needed',
  },
  {
    id: 'support-operator-reply',
    element: <SupportReplyEmail subject="Checkout incident" replyBody="We found the issue and are checking the payment path now." requestUrl={`${APP}/support/requests/ticket_123`} />,
    expectedCta: `${APP}/support/requests/ticket_123`,
    expectedState: null,
    expectedCopy: 'We found the issue and are checking the payment path now.',
  },
  {
    id: 'support-requester-reply',
    element: <SupportRequesterReplyEmail requesterEmail="owner@example.com" subject="Checkout incident" replyBody="The issue still happens after I sign in again." adminUrl="https://admin.nexez.ai/admin/support/ticket_123" />,
    expectedCta: 'https://admin.nexez.ai/admin/support/ticket_123',
    expectedState: 'Awaiting you',
  },
  {
    id: 'merchant-booking',
    element: <BookingEmail businessName="Axle Plumbing Co." rows={[...merchantRows, ['When', 'August 24 at 9:00 AM']]} inboxUrl={`${APP}/dashboard/integrations`} />,
    expectedCta: `${APP}/dashboard/integrations`,
    expectedState: 'Confirmed',
  },
  {
    id: 'merchant-negotiation',
    element: <NegotiationEmail businessName="Axle Plumbing Co." rows={[...merchantRows, ['Message', 'Can you arrive before noon?']]} inboxUrl={`${APP}/dashboard/negotiations`} />,
    expectedCta: `${APP}/dashboard/negotiations`,
    expectedState: 'Response needed',
  },
  {
    id: 'merchant-escrow-held',
    element: <EscrowFundedEmail lead="A buyer funded an escrow hold." held rows={merchantRows} inboxUrl={`${APP}/dashboard/negotiations`} />,
    expectedCta: `${APP}/dashboard/negotiations`,
    expectedState: 'Waiting for completion',
  },
  {
    id: 'merchant-payment-received',
    element: <EscrowFundedEmail lead="A buyer completed payment." held={false} rows={merchantRows} inboxUrl={`${APP}/dashboard/orders/order_123`} />,
    expectedCta: `${APP}/dashboard/orders/order_123`,
    expectedState: 'Paid',
  },
  {
    id: 'merchant-refund-recorded',
    element: <MoneyEventEmail heading="Refund processed" statusLabel="Refund recorded" tone="neutral" lead="A refund was recorded for this order." rows={merchantRows} inboxUrl={`${APP}/dashboard/orders/order_123`} cta="Review payment" />,
    expectedCta: `${APP}/dashboard/orders/order_123`,
    expectedState: 'Refund recorded',
  },
  {
    id: 'merchant-dispute-opened',
    element: <MoneyEventEmail heading="A payment is disputed" statusLabel="Action required" tone="danger" lead="A buyer disputed this payment." rows={merchantRows} inboxUrl={`${APP}/dashboard/orders/order_123`} cta="Review dispute" />,
    expectedCta: `${APP}/dashboard/orders/order_123`,
    expectedState: 'Action required',
  },
  {
    id: 'merchant-dispute-closed',
    element: <MoneyEventEmail heading="Dispute resolved" statusLabel="Dispute closed" tone="positive" lead="The dispute is closed." rows={merchantRows} inboxUrl={`${APP}/dashboard/orders/order_123`} cta="Review outcome" />,
    expectedCta: `${APP}/dashboard/orders/order_123`,
    expectedState: 'Dispute closed',
  },
  {
    id: 'buyer-receipt',
    element: <BuyerReceiptEmail lead="Payment is confirmed for your order." rows={buyerRows} manageUrl={`${SITE}/orders/token_123`} />,
    expectedCta: `${SITE}/orders/token_123`,
    expectedState: 'Paid',
  },
  ...([
    ['buyer-refunded', 'Refund processed', 'positive', 'Your full refund was processed.', 'View your order'],
    ['buyer-partial-refund', 'Partial refund', 'positive', 'A partial refund was processed.', 'View your order'],
    ['buyer-dispute-update', 'Dispute update', 'caution', 'There is an update on your dispute.', 'View your order'],
    ['buyer-request-received', 'Sent to seller', 'neutral', 'Your request was sent to the seller.', 'Track your request'],
  ] as const).map(([id, statusLabel, tone, lead, cta]) => ({
    id,
    element: <BuyerStatusEmail heading="Order update" statusLabel={statusLabel} tone={tone} lead={lead} cta={cta} rows={buyerRows} manageUrl={`${SITE}/orders/token_123`} />,
    expectedCta: `${SITE}/orders/token_123`,
    expectedState: statusLabel,
  })),
  ...([
    ['merchant-refund-request', 'A buyer requested a refund', 'Refund requested'],
    ['merchant-problem-report', 'A buyer reported a problem', 'Problem reported'],
  ] as const).map(([id, heading, request]) => ({
    id,
    element: <BuyerRequestEmail heading={heading} statusLabel="Review required" tone="caution" lead={`${request} for this order.`} rows={merchantRows} inboxUrl={`${APP}/dashboard/orders/order_123`} />,
    expectedCta: `${APP}/dashboard/orders/order_123`,
    expectedState: 'Review required',
  })),
  {
    id: 'buyer-order-lookup',
    element: <OrderLookupEmail lead="One order is linked to this email." count={1} findUrl={`${SITE}/orders/find/token_123`} />,
    expectedCta: `${SITE}/orders/find/token_123`,
    expectedState: null,
    expectedCopy: 'Your order is ready to view',
  },
  {
    id: 'account-team-invite',
    element: <TeamInviteEmail lead="owner@example.com invited you to collaborate." inviteeEmail="teammate@example.com" acceptUrl={`${APP}/login?next=/dashboard`} />,
    expectedCta: `${APP}/login?next=/dashboard`,
    expectedState: null,
    expectedCopy: 'Your workspace invitation is ready',
  },
  {
    id: 'account-growth-invite',
    element: <SellerGrowthInviteEmail inviterBusinessName="Axle Plumbing Co." inviteeEmail="new-owner@example.com" durationLabel="180 days" claimUrl={`${APP}/invite/claim/token_123`} />,
    expectedCta: `${APP}/invite/claim/token_123`,
    expectedState: null,
    expectedCopy: 'Your Nexez Launch invitation is ready',
  },
  {
    id: 'account-promotion-expiry',
    element: <PromotionExpiryEmail businessName="Axle Plumbing Co." daysBefore={7} endsOn="August 30, 2026" fallbackListingName="Emergency Plumbing" billingUrl={`${APP}/dashboard/billing`} />,
    expectedCta: `${APP}/dashboard/billing`,
    expectedState: 'Changes in 7 days',
  },
  {
    id: 'account-welcome',
    element: <WelcomeEmail name="Taio Okonkwo" createUrl={`${APP}/create`} financeUrl={`${APP}/dashboard/finance`} docsUrl={`${APP}/docs`} />,
    expectedCta: `${APP}/create`,
    // Passes a full name on purpose: the greeting assertions below are what
    // stop a full_name reaching the reader again.
    expectedState: null,
    expectedCopy: 'Three steps to your first listing',
  },
  {
    id: 'account-stripe-connected',
    element: <StripeConnectedEmail financeUrl={`${APP}/dashboard/finance`} listingsUrl={`${APP}/dashboard/listings`} docsUrl={`${APP}/docs`} />,
    expectedCta: `${APP}/dashboard/finance`,
    expectedState: 'Ready for payments',
  },
  {
    id: 'campaign-founding-cohort',
    element: <FoundingCohortEmail
      businessName="Aqua Clear Pool Care"
      city="Austin"
      observation={'You already state the rule: "We do not service stock tank and above ground pools." That is exactly the kind of bad fit an agent could screen out before it ever reaches you.'}
      spotsRemaining={50}
      claimUrl={`${SITE}/texas/claim/token_123`}
      unsubscribeUrl={`${SITE}/u/token_123`}
      senderName="Tai"
      senderTitle="Founder"
    />,
    expectedCta: `${SITE}/texas/claim/token_123`,
    expectedState: '50 founding spots left',
  },
  {
    id: 'merchant-stale-listing',
    element: <StaleListingEmail businessName="Axle Plumbing Co." listingName="Emergency Plumbing" freshnessLabel="Last reviewed 90 days ago" reinterviewUrl={`${APP}/dashboard/listings/listing_123/reinterview`} editUrl={`${APP}/dashboard/listings/listing_123/edit`} />,
    expectedCta: `${APP}/dashboard/listings/listing_123/reinterview`,
    expectedState: null,
    expectedCopy: 'Bring this listing up to date',
  },
  {
    id: 'account-launch-access-started',
    element: <LaunchAccessStartedEmail
      businessName="Axle Plumbing Co."
      listingName="Emergency Plumbing"
      durationLabel="180 days"
      endsOn="24 February 2027"
      dashboardUrl={`${APP}/dashboard`}
    />,
    expectedCta: `${APP}/dashboard`,
    expectedState: 'Launch active',
  },
  {
    id: 'account-publish-nudge',
    element: <PublishNudgeEmail
      businessName="Axle Plumbing Co."
      durationLabel="180 days"
      reservedUntil="9 September 2026"
      publishUrl={`${APP}/dashboard/listings/listing_123/edit`}
    />,
    expectedCta: `${APP}/dashboard/listings/listing_123/edit`,
    expectedState: 'Not started yet',
  },
  {
    // Low score on purpose: this is the only fixture that renders the danger
    // badge outside the dispute path, so it guards that override too.
    id: 'campaign-scan-results',
    element: <ScanResultsEmail
      domain="axleplumbing.com"
      score={34}
      // The outcome words are the scanner's closed vocabulary (STATUS_WORD in
      // lib/scan-findings), not free text. The last row carries no verdict on
      // purpose: that is a row persisted before the status was, and it must
      // still render.
      findings={[
        ['Prices', 'Missing', 'fail'],
        ['Agent policy', 'Missing', 'fail'],
        ['Booking path', 'Partial', 'warn'],
        ['Service area', 'Partial', 'warn'],
        ['Business identity', 'Found', 'pass'],
        ['Contact details', 'Found'],
      ]}
      claimUrl={`${SITE}/texas/claim/scan_123`}
      unsubscribeUrl={`${SITE}/u/scan_123`}
    />,
    expectedCta: `${SITE}/texas/claim/scan_123`,
    expectedState: 'Hard to understand',
  },
]

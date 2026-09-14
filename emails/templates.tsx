import * as React from 'react'
import { Link, Text } from '@react-email/components'
import {
  BrandedEmail, Caption, Data, EmailEyebrow, EmailHeading, Findings, FinePrint,
  InfoRows, Lead, NextSteps, Notice, PrimaryButton, Quote, StatusBadge, Steps,
} from './BrandedEmail'
import { BRAND, styles, type EmailTone } from './theme'
import {
  GROWTH_ACCESS_STARTS, GROWTH_EXPIRY_TERMS, GROWTH_NO_CARD_TERMS,
  GROWTH_QUALIFICATION_TERMS, PUBLIC_LAUNCH_DURATION,
} from '../lib/growth-offer-copy'

type Rows = Array<[string, string | null | undefined]>

/*
 * Content model. Every template fills four slots and they never overlap:
 *
 *   Eyebrow  the object, from a closed vocabulary: Order, Order lookup, Booking,
 *            Negotiation, Payment, Payments, Receipt, Buyer request, Listing,
 *            Account, Workspace, Plan, Launch access, Scan, Support, and the one
 *            campaign label, Texas founding cohort.
 *
 *            Closed means new templates pick from this list or the list changes
 *            deliberately. It is what stops platform mail drifting into campaign
 *            voice: a payment receipt must never say Texas founding cohort.
 *   Badge    the state that object is now in. Omitted entirely when the object
 *            has no state to report: a badge that restates the heading, names a
 *            property of the link rather than of the thing, or repeats the CTA
 *            is louder than anything around it and says nothing.
 *   Heading  what happened, in the reader's terms, sentence case, plain verb.
 *   Lead     what it means for them. Never a restatement of the heading.
 *
 * The old set repeated itself across all three (eyebrow "Payment state", badge
 * "Payment received", heading "Payment received"), which is most of why the
 * layout read as cluttered rather than the layout being wrong.
 *
 * Notice is reserved for a caveat that changes what the reader should do.
 * Everything that was only protecting us has moved to FinePrint or gone.
 */

const BUYER_NOTE = 'This private link is your order record. Use it to track progress, contact the seller, and see every update.'

export function BookingEmail(p: { businessName: string; rows: Rows; inboxUrl: string }) {
  return (
    <BrandedEmail preview={`Booking confirmed with ${p.businessName}`} category="Merchant action">
      <EmailEyebrow>Booking</EmailEyebrow>
      <StatusBadge tone="positive">Confirmed</StatusBadge>
      <EmailHeading>A new booking is confirmed</EmailHeading>
      <Lead>
        A customer booked with <strong>{p.businessName}</strong>. The guest and schedule
        details we received are below.
      </Lead>
      <InfoRows rows={p.rows} />
      <PrimaryButton href={p.inboxUrl}>Review booking</PrimaryButton>
      <FinePrint>These booking details came directly from your connected booking tool.</FinePrint>
    </BrandedEmail>
  )
}

export function NegotiationEmail(p: { businessName: string; rows: Rows; inboxUrl: string }) {
  return (
    <BrandedEmail preview={`New negotiation request on ${p.businessName}`} category="Merchant action">
      <EmailEyebrow>Negotiation</EmailEyebrow>
      <StatusBadge tone="caution">Response needed</StatusBadge>
      <EmailHeading>A buyer is ready to discuss terms</EmailHeading>
      <Lead>
        Review the buyer’s budget, timing, and message. Then respond with the terms
        <strong> {p.businessName}</strong> is prepared to honor.
      </Lead>
      <InfoRows rows={p.rows} />
      <PrimaryButton href={p.inboxUrl}>Respond to buyer</PrimaryButton>
      <Notice>No term is binding until both sides accept it.</Notice>
    </BrandedEmail>
  )
}

export function EscrowFundedEmail(p: { lead: string; held: boolean; rows: Rows; inboxUrl: string }) {
  return (
    <BrandedEmail preview={p.lead} category="Merchant action">
      <EmailEyebrow>Payment</EmailEyebrow>
      <StatusBadge tone={p.held ? 'caution' : 'positive'}>
        {p.held ? 'Waiting for completion' : 'Paid'}
      </StatusBadge>
      <EmailHeading>{p.held ? 'The buyer’s payment is secured' : 'The buyer has paid'}</EmailHeading>
      <Lead>{p.lead}</Lead>
      <InfoRows rows={p.rows} />
      <PrimaryButton href={p.inboxUrl}>{p.held ? 'Complete the order' : 'View payment'}</PrimaryButton>
      {p.held
        ? <Notice>Complete the agreed work before collecting this payment. Until then, it will not appear in your balance.</Notice>
        : <FinePrint>Stripe confirmed this payment.</FinePrint>}
    </BrandedEmail>
  )
}

export function MoneyEventEmail(p: {
  heading: string; statusLabel: string; tone: EmailTone
  lead: string; rows: Rows; inboxUrl: string; cta: string
}) {
  return (
    <BrandedEmail preview={p.lead} category="Merchant action">
      <EmailEyebrow>Payment</EmailEyebrow>
      <StatusBadge tone={p.tone}>{p.statusLabel}</StatusBadge>
      <EmailHeading>{p.heading}</EmailHeading>
      <Lead>{p.lead}</Lead>
      <InfoRows rows={p.rows} />
      <PrimaryButton href={p.inboxUrl}>{p.cta}</PrimaryButton>
      <FinePrint>These amounts match the latest record in your payment account.</FinePrint>
    </BrandedEmail>
  )
}

export function BuyerReceiptEmail(p: { lead: string; rows: Rows; manageUrl: string }) {
  return (
    <BrandedEmail preview={p.lead} category="Buyer order">
      <EmailEyebrow>Receipt</EmailEyebrow>
      <StatusBadge tone="positive">Paid</StatusBadge>
      <EmailHeading>Your order is confirmed</EmailHeading>
      <Lead>{p.lead}</Lead>
      <InfoRows rows={p.rows} />
      <PrimaryButton href={p.manageUrl}>View your order</PrimaryButton>
      <Notice>The seller will update this order when the work is complete.</Notice>
      <FinePrint>{BUYER_NOTE}</FinePrint>
    </BrandedEmail>
  )
}

export function BuyerStatusEmail(p: {
  heading: string; statusLabel: string; tone: EmailTone
  lead: string; cta: string; rows: Rows; manageUrl: string
}) {
  return (
    <BrandedEmail preview={p.lead} category="Buyer order">
      <EmailEyebrow>Order</EmailEyebrow>
      <StatusBadge tone={p.tone}>{p.statusLabel}</StatusBadge>
      <EmailHeading>{p.heading}</EmailHeading>
      <Lead>{p.lead}</Lead>
      <InfoRows rows={p.rows} />
      <PrimaryButton href={p.manageUrl}>{p.cta}</PrimaryButton>
      <FinePrint>{BUYER_NOTE}</FinePrint>
    </BrandedEmail>
  )
}

export function BuyerRequestEmail(p: {
  heading: string; statusLabel: string; tone: EmailTone
  lead: string; rows: Rows; inboxUrl: string
}) {
  return (
    <BrandedEmail preview={p.lead} category="Merchant action">
      <EmailEyebrow>Buyer request</EmailEyebrow>
      <StatusBadge tone={p.tone}>{p.statusLabel}</StatusBadge>
      <EmailHeading>{p.heading}</EmailHeading>
      <Lead>{p.lead}</Lead>
      <InfoRows rows={p.rows} />
      <PrimaryButton href={p.inboxUrl}>Review request</PrimaryButton>
      <Notice>Reviewing this request does not move money. A refund happens only after you approve it.</Notice>
    </BrandedEmail>
  )
}

export function SupportTicketEmail(p: {
  requesterEmail: string; subject: string; rows: Rows; adminUrl: string
}) {
  return (
    <BrandedEmail preview={`New support request: ${p.subject}`} category="Support operations">
      <EmailEyebrow>Support</EmailEyebrow>
      <StatusBadge tone="caution">Response needed</StatusBadge>
      <EmailHeading>A support request needs your response</EmailHeading>
      <Lead>
        <strong>{p.requesterEmail}</strong> submitted <strong>{p.subject}</strong>. Review the
        message and send the next response.
      </Lead>
      <InfoRows rows={p.rows} />
      <PrimaryButton href={p.adminUrl}>Open support request</PrimaryButton>
      <Notice>Respond from the support desk to keep the full conversation in one place.</Notice>
    </BrandedEmail>
  )
}

export function SupportReplyEmail(p: { subject: string; replyBody: string; requestUrl: string }) {
  return (
    <BrandedEmail preview={`Nexez Support replied to “${p.subject}”.`} category="Support operations">
      <EmailEyebrow>Support</EmailEyebrow>
      {/* No badge: "Answered" is the heading again, one line higher and louder. */}
      <EmailHeading>Your support request has an answer</EmailHeading>
      <Lead>Here is our response to <strong>{p.subject}</strong>.</Lead>
      <Quote attribution="Nexez Support">{p.replyBody}</Quote>
      <PrimaryButton href={p.requestUrl}>Open your request</PrimaryButton>
      <FinePrint>Continue in the request to keep every reply in one place.</FinePrint>
    </BrandedEmail>
  )
}

export function SupportRequesterReplyEmail(p: {
  requesterEmail: string; subject: string; replyBody: string; adminUrl: string
}) {
  return (
    <BrandedEmail preview={`${p.requesterEmail} replied to “${p.subject}”.`} category="Support operations">
      <EmailEyebrow>Support</EmailEyebrow>
      <StatusBadge tone="caution">Awaiting you</StatusBadge>
      <EmailHeading>A requester replied</EmailHeading>
      <Lead>
        <strong>{p.requesterEmail}</strong> added a new message to <strong>{p.subject}</strong>.
        The next response is yours.
      </Lead>
      <Quote attribution={p.requesterEmail}>{p.replyBody}</Quote>
      <PrimaryButton href={p.adminUrl}>Open support request</PrimaryButton>
      <FinePrint>The support desk has the full conversation and reply controls.</FinePrint>
    </BrandedEmail>
  )
}

export function OrderLookupEmail(p: { lead: string; count: number; findUrl: string }) {
  return (
    <BrandedEmail preview="Your Nexez orders are ready" category="Buyer order">
      <EmailEyebrow>Order lookup</EmailEyebrow>
      {/* No badge: "Private link" describes the link, not a state the order
          moved into, and the eyebrow and fine print already cover it. */}
      <EmailHeading>
        {p.count === 1 ? 'Your order is ready to view' : 'Your orders are ready to view'}
      </EmailHeading>
      <Lead>{p.lead}</Lead>
      <InfoRows rows={[[p.count === 1 ? 'Order found' : 'Orders found', String(p.count)]]} />
      <PrimaryButton href={p.findUrl}>{p.count === 1 ? 'View your order' : 'View your orders'}</PrimaryButton>
      <FinePrint>If you did not ask for this link, you can ignore this email.</FinePrint>
    </BrandedEmail>
  )
}

export function TeamInviteEmail(p: { lead: string; inviteeEmail: string; acceptUrl: string }) {
  return (
    <BrandedEmail preview={p.lead} category="Account update">
      <EmailEyebrow>Workspace</EmailEyebrow>
      {/* No badge: "Ready to accept" is the button, restated above the heading. */}
      <EmailHeading>Your workspace invitation is ready</EmailHeading>
      <Lead>{p.lead}</Lead>
      <Caption>
        Accept with <Data>{p.inviteeEmail}</Data>. A different email address will not work.
      </Caption>
      <PrimaryButton href={p.acceptUrl}>Accept invitation</PrimaryButton>
      <FinePrint>Not expecting this? You can ignore it.</FinePrint>
    </BrandedEmail>
  )
}

export function SellerGrowthInviteEmail(p: {
  inviterBusinessName: string; inviteeEmail: string
  durationLabel: string; claimUrl: string
}) {
  return (
    <BrandedEmail
      preview={`${p.inviterBusinessName} invited your business to Nexez Launch.`}
      category="Account update"
    >
      <EmailEyebrow>Launch access</EmailEyebrow>
      {/* No badge: "No card required" is an offer term, not a state, and it is
          already the "Automatic charge: None" row below. */}
      <EmailHeading>Your Nexez Launch invitation is ready</EmailHeading>
      <Lead>
        <strong>{p.inviterBusinessName}</strong> invited your business to {p.durationLabel} of Nexez Launch
        at no subscription cost.
      </Lead>
      <Caption>{GROWTH_QUALIFICATION_TERMS}</Caption>
      <InfoRows rows={[
        ['Invitation', `Nexez Launch for ${p.durationLabel}`],
        ['Cost', '$0, with no card required'],
        ['Access starts', GROWTH_ACCESS_STARTS],
        ['Accept with', p.inviteeEmail],
      ]} />
      <PrimaryButton href={p.claimUrl}>Accept invitation</PrimaryButton>
      <Notice>This invitation creates a separate business account. It never shares access with {p.inviterBusinessName}.</Notice>
      <FinePrint>{GROWTH_EXPIRY_TERMS}</FinePrint>
    </BrandedEmail>
  )
}

/**
 * Founding cohort invitation. Cold outbound, so it carries an unsubscribe and
 * leads with the recipient's own site rather than with us.
 *
 * `observation` is the scan line: one specific, checkable thing about their
 * business. It is the whole email. Without it this is a discount announcement.
 */
export function FoundingCohortEmail(p: {
  businessName: string
  city: string
  observation: string
  spotsRemaining: number
  claimUrl: string
  unsubscribeUrl: string
  senderName: string
  senderTitle: string
}) {
  return (
    <BrandedEmail
      preview={`${PUBLIC_LAUNCH_DURATION} of Nexez Launch for eligible businesses, with no card required.`}
      category="Founding cohort"
    >
      <EmailEyebrow>Texas founding cohort</EmailEyebrow>
      <StatusBadge tone="positive">{p.spotsRemaining} founding spots left</StatusBadge>
      <EmailHeading>We want {p.businessName} in the founding cohort</EmailHeading>
      <Lead>
        Nexez is assembling a small group of Texas businesses that already make it easy for
        customers to understand what they do. <strong>{p.businessName}</strong> stood out.
      </Lead>
      <Lead>
        When someone in {p.city} asks an AI assistant for a business like yours, clear
        services, prices, boundaries, and next steps determine which businesses can be
        confidently recommended. Your site already gets an important part right:
      </Lead>
      <Text className="nx-ink" style={{
        borderLeft: `2px solid ${BRAND.signal}`,
        color: BRAND.ink, fontSize: '15px', lineHeight: '1.6',
        margin: '0 0 24px', padding: '2px 0 2px 16px',
      }}>
        {p.observation}
      </Text>
      <Lead>
        That is the kind of clarity Nexez uses to help the right customers find you,
        understand you, and take the next step.
      </Lead>
      <InfoRows rows={[
        ['Invitation', `${PUBLIC_LAUNCH_DURATION} of Nexez Launch`],
        ['Cost', '$0, with no card required'],
        ['Access starts', GROWTH_ACCESS_STARTS],
        ['Your role', 'Give us honest feedback as you use it'],
      ]} />
      <PrimaryButton href={p.claimUrl}>Accept your invitation</PrimaryButton>
      <Notice>
        This is a hands-on founding cohort, not a mailing list. We are keeping it small so
        every business receives direct support while building and publishing its first listing.
      </Notice>
      <FinePrint>
        Built in Texas. Starting with Texas.<br />
        {p.senderName}, {p.senderTitle}
      </FinePrint>
      <FinePrint>{GROWTH_QUALIFICATION_TERMS} {GROWTH_EXPIRY_TERMS}</FinePrint>
      <FinePrint>
        Not interested? <Link href={p.unsubscribeUrl} className="nx-link" style={styles.link}>
          Unsubscribe
        </Link> and we will not write again.
      </FinePrint>
    </BrandedEmail>
  )
}

export function PromotionExpiryEmail(p: {
  businessName: string; daysBefore: number; endsOn: string
  fallbackListingName: string | null; billingUrl: string
}) {
  const timing = p.daysBefore === 1 ? 'tomorrow' : `in ${p.daysBefore} days`
  return (
    <BrandedEmail preview={`Your free Nexez Launch access ends ${timing}.`} category="Account update">
      <EmailEyebrow>Plan</EmailEyebrow>
      <StatusBadge tone="caution">Changes {timing}</StatusBadge>
      <EmailHeading>Your Launch plan changes {timing}</EmailHeading>
      <Lead>
        On {p.endsOn}, promotional Launch access for <strong>{p.businessName}</strong> ends.
        {' '}{GROWTH_EXPIRY_TERMS}
      </Lead>
      <InfoRows rows={[
        ['Plan after this', 'Free, unless you choose a paid plan'],
        ['Listing kept live', p.fallbackListingName || 'Your oldest published listing'],
        ['Automatic charge', 'None'],
      ]} />
      <PrimaryButton href={p.billingUrl}>Review your plan</PrimaryButton>
      <FinePrint>
        We keep every draft and extra listing. Publish them again whenever your plan allows.
      </FinePrint>
    </BrandedEmail>
  )
}

/**
 * The one template that is not a notification. No StatusBadge: the badge
 * vocabulary describes what state an order or account has moved into, and a
 * brand new account has not moved into anything. "Ready" was the loudest
 * element on the page and it was saying nothing.
 *
 * Only the first name is used. A full_name off an OAuth profile renders as
 * "Welcome, Taio Smith." and, worse, the same merge field can carry a workspace
 * or company name, which is exactly how a competitor's welcome mail shipped
 * addressing us by our company name.
 */
export function firstNameOnly(name?: string | null): string | null {
  return name?.trim().split(/\s+/)[0] || null
}

export function WelcomeEmail(p: {
  name?: string | null; createUrl: string; financeUrl: string; docsUrl: string
}) {
  const first = firstNameOnly(p.name)
  return (
    <BrandedEmail preview="Your first Nexez listing starts with what you already sell." category="Account update">
      <EmailEyebrow>Account</EmailEyebrow>
      <EmailHeading>{first ? `Welcome, ${first}.` : 'Welcome to Nexez.'}</EmailHeading>
      <Lead>
        Nexez turns what you already sell into a clear, actionable listing for customers and
        AI assistants. It works alongside your website, so your existing presence stays intact.
      </Lead>
      <Steps
        label="Three steps to your first listing"
        items={[
          'Share your website or start from scratch. Nexez builds the first draft from what you already have.',
          'Confirm your services, prices, and policies. You approve every detail before it goes live.',
          'Publish. Customers and AI assistants can immediately understand your offer and take the next step.',
        ]}
      />
      <PrimaryButton href={p.createUrl}>Create your first listing</PrimaryButton>
      <NextSteps
        label="Build your full setup"
        items={[
          {
            title: 'Add payments',
            body: 'Connect Stripe to accept payments directly through eligible Nexez listings.',
            href: p.financeUrl,
            cta: 'Set up payments',
          },
          {
            title: 'Learn how Nexez works',
            body: 'See how Nexez carries a customer from discovery to booking and checkout.',
            href: p.docsUrl,
            cta: 'Explore the guide',
          },
        ]}
      />
      <FinePrint>Reply to this email whenever you need help. A real person will answer.</FinePrint>
    </BrandedEmail>
  )
}

export function StripeConnectedEmail(p: {
  financeUrl: string; listingsUrl: string; docsUrl: string
}) {
  return (
    <BrandedEmail preview="Stripe is connected to Nexez and ready for payments." category="Account update">
      <EmailEyebrow>Payments</EmailEyebrow>
      <StatusBadge tone="positive">Ready for payments</StatusBadge>
      <EmailHeading>Stripe is connected and ready</EmailHeading>
      <Lead>
        Eligible Nexez listings can now accept customer payments directly into your Stripe account.
      </Lead>
      <InfoRows rows={[
        ['Payment account', 'Your connected Stripe account'],
        ['Payouts', 'Managed in Stripe'],
        ['Nexez fee', 'Charged only when you get paid'],
      ]} />
      <PrimaryButton href={p.financeUrl}>Open Finance</PrimaryButton>
      <NextSteps
        label="Put it to work"
        items={[
          {
            title: 'Confirm your payment options',
            body: 'Publish a listing with a payment option so customers can check out.',
            href: p.listingsUrl,
            cta: 'Open your listings',
          },
          {
            title: 'Know the checkout flow',
            body: 'See exactly what happens from checkout through confirmation.',
            href: p.docsUrl,
            cta: 'Read the guide',
          },
        ]}
      />
      <FinePrint>No payment has been made yet. Your Finance dashboard will record each one.</FinePrint>
    </BrandedEmail>
  )
}

export function StaleListingEmail(p: {
  businessName: string; listingName: string; freshnessLabel: string
  reinterviewUrl: string; editUrl: string
}) {
  return (
    <BrandedEmail preview={`Keep “${p.listingName}” accurate for every customer.`} category="Merchant action">
      <EmailEyebrow>Listing</EmailEyebrow>
      {/* No badge: "Review suggested" is the heading and the button saying it a
          third time. The listing's actual state is the Freshness row. */}
      <EmailHeading>Bring this listing up to date</EmailHeading>
      <Lead>
        <strong>{p.listingName}</strong> has not been reviewed recently. Confirm its prices,
        availability, and service details so every customer gets a current answer.
      </Lead>
      <InfoRows rows={[
        ['Business', p.businessName],
        ['Listing', p.listingName],
        ['Freshness', p.freshnessLabel],
      ]} />
      <PrimaryButton href={p.reinterviewUrl}>Review listing</PrimaryButton>
      <FinePrint>
        Need full control?{' '}
        <Link href={p.editUrl} className="nx-link" style={styles.link}>Open the full editor</Link>.
        These reminders are limited.
      </FinePrint>
    </BrandedEmail>
  )
}

/*
 * ── Growth campaign lifecycle ────────────────────────────────────────────────
 *
 * Three moments the campaign had no voice for. The order matters, because each
 * one answers the question the previous one leaves open:
 *
 *   invite   -> SellerGrowthInviteEmail / FoundingCohortEmail   "there is a spot"
 *   reserved -> PublishNudgeEmail                               "it is still yours"
 *   issued   -> LaunchAccessStartedEmail                        "it started, here is when it ends"
 *
 * The reserved state exists because a grant is only minted once a listing is
 * actually live. Someone who signs up and stalls owns a spot that is burning no
 * time and hears nothing, which reads as though the offer evaporated.
 */

/**
 * Fires once, when the database mints the grant after all qualification gates
 * pass. Publication or a later verification can complete the final gate.
 *
 * `endsOn` is already formatted for display by the caller; the duration
 * is campaign configuration (`grant_duration_days`), never hardcoded here.
 */
export function LaunchAccessStartedEmail(p: {
  businessName: string
  listingName: string
  durationLabel: string
  endsOn: string
  dashboardUrl: string
}) {
  return (
    <BrandedEmail
      preview={`${p.listingName} is live, and your Launch access has started.`}
      category="Account update"
    >
      <EmailEyebrow>Plan</EmailEyebrow>
      <StatusBadge tone="positive">Launch active</StatusBadge>
      <EmailHeading>Your listing is live. Your free access is active.</EmailHeading>
      <Lead>
        Your business completed the qualification checks and your complimentary Nexez Launch access is active.
        {' '}<strong>{p.listingName}</strong> is live. {GROWTH_NO_CARD_TERMS}
      </Lead>
      <InfoRows rows={[
        ['Business', p.businessName],
        ['Plan', `Nexez Launch, ${p.durationLabel}`],
        ['First live listing', p.listingName],
        ['Runs until', p.endsOn],
      ]} />
      <PrimaryButton href={p.dashboardUrl}>Open your dashboard</PrimaryButton>
      <Notice>
        Your promotional access ends on {p.endsOn}. {GROWTH_EXPIRY_TERMS}
      </Notice>
      <FinePrint>
        We will remind you before the plan changes.
      </FinePrint>
    </BrandedEmail>
  )
}

/**
 * The stall. They claimed a spot but no listing is live, so no grant exists and
 * no clock is running.
 *
 * The single job of this email is to say that the time has not started, because
 * the reasonable assumption is the opposite. Everything else is secondary.
 */
export function PublishNudgeEmail(p: {
  businessName: string
  durationLabel: string
  reservedUntil: string | null
  publishUrl: string
}) {
  return (
    <BrandedEmail
      preview="Your Launch access has not started. Complete the qualification checks."
      category="Account update"
    >
      <EmailEyebrow>Launch access</EmailEyebrow>
      <StatusBadge tone="caution">Not started yet</StatusBadge>
      <EmailHeading>Your Launch qualification is not finished</EmailHeading>
      <Lead>
        Your complimentary {p.durationLabel} for <strong>{p.businessName}</strong> has not started.
        {' '}{GROWTH_QUALIFICATION_TERMS}
      </Lead>
      <InfoRows rows={[
        ['Access', `Nexez Launch, ${p.durationLabel}`],
        ['Time used', 'None'],
        ['Starts when', GROWTH_ACCESS_STARTS],
        ['Enrollment closes', p.reservedUntil || 'Subject to campaign availability'],
      ]} />
      <PrimaryButton href={p.publishUrl}>Publish your first listing</PrimaryButton>
      <Notice>
        Review your listing details and complete any remaining verification steps in your dashboard.
      </Notice>
      <FinePrint>Need help finishing? Reply to this email and a person will help.</FinePrint>
    </BrandedEmail>
  )
}

/**
 * Score bands for the readability scan. Exported because the subject line and
 * the plain-text part need the same words the badge uses, and deriving them
 * twice is how a "Hard to read" badge ends up under an "Agent ready" subject.
 *
 * The bands are deliberately blunt. A merchant reading their own score does not
 * need eleven gradations, they need to know whether an assistant can use their
 * site at all.
 */
export function scanReadinessBand(score: number): { tone: EmailTone; label: string } {
  if (score >= 70) return { tone: 'positive', label: 'Easy to understand' }
  if (score >= 40) return { tone: 'caution', label: 'Needs more detail' }
  return { tone: 'danger', label: 'Hard to understand' }
}

/**
 * Scan results for someone with no account, sent because they asked for them on
 * the public scan page.
 *
 * The findings carry the email. The offer sits underneath as the answer to a
 * problem they have just been shown, which is the only framing that earns it.
 * Cold-ish recipient, so it carries an unsubscribe.
 */
/**
 * Status travels with each row because the scanner already knows it: the outcome
 * words come from a closed map over CrawlCheck['status'] in lib/scan-findings.
 * Rows persisted before that map was widened arrive without one and render
 * neutral, which is the honest reading of "we no longer know".
 */
export type ScanFindingRow = [label: string, outcome: string, status?: 'pass' | 'warn' | 'fail']

const FINDING_TONES = { pass: 'positive', warn: 'caution', fail: 'danger' } as const

export function ScanResultsEmail(p: {
  domain: string
  score: number
  findings: ScanFindingRow[]
  claimUrl: string
  unsubscribeUrl: string
}) {
  const band = scanReadinessBand(p.score)
  return (
    <BrandedEmail
      preview={`${p.domain} scored ${p.score} out of 100. Here is what AI assistants can use.`}
      category="Account update"
    >
      <EmailEyebrow>Scan</EmailEyebrow>
      <StatusBadge tone={band.tone}>{band.label}</StatusBadge>
      <EmailHeading>AI assistants understand {p.domain} at {p.score}/100</EmailHeading>
      <Lead>
        We tested whether an AI assistant can find your services, prices, policies, and next
        steps. Your score is <Data>{p.score}</Data> out of 100.
      </Lead>
      <Findings items={p.findings.map(([label, outcome, status]) => ({
        label,
        outcome,
        tone: status ? FINDING_TONES[status] : 'neutral',
      }))} />
      <Caption>
        Every result below maps to a detail customers need before they can act.
      </Caption>
      <PrimaryButton href={p.claimUrl}>Close the gaps with Nexez</PrimaryButton>
      <Notice>
        Eligible businesses can receive {PUBLIC_LAUNCH_DURATION} of Nexez Launch at no subscription cost.
        {' '}{GROWTH_NO_CARD_TERMS} {GROWTH_QUALIFICATION_TERMS} {GROWTH_EXPIRY_TERMS}
      </Notice>
      <FinePrint>
        We ran this scan because you asked for it. We do not keep a copy of your site.{' '}
        <Link href={p.unsubscribeUrl} className="nx-link" style={styles.link}>Unsubscribe</Link>{' '}
        and we will not write again.
      </FinePrint>
    </BrandedEmail>
  )
}

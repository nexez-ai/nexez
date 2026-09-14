import 'server-only'
import type { ReactElement } from 'react'
import { render } from '@react-email/render'
import { captureError } from './observability'
import { describeGrantDuration } from './growth-duration'
import {
  GROWTH_ACCESS_STARTS, GROWTH_EXPIRY_TERMS, GROWTH_NO_CARD_TERMS,
  GROWTH_QUALIFICATION_TERMS, PUBLIC_LAUNCH_DURATION,
} from './growth-offer-copy'
import {
  BookingEmail,
  NegotiationEmail,
  EscrowFundedEmail,
  MoneyEventEmail,
  BuyerReceiptEmail,
  BuyerStatusEmail,
  BuyerRequestEmail,
  SupportReplyEmail,
  SupportRequesterReplyEmail,
  SupportTicketEmail,
  OrderLookupEmail,
  TeamInviteEmail,
  WelcomeEmail,
  firstNameOnly,
  type ScanFindingRow,
  StripeConnectedEmail,
  StaleListingEmail,
  SellerGrowthInviteEmail,
  PromotionExpiryEmail,
  LaunchAccessStartedEmail,
  PublishNudgeEmail,
  ScanResultsEmail,
  scanReadinessBand,
} from '../emails/templates'

// Gated transactional email (Resend-compatible). Dormant unless RESEND_API_KEY
// is set - like the other gated integrations (LLM, Stripe, Vercel). When unset,
// sendEmail is a no-op so the rest of the flow is unaffected.
//
// HTML is rendered from the branded react-email templates in ../emails (one brand
// palette, proper <Html>/<Head>/<Preview>, Outlook-friendly tables). The builders
// are ASYNC because react-email's render() is async. Plain-text bodies stay
// hand-authored here (cleaner + lets the text remain stable + unit-tested).

export function hasEmailEnv(): boolean {
  return Boolean(process.env.RESEND_API_KEY)
}

type SendEmailTag = { name: string; value: string }
type SendEmailInput = {
  to: string
  subject: string
  html: string
  text?: string
  idempotencyKey?: string
  replyTo?: string
  tags?: SendEmailTag[]
  // MIME headers on the message itself, distinct from the Resend request headers
  // above. Used for List-Unsubscribe on the one send that goes to someone who is
  // not a user; every transactional send leaves this unset.
  messageHeaders?: Record<string, string>
}
type SendResult = { ok: boolean; skipped?: boolean; id?: string; error?: string }

export const NEXEZ_TRANSACTIONAL_FROM = 'Nexez <notifications@nexez.ai>'
export const NEXEZ_SUPPORT_REPLY_TO = 'support@nexez.ai'
const APPROVED_TRANSACTIONAL_SENDERS = new Set([NEXEZ_TRANSACTIONAL_FROM])

function resolveTransactionalFrom(): string {
  const configured = process.env.EMAIL_FROM?.trim()
  return configured && APPROVED_TRANSACTIONAL_SENDERS.has(configured)
    ? configured
    : NEXEZ_TRANSACTIONAL_FROM
}

export async function sendEmail(input: SendEmailInput): Promise<SendResult> {
  if (!hasEmailEnv()) return { ok: false, skipped: true }
  if (!input.to) return { ok: false, error: 'missing recipient' }

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    }
    if (input.idempotencyKey) headers['Idempotency-Key'] = input.idempotencyKey

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        from: resolveTransactionalFrom(),
        to: [input.to],
        reply_to: input.replyTo?.trim() || NEXEZ_SUPPORT_REPLY_TO,
        subject: input.subject,
        html: input.html,
        ...(input.text ? { text: input.text } : {}),
        ...(input.messageHeaders && Object.keys(input.messageHeaders).length
          ? { headers: input.messageHeaders }
          : {}),
        tags: input.tags || [{ name: 'stream', value: 'transactional' }],
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      const error = `resend ${res.status}: ${body.slice(0, 200)}`
      captureError(new Error(`Email provider rejected a send with status ${res.status}.`), {
        area: 'email-send',
        provider: 'resend',
        status: res.status,
      })
      return { ok: false, error }
    }
    const data = (await res.json().catch(() => ({}))) as { id?: string }
    return { ok: true, id: data?.id }
  } catch (e) {
    captureError(e, { area: 'email-send', provider: 'resend' })
    return { ok: false, error: e instanceof Error ? e.message : 'send failed' }
  }
}

type Built = { subject: string; html: string; text: string }
type Row = [string, string | null | undefined]

// Structural, not Row, so a row that carries extra elements (a scan finding's
// verdict) still renders as "label: outcome" without a conversion step.
type TextRow = readonly [string, string | null | undefined, ...unknown[]]
const present = (rows: readonly TextRow[]) => rows.filter(([, v]) => v)
const textBody = (lead: string, rows: readonly TextRow[], cta: string, url: string) =>
  [lead, '', ...present(rows).map(([k, v]) => `${k}: ${v}`), '', `${cta}: ${url}`].join('\n')

/** Prose quoted in a text part, marked per line so a reply is visibly not ours. */
const quoteBlock = (body: string) =>
  body.replace(/\r\n/g, '\n').split('\n').map((line) => `> ${line}`.trimEnd()).join('\n')

// A plain-HTML fallback built from the (always-present) text body. Used only if
// react-email render() throws.
function basicHtml(text: string): string {
  const esc = text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string)
  return `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;white-space:pre-wrap;line-height:1.6;color:#0a0a0a;max-width:560px;margin:0 auto;padding:24px">${esc}</div>`
}

export async function buildSupportTicketEmail(opts: {
  requesterEmail: string
  ticketId: string
  subject: string
  category: string
  priority: string
  targetName: string
  query: string
  reference?: string | null
  supportTier: string
  adminUrl: string
}): Promise<Built> {
  const rows: Row[] = [
    ['Ticket', opts.ticketId],
    ['Subject', opts.subject],
    ['Requester', opts.requesterEmail],
    ['Target', opts.targetName],
    ['Category', opts.category],
    ['Priority', opts.priority],
    ['Support level', opts.supportTier],
    ['Reference', opts.reference],
    ['Message', opts.query],
  ]
  const subject = `[Support ${opts.priority}] ${opts.subject}`
  const text = textBody(
    `${opts.requesterEmail} submitted "${opts.subject}". Review the message and send the next response.`,
    rows,
    'Open support request',
    opts.adminUrl,
  )
  const html = await renderHtml(
    <SupportTicketEmail
      requesterEmail={opts.requesterEmail}
      subject={opts.subject}
      rows={rows}
      adminUrl={opts.adminUrl}
    />,
    text,
  )
  return { subject, html, text }
}

export async function buildSupportReplyEmail(opts: {
  ticketId: string
  ticketSubject: string
  replyBody: string
  requestUrl: string
}): Promise<Built> {
  const subject = `Re: ${opts.ticketSubject} [${opts.ticketId.slice(0, 8)}]`
  // The reply is prose, so it gets its own block rather than a "Message: ..."
  // row that folds a multi-paragraph answer onto one line.
  const text = [
    `Your Nexez support request has an answer: “${opts.ticketSubject}”.`,
    '',
    quoteBlock(opts.replyBody),
    '',
    `Open your support request: ${opts.requestUrl}`,
  ].join('\n')
  const html = await renderHtml(
    <SupportReplyEmail
      subject={opts.ticketSubject}
      replyBody={opts.replyBody}
      requestUrl={opts.requestUrl}
    />,
    text,
  )
  return { subject, html, text }
}

export async function buildSupportRequesterReplyEmail(opts: {
  requesterEmail: string
  ticketSubject: string
  replyBody: string
  adminUrl: string
}): Promise<Built> {
  const subject = `[Support reply] ${opts.ticketSubject}`
  const text = [
    `${opts.requesterEmail} added a new message to “${opts.ticketSubject}”. The next response is yours.`,
    '',
    quoteBlock(opts.replyBody),
    '',
    `Open support request: ${opts.adminUrl}`,
  ].join('\n')
  const html = await renderHtml(
    <SupportRequesterReplyEmail
      requesterEmail={opts.requesterEmail}
      subject={opts.ticketSubject}
      replyBody={opts.replyBody}
      adminUrl={opts.adminUrl}
    />,
    text,
  )
  return { subject, html, text }
}

// Render a template to HTML, but NEVER let a render failure silently kill the email.
// react-email's render() can throw at runtime (e.g. a serverless output-tracing gap that
// drops a transitive dep - passes locally + in the build, fails live). On failure we log
// + report it and fall back to the plain-text body as HTML, so the email still sends.
async function renderHtml(element: ReactElement, text: string): Promise<string> {
  try {
    return await render(element)
  } catch (e) {
    const template = (element.type as { name?: string })?.name || 'email'
    console.error(`[email] render failed for "${template}" - sending plain-HTML fallback:`, e)
    captureError(e, { area: 'email-render', template })
    return basicHtml(text)
  }
}

// ── Seller: new booking (Calendly etc.) ─────────────────────────────────────────
export async function buildBookingEmail(opts: {
  businessName: string
  eventName: string
  inviteeName?: string | null
  inviteeEmail?: string | null
  startTime?: string | null
  source?: string | null
  inboxUrl: string
}): Promise<Built> {
  const { businessName, eventName, inviteeName, inviteeEmail, startTime, source, inboxUrl } = opts
  const subject = `Booking confirmed: ${eventName}`
  const when = startTime ? new Date(startTime).toLocaleString() : null
  const rows: Row[] = [
    ['Booking', eventName],
    ['Guest', inviteeName],
    ['Email', inviteeEmail],
    ['When', when],
    ['Source', source],
  ]
  const text = textBody(
    `A customer booked with ${businessName}. The guest and schedule details we received are below.`,
    rows,
    'Review booking',
    inboxUrl,
  )
  const html = await renderHtml(<BookingEmail businessName={businessName} rows={rows} inboxUrl={inboxUrl} />, text)
  return { subject, html, text }
}

// ── Seller: buyer funded escrow ─────────────────────────────────────────────────
export async function buildEscrowFundedEmail(opts: {
  businessName: string
  offerName: string
  amount: string
  held: boolean
  buyerAgent?: string | null
  inboxUrl: string
}): Promise<Built> {
  const { businessName, offerName, amount, held, buyerAgent, inboxUrl } = opts
  const subject = held ? `Payment secured: ${offerName}` : `Payment received: ${offerName}`
  const lead = held
    ? `Payment for "${offerName}" from ${businessName} is secured. Complete the agreed work, then collect it from your Nexez inbox.`
    : `Payment for "${offerName}" from ${businessName} is complete and recorded.`
  const rows: Row[] = [
    ['Offer', offerName],
    ['Amount', amount],
    ['Status', held ? 'Payment secured, waiting for completion' : 'Paid'],
    ['Buyer assistant', buyerAgent],
  ]
  const text = textBody(lead, rows, held ? 'Complete the order' : 'View payment', inboxUrl)
  const html = await renderHtml(<EscrowFundedEmail lead={lead} held={held} rows={rows} inboxUrl={inboxUrl} />, text)
  return { subject, html, text }
}

// ── Seller: refund / dispute money events ───────────────────────────────────────
export async function buildMoneyEventEmail(opts: {
  kind: 'refund' | 'dispute_opened' | 'dispute_closed'
  businessName: string
  offerName: string
  amount?: string | null
  detail?: string | null
  inboxUrl: string
}): Promise<Built> {
  const { businessName, offerName, amount, detail, inboxUrl } = opts
  const copy = {
    refund: {
      subject: `Refund processed: ${offerName}`,
      heading: 'Refund processed',
      lead: `${businessName} refunded the payment for "${offerName}" to the buyer.`,
      tone: 'neutral' as const,
      statusLabel: 'Refund recorded',
      cta: 'Review payment',
    },
    dispute_opened: {
      subject: `Payment disputed: ${offerName}`,
      heading: 'A payment is disputed',
      lead: `The buyer disputed the payment for "${offerName}" from ${businessName}. Open Stripe and submit your evidence before the deadline.`,
      tone: 'danger' as const,
      statusLabel: 'Action required',
      cta: 'Review dispute',
    },
    dispute_closed: {
      subject: `Dispute resolved: ${offerName}`,
      heading: 'Dispute resolved',
      lead: `The dispute for "${offerName}" from ${businessName} is closed. Review the recorded outcome.`,
      tone: 'positive' as const,
      statusLabel: 'Dispute closed',
      cta: 'Review outcome',
    },
  }[opts.kind]
  const rows: Row[] = [
    ['Offer', offerName],
    ['Amount', amount],
    ['Details', detail],
  ]
  const text = textBody(copy.lead, rows, copy.cta, inboxUrl)
  const html = await renderHtml(
    <MoneyEventEmail
      heading={copy.heading}
      statusLabel={copy.statusLabel}
      tone={copy.tone}
      lead={copy.lead}
      rows={rows}
      inboxUrl={inboxUrl}
      cta={copy.cta}
    />,
    text,
  )
  return { subject: copy.subject, html, text }
}

// ── Seller: new negotiation request ─────────────────────────────────────────────
export async function buildNegotiationEmail(opts: {
  businessName: string
  offerName: string
  budget?: string | null
  timeline?: string | null
  query?: string | null
  buyerAgent?: string | null
  inboxUrl: string
}): Promise<Built> {
  const { businessName, offerName, budget, timeline, query, buyerAgent, inboxUrl } = opts
  const subject = `A buyer is ready to discuss ${offerName}`
  const rows: Row[] = [
    ['Offer', offerName],
    ['Budget', budget],
    ['Timeline', timeline],
    ['Buyer assistant', buyerAgent],
    ['Message', query],
  ]
  const text = textBody(
    `A buyer opened a negotiation for "${offerName}" from ${businessName}. Review their budget, timing, and message, then respond with terms you can honor.`,
    rows,
    'Respond to buyer',
    inboxUrl,
  )
  const html = await renderHtml(<NegotiationEmail businessName={businessName} rows={rows} inboxUrl={inboxUrl} />, text)
  return { subject, html, text }
}

// ── Buyer: purchase receipt ─────────────────────────────────────────────────────
export async function buildBuyerReceiptEmail(opts: {
  businessName: string
  offerName: string
  amount: string
  manageUrl: string
}): Promise<Built> {
  const { businessName, offerName, amount, manageUrl } = opts
  const subject = `Your receipt from ${businessName}`
  const lead = `Your payment to ${businessName} is confirmed. This private order link keeps your receipt, status, and seller updates in one place.`
  const rows: Row[] = [
    ['Seller', businessName],
    ['Item', offerName],
    ['Amount', amount],
  ]
  const text = textBody(lead, rows, 'View your order', manageUrl)
  const html = await renderHtml(<BuyerReceiptEmail lead={lead} rows={rows} manageUrl={manageUrl} />, text)
  return { subject, html, text }
}

// ── Buyer: order status update ──────────────────────────────────────────────────
export async function buildBuyerStatusEmail(opts: {
  kind: 'refunded' | 'partial_refund' | 'dispute_update' | 'request_received'
  businessName: string
  offerName: string
  amount?: string | null
  detail?: string | null
  manageUrl: string
}): Promise<Built> {
  const { businessName, offerName, amount, detail, manageUrl } = opts
  const copy = {
    refunded: {
      subject: `Your refund from ${businessName} is on its way`,
      heading: 'Refund processed',
      lead: `${businessName} issued your full refund. Your bank may take a few business days to post it.`,
      cta: 'View your order',
      statusLabel: 'Refund processed',
      tone: 'positive' as const,
    },
    partial_refund: {
      subject: `A partial refund from ${businessName}`,
      heading: 'Partial refund processed',
      lead: `${businessName} issued a partial refund. Your bank may take a few business days to post it.`,
      cta: 'View your order',
      statusLabel: 'Partial refund',
      tone: 'positive' as const,
    },
    dispute_update: {
      subject: `Update on your order from ${businessName}`,
      heading: 'Dispute update',
      lead: `The dispute for your order from ${businessName} has a new update. Open the order to review it.`,
      cta: 'View your order',
      statusLabel: 'Dispute update',
      tone: 'caution' as const,
    },
    request_received: {
      subject: `We received your request - ${businessName}`,
      heading: 'Request received',
      lead: `Your request is now with ${businessName}. We will update this order when the seller responds.`,
      cta: 'Track your request',
      statusLabel: 'Sent to seller',
      tone: 'neutral' as const,
    },
  }[opts.kind]
  const rows: Row[] = [
    ['Seller', businessName],
    ['Item', offerName],
    ['Amount', amount],
    ['Details', detail],
  ]
  const text = textBody(copy.lead, rows, copy.cta, manageUrl)
  const html = await renderHtml(
    <BuyerStatusEmail
      heading={copy.heading}
      statusLabel={copy.statusLabel}
      tone={copy.tone}
      lead={copy.lead}
      cta={copy.cta}
      rows={rows}
      manageUrl={manageUrl}
    />,
    text,
  )
  return { subject: copy.subject, html, text }
}

// ── Seller: buyer filed a refund request / problem report ───────────────────────
export async function buildBuyerRequestEmail(opts: {
  kind: 'refund_request' | 'problem_report'
  businessName: string
  offerName: string
  amount?: string | null
  message?: string | null
  buyerEmail?: string | null
  inboxUrl: string
}): Promise<Built> {
  const { kind, businessName, offerName, amount, message, buyerEmail, inboxUrl } = opts
  const isRefund = kind === 'refund_request'
  const subject = isRefund ? `Refund requested: ${offerName}` : `Buyer reported a problem: ${offerName}`
  const heading = isRefund ? 'A buyer requested a refund' : 'A buyer reported a problem'
  const lead = isRefund
    ? `A buyer requested a refund for "${offerName}" from ${businessName}. Review their reason and record your decision.`
    : `A buyer reported a problem with "${offerName}" from ${businessName}. Review their message and choose the resolution.`
  const rows: Row[] = [
    ['Offer', offerName],
    ['Amount', amount],
    ['Buyer', buyerEmail],
    ['Message', message],
  ]
  const text = textBody(lead, rows, 'Review request', inboxUrl)
  const html = await renderHtml(
    <BuyerRequestEmail
      heading={heading}
      statusLabel="Review required"
      tone="caution"
      lead={lead}
      rows={rows}
      inboxUrl={inboxUrl}
    />,
    text,
  )
  return { subject, html, text }
}

// ── Buyer: "find my orders" magic link ──────────────────────────────────────────
export async function buildOrderLookupEmail(opts: { count: number; findUrl: string }): Promise<Built> {
  const { count, findUrl } = opts
  const subject = 'Your Nexez orders'
  const lead =
    count === 1
      ? 'We found the order linked to this email. The secure link stays active for 24 hours and keeps its status, seller updates, and support in one place.'
      : `We found ${count} orders linked to this email. The secure link stays active for 24 hours and keeps their status, seller updates, and support in one place.`
  const text = [lead, '', `${count === 1 ? 'View your order' : 'View your orders'}: ${findUrl}`, '', "If you didn't request this, you can ignore this email."].join('\n')
  const html = await renderHtml(<OrderLookupEmail lead={lead} count={count} findUrl={findUrl} />, text)
  return { subject, html, text }
}

// ── Teammate: collaboration invite ──────────────────────────────────────────────
export async function buildTeamInviteEmail(opts: {
  inviterEmail: string
  inviteeEmail: string
  role: string
  acceptUrl: string
}): Promise<Built> {
  const { inviterEmail, inviteeEmail, role, acceptUrl } = opts
  const roleCopy = role === 'editor' ? 'edit their listings' : 'view their listings without making changes'
  const subject = `${inviterEmail} invited you to collaborate on Nexez`
  const lead = `${inviterEmail} invited you to their Nexez workspace as a ${role}. You can ${roleCopy}.`
  const text = [
    lead,
    '',
    `Use this email address to accept the invitation: ${inviteeEmail}. The invitation will not work with a different address.`,
    '',
    `Accept the invite: ${acceptUrl}`,
  ].join('\n')
  const html = await renderHtml(<TeamInviteEmail lead={lead} inviteeEmail={inviteeEmail} acceptUrl={acceptUrl} />, text)
  return { subject, html, text }
}

// ── Seller growth: invite another business to complimentary Launch access ──────
export async function buildSellerGrowthInviteEmail(opts: {
  inviterBusinessName: string
  inviteeEmail: string
  durationDays: number
  claimUrl: string
}): Promise<Built> {
  const { inviterBusinessName, inviteeEmail, durationDays, claimUrl } = opts
  const durationLabel = describeGrantDuration(durationDays)
  const subject = `Your Nexez Launch invitation from ${inviterBusinessName}`
  const text = [
    `${inviterBusinessName} invited your business to ${durationLabel} of Nexez Launch at no subscription cost.`,
    GROWTH_QUALIFICATION_TERMS,
    '',
    `Invitation: Nexez Launch for ${durationLabel}`,
    'Cost: $0, with no card required',
    `Access starts: ${GROWTH_ACCESS_STARTS}`,
    '',
    `Accept the invitation with ${inviteeEmail}: ${claimUrl}`,
    '',
    `This invitation creates a separate business account. It never shares access with ${inviterBusinessName}.`,
    GROWTH_EXPIRY_TERMS,
  ].join('\n')
  const html = await renderHtml(
    <SellerGrowthInviteEmail
      inviterBusinessName={inviterBusinessName}
      inviteeEmail={inviteeEmail}
      durationLabel={durationLabel}
      claimUrl={claimUrl}
    />,
    text,
  )
  return { subject, html, text }
}

// ── Seller growth: reminder before a promotional plan returns to Free ───────────
export async function buildPromotionExpiryEmail(opts: {
  businessName: string
  daysBefore: number
  endsAt: string
  fallbackListingName?: string | null
  billingUrl: string
}): Promise<Built> {
  const { businessName, daysBefore, endsAt, fallbackListingName = null, billingUrl } = opts
  const timing = daysBefore === 1 ? 'tomorrow' : `in ${daysBefore} days`
  const endsOn = new Intl.DateTimeFormat('en', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(endsAt))
  const subject = `Your free Nexez Launch access ends ${timing}`
  const text = [
    `On ${endsOn}, promotional Launch access for ${businessName} ends. ${GROWTH_EXPIRY_TERMS}`,
    '',
    `Listing kept published: ${fallbackListingName || 'your oldest published listing'}`,
    'We keep every draft and extra listing. Publish them again whenever your plan allows.',
    '',
    `Review your plan: ${billingUrl}`,
  ].join('\n')
  const html = await renderHtml(
    <PromotionExpiryEmail
      businessName={businessName}
      daysBefore={daysBefore}
      endsOn={endsOn}
      fallbackListingName={fallbackListingName}
      billingUrl={billingUrl}
    />,
    text,
  )
  return { subject, html, text }
}

// ── New-user welcome (fired once on first sign-in via sendOnceSystemEmail) ───────
export async function buildWelcomeEmail(opts: {
  name?: string | null; createUrl: string; financeUrl: string; docsUrl: string
}): Promise<Built> {
  const { name, createUrl, financeUrl, docsUrl } = opts
  const first = firstNameOnly(name)
  const subject = 'Welcome to Nexez. Your first listing starts here.'
  const text = [
    first ? `Welcome, ${first}.` : 'Welcome to Nexez.',
    '',
    'Nexez turns what you already sell into a clear, actionable listing for customers and AI assistants. It works alongside your website, so your existing presence stays intact.',
    '',
    'Three steps to your first listing:',
    '1. Share your website or start from scratch. Nexez builds the first draft from what you already have.',
    '2. Confirm your services, prices, and policies. You approve every detail before it goes live.',
    '3. Publish. Customers and AI assistants can immediately understand your offer and take the next step.',
    '',
    `Create your first listing: ${createUrl}`,
    '',
    'Build your full setup:',
    `Connect Stripe to accept payments directly through eligible Nexez listings: ${financeUrl}`,
    `See how Nexez carries a customer from discovery to booking and checkout: ${docsUrl}`,
    '',
    'Reply to this email whenever you need help. A real person will answer.',
  ].join('\n')
  const html = await renderHtml(
    <WelcomeEmail name={name} createUrl={createUrl} financeUrl={financeUrl} docsUrl={docsUrl} />,
    text,
  )
  return { subject, html, text }
}

// ── Stripe Connect linked + charges enabled (fired once on the false→true flip) ──
export async function buildStripeConnectedEmail(opts: {
  financeUrl: string; listingsUrl: string; docsUrl: string
}): Promise<Built> {
  const { financeUrl, listingsUrl, docsUrl } = opts
  const subject = 'Stripe is connected. Payments are ready.'
  const text = [
    'Eligible Nexez listings can now accept customer payments directly into your Stripe account. Nexez charges a fee only when you get paid.',
    '',
    `Open your Finance dashboard: ${financeUrl}`,
    '',
    'Put it to work:',
    `Publish a listing with a payment option so customers can check out: ${listingsUrl}`,
    `See exactly what happens from checkout through confirmation: ${docsUrl}`,
    '',
    'No payment has been made yet. Your Finance dashboard will record each one.',
  ].join('\n')
  const html = await renderHtml(
    <StripeConnectedEmail financeUrl={financeUrl} listingsUrl={listingsUrl} docsUrl={docsUrl} />,
    text,
  )
  return { subject, html, text }
}

// ── Stale-listing re-interview nudge (freshness cron; seller-facet email) ──
export async function buildStaleListingEmail(opts: {
  businessName: string
  listingName: string
  freshnessLabel: string
  reinterviewUrl: string
  editUrl: string
}): Promise<Built> {
  const { businessName, listingName, freshnessLabel, reinterviewUrl, editUrl } = opts
  const subject = `Bring “${listingName}” up to date`
  const text = [
    `"${listingName}" has not been reviewed recently (${freshnessLabel}). Confirm its prices, availability, and service details so every customer gets a current answer.`,
    '',
    'The guided review focuses on details that may be missing or out of date. Most people finish in a couple of minutes.',
    '',
    `Review this listing: ${reinterviewUrl}`,
    `Or open the full editor: ${editUrl}`,
  ].join('\n')
  const html = await renderHtml(
    <StaleListingEmail
      businessName={businessName}
      listingName={listingName}
      freshnessLabel={freshnessLabel}
      reinterviewUrl={reinterviewUrl}
      editUrl={editUrl}
    />,
    text,
  )
  return { subject, html, text }
}

// Grant windows are stored as instants but read by a merchant as a calendar day.
// UTC keeps the date in this email identical to the one the expiry notice quotes
// months later; a local timezone would drift the two apart by a day for anyone
// west of Greenwich, which is every Texas recipient.
const asCalendarDay = (iso: string) =>
  new Intl.DateTimeFormat('en', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(iso))

// ── Seller growth: the promotional grant started after all qualification gates ──
export async function buildLaunchAccessStartedEmail(opts: {
  businessName: string
  listingName: string
  durationLabel: string
  endsAt: string
  dashboardUrl: string
}): Promise<Built> {
  const { businessName, listingName, durationLabel, endsAt, dashboardUrl } = opts
  const endsOn = asCalendarDay(endsAt)
  const subject = 'Your Nexez Launch access has started'
  const rows: Row[] = [
    ['Business', businessName],
    ['Plan', `Nexez Launch, ${durationLabel}`],
    ['First live listing', listingName],
    ['Runs until', endsOn],
  ]
  const text = textBody(
    `Your business completed the qualification checks and your complimentary Nexez Launch access is active. "${listingName}" is live. ${GROWTH_NO_CARD_TERMS}\n\nYour promotional access ends on ${endsOn}. ${GROWTH_EXPIRY_TERMS} We will remind you before the plan changes.`,
    rows,
    'Open your dashboard',
    dashboardUrl,
  )
  const html = await renderHtml(
    <LaunchAccessStartedEmail
      businessName={businessName}
      listingName={listingName}
      durationLabel={durationLabel}
      endsOn={endsOn}
      dashboardUrl={dashboardUrl}
    />,
    text,
  )
  return { subject, html, text }
}

// ── Seller growth: spot claimed, nothing published, so no grant exists yet ───────
export async function buildPublishNudgeEmail(opts: {
  businessName: string
  durationLabel: string
  reservedUntil?: string | null
  publishUrl: string
}): Promise<Built> {
  const { businessName, durationLabel, reservedUntil = null, publishUrl } = opts
  const heldUntil = reservedUntil ? asCalendarDay(reservedUntil) : null
  const subject = 'Your Nexez Launch qualification is not finished'
  const rows: Row[] = [
    ['Access', `Nexez Launch, ${durationLabel}`],
    ['Time used', 'None'],
    ['Starts when', GROWTH_ACCESS_STARTS],
    ['Enrollment closes', heldUntil || 'Subject to campaign availability'],
  ]
  const text = textBody(
    `Your complimentary ${durationLabel} for ${businessName} has not started. ${GROWTH_QUALIFICATION_TERMS}\n\nReview your listing details and complete any remaining verification steps in your dashboard.`,
    rows,
    'Publish your first listing',
    publishUrl,
  )
  const html = await renderHtml(
    <PublishNudgeEmail
      businessName={businessName}
      durationLabel={durationLabel}
      reservedUntil={heldUntil}
      publishUrl={publishUrl}
    />,
    text,
  )
  return { subject, html, text }
}

// ── Public scan results for a visitor with no account (landing-page scan tool) ───
export async function buildScanResultsEmail(opts: {
  domain: string
  score: number
  findings: ScanFindingRow[]
  claimUrl: string
  unsubscribeUrl: string
}): Promise<Built> {
  const { domain, findings, claimUrl, unsubscribeUrl } = opts
  // A scanner bug must not produce "scored NaN out of 100" in a stranger's inbox.
  const score = Number.isFinite(opts.score) ? Math.max(0, Math.min(100, Math.round(opts.score))) : 0
  const band = scanReadinessBand(score)
  const subject = `AI clarity score for ${domain}: ${score}/100`
  const text = textBody(
    `We tested whether an AI assistant can find the services, prices, policies, and next steps on ${domain}. The score is ${score} out of 100: ${band.label.toLowerCase()}.\n\nEvery result below maps to a detail customers need before they can act.`,
    findings,
    'Close the gaps with Nexez',
    claimUrl,
  ) + `\n\nEligible businesses can receive ${PUBLIC_LAUNCH_DURATION} of Nexez Launch at no subscription cost. ${GROWTH_NO_CARD_TERMS} ${GROWTH_QUALIFICATION_TERMS} ${GROWTH_EXPIRY_TERMS}\n\nUnsubscribe: ${unsubscribeUrl}`
  const html = await renderHtml(
    <ScanResultsEmail
      domain={domain}
      score={score}
      findings={findings}
      claimUrl={claimUrl}
      unsubscribeUrl={unsubscribeUrl}
    />,
    text,
  )
  return { subject, html, text }
}

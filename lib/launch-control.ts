import type { SupportQueueProjection } from './support-routing'
import {
  MARKETPLACE_DISCOVERY_ENABLED,
  MARKETPLACE_DISCOVERY_MERCHANT_THRESHOLD,
} from './marketplace-discovery'

export type LaunchStatus = 'ready' | 'attention' | 'blocked' | 'unknown'

export type LaunchCheck = {
  id: string
  label: string
  detail: string
  evidence: string
  status: LaunchStatus
  required: boolean
  action?: string
}

export type LaunchConfigurationInput = {
  supabasePublic: boolean
  supabaseAdmin: boolean
  stripeMode: 'live' | 'test' | 'unknown'
  stripeWebhooks: boolean
  stripeConnectWebhook: boolean
  priceIdsConfigured: number
  priceIdsExpected: number
  priceIdsInvalid: number
  stripeCatalogVerified: boolean | null
  stripeCatalogDetail: string
  actionApprovalSecret: boolean
  actionApprovalRequired: boolean
  releaseCertificationSecret: boolean
  cronSecret: boolean
  email: boolean
  observability: boolean
  integrationEncryption: boolean
  llm: boolean
  hostsAligned: boolean
}

export type LaunchSourceAvailability = {
  stripeWebhooks: boolean
  checkoutEvents: boolean
  orders: boolean
  orderEvents: boolean
  orderFulfillments: boolean
  orderRequests: boolean
  negotiations: boolean
  billing: boolean
  shopify: boolean
  outboundWebhooks: boolean
  support: boolean
  checkoutSessions: boolean
  resourcePools: boolean
  resourceHolds: boolean
  resourceReservations: boolean
  stagedSettlementAgreements: boolean
  stagedSettlementObligations: boolean
}

export type LaunchMetrics = {
  stripeWebhookEvents: number
  latestStripeWebhookAt: string | null
  /** Direct Stripe-API verification of the app's webhook endpoints: true = every
   * matching endpoint reports enabled; false = at least one reports disabled;
   * null = could not be verified (API unreachable, no key, or destinations not
   * visible to the classic endpoint list). This is the delivery-health signal
   * that does not depend on organic traffic - a quiet account stays provable. */
  stripeWebhookEndpointsEnabled: boolean | null
  /** True only when Stripe exposes both account and connected-account webhook
   * destinations expected by the configured signing-secret roles. */
  stripeWebhookEndpointRolesCovered: boolean | null
  /** True only when every matching endpoint receives all refund recovery events. */
  stripeWebhookRefundEventsCovered: boolean | null
  stripeWebhookEndpointCount: number | null
  stripeWebhookMissingEndpointRoles: string[]
  stripeWebhookMissingRefundEvents: string[]
  stripePriceWebhookEvents: number
  stripePriceSyncEvents: number
  checkoutStripeErrors24h: number
  checkoutOrders: number
  directOrders: number
  paidOrders: number
  refundedOrders: number
  disputedOrders: number
  directPaymentLifecycles: number
  directFulfillmentLifecycles: number
  directIssueResolutionLifecycles: number
  directRefundLifecycles: number
  directOperationalLifecycles: number
  protocolOrders: number
  sandboxProtocolOrders: number
  acpLiveProtocolOrders: number
  ucpLiveProtocolOrders: number
  acpSandboxProtocolOrders: number
  ucpSandboxProtocolOrders: number
  acpDelegatedPayments: number
  ucpDelegatedPayments: number
  negotiations: number
  pendingNegotiationDecisions: number
  staleNegotiationDecisions: number
  completedNegotiations: number
  heldNegotiations: number
  paymentBackedNegotiations: number
  refundedNegotiations: number
  activeSubscriptions: number
  subscriptionRecords: number
  connectChargeReady: number
  connectPayoutReady: number
  shopifyInstalls: number
  shopifyPending: number
  shopifyStale: number
  shopifyErrors: number
  activeOutboundWebhooks: number
  failedOutboundWebhooks: number
  urgentSupportTickets: number
  expiredCheckoutSessions: number
  resourcePoolsConfigured: number
  resourceHoldsOpen: number
  resourceHoldsExpired: number
  resourceHoldsFailed: number
  resourceHoldsCancelled: number
  resourceSettlements: number
  stagedSettlementAgreements: number
  stagedSettlementAgreementsOpen: number
  stagedSettlementObligationsPaid: number
  stagedSettlementSettlements: number
  stagedSettlementFailures: number
}

export type AdvancedCommerceOrderEvidence = {
  id: string
  status: string
  channel: string | null
  stripe_livemode: boolean | null
  resource_hold_id: string | null
  staged_settlement_agreement_id: string | null
  staged_settlement_obligation_id: string | null
}

export type DirectOrderEvidence = {
  id: string
  status: string
  channel: string | null
  stripe_livemode: boolean | null
  amount_cents: number
  refunded_cents: number | null
}

export type DirectOrderEventEvidence = {
  order_id: string
  event_type: string
  metadata: Record<string, unknown>
}

export type ProtocolOrderEvidence = {
  id: string
  channel: string | null
  status: string
  stripe_livemode: boolean | null
}

export type ProtocolCredentialEvidence = {
  acpDelegatedPayments: number
  ucpDelegatedPayments: number
}

export type DirectOrderFulfillmentEvidence = {
  order_id: string
  status: string
}

export type DirectOrderRequestEvidence = {
  id: string
  order_id: string
  kind: string
  status: string
}

export type DirectOrderLifecycleEvidence = Pick<LaunchMetrics,
  | 'directPaymentLifecycles'
  | 'directFulfillmentLifecycles'
  | 'directIssueResolutionLifecycles'
  | 'directRefundLifecycles'
  | 'directOperationalLifecycles'
>

export type ResourcePoolEvidence = {
  id: string
  status: string
}

export type ResourceHoldEvidence = {
  id: string
  status: string
}

export type ResourceReservationEvidence = {
  id: string
  hold_id: string
  status: string
  checkout_order_id: string | null
}

export type StagedSettlementAgreementEvidence = {
  id: string
  status: string
}

export type StagedSettlementObligationEvidence = {
  id: string
  agreement_id: string
  status: string
  stripe_livemode: boolean | null
}

export type AdvancedCommerceEvidence = Pick<LaunchMetrics,
  | 'resourcePoolsConfigured'
  | 'resourceHoldsOpen'
  | 'resourceHoldsExpired'
  | 'resourceHoldsFailed'
  | 'resourceHoldsCancelled'
  | 'resourceSettlements'
  | 'stagedSettlementAgreements'
  | 'stagedSettlementAgreementsOpen'
  | 'stagedSettlementObligationsPaid'
  | 'stagedSettlementSettlements'
  | 'stagedSettlementFailures'
>

export type LaunchIncident = {
  id: string
  title: string
  detail: string
  occurredAt: string | null
  status: Exclude<LaunchStatus, 'ready'>
  href?: string
}

export type LaunchSummary = {
  status: LaunchStatus
  score: number
  ready: number
  attention: number
  blocked: number
  unknown: number
}

export type LaunchControlSnapshot = {
  generatedAt: string
  environment: {
    stripeMode: LaunchConfigurationInput['stripeMode']
    marketingHost: string
    appHost: string
    agentHost: string
  }
  configuration: LaunchCheck[]
  operations: LaunchCheck[]
  certification: LaunchCheck[]
  summary: LaunchSummary
  metrics: LaunchMetrics
  sources: LaunchSourceAvailability
  supportQueue: SupportQueueProjection[]
  incidents: LaunchIncident[]
}

type MarketplaceCurationSignal = {
  available: boolean
  summary: {
    total: number
    unreviewed: number
    candidate: number
    certified: number
    excluded: number
    certifiedMerchants?: number
  }
}

const READY_WEIGHT: Record<LaunchStatus, number> = {
  ready: 1,
  attention: 0.55,
  unknown: 0.25,
  blocked: 0,
}

const STRIPE_CATALOG_SYNC_EVENT_TYPES = new Set([
  'price.created',
  'price.updated',
  'product.updated',
])

export function isStripeCatalogSyncEvent(type: string | null): boolean {
  return type != null && STRIPE_CATALOG_SYNC_EVENT_TYPES.has(type)
}

const SETTLED_ORDER_STATUSES = new Set(['paid', 'refunded', 'disputed'])

export function isSettledProtocolOrder(order: {
  channel: string | null
  status: string
  stripe_livemode: boolean | null
}): boolean {
  return order.stripe_livemode != null
    && (order.channel === 'acp' || order.channel === 'ucp')
    && SETTLED_ORDER_STATUSES.has(order.status)
}

export function deriveProtocolCredentialEvidence(input: {
  orders: ProtocolOrderEvidence[]
  events: DirectOrderEventEvidence[]
}): ProtocolCredentialEvidence {
  const ordersById = new Map(
    input.orders.filter(isSettledProtocolOrder).map((order) => [order.id, order]),
  )
  const acp = new Set<string>()
  const ucp = new Set<string>()

  for (const event of input.events) {
    if (event.event_type !== 'protocol_credential_confirmed') continue
    const order = ordersById.get(event.order_id)
    if (order?.channel === 'acp' && event.metadata?.credentialKind === 'shared_payment_token') {
      acp.add(order.id)
    }
    if (order?.channel === 'ucp' && event.metadata?.credentialKind === 'google_pay') {
      ucp.add(order.id)
    }
  }

  return { acpDelegatedPayments: acp.size, ucpDelegatedPayments: ucp.size }
}

export function deriveDirectOrderLifecycleEvidence(input: {
  orders: DirectOrderEvidence[]
  events: DirectOrderEventEvidence[]
  fulfillments: DirectOrderFulfillmentEvidence[]
  requests: DirectOrderRequestEvidence[]
}): DirectOrderLifecycleEvidence {
  const eventsByOrder = groupBy(input.events, (event) => event.order_id)
  const fulfillmentsByOrder = new Map(input.fulfillments.map((row) => [row.order_id, row]))
  const requestsByOrder = groupBy(input.requests, (request) => request.order_id)
  let directPaymentLifecycles = 0
  let directFulfillmentLifecycles = 0
  let directIssueResolutionLifecycles = 0
  let directRefundLifecycles = 0
  let directOperationalLifecycles = 0

  for (const order of input.orders) {
    if (
      order.stripe_livemode !== true
      || (order.channel != null && order.channel !== 'agent_checkout')
      || !Number.isInteger(order.amount_cents)
      || order.amount_cents <= 0
    ) continue

    const events = eventsByOrder.get(order.id) ?? []
    const paymentProven = events.some((event) => event.event_type === 'order_recorded')
      && events.some((event) => (
        event.event_type === 'payment_confirmed'
        && event.metadata.livemode === true
        && event.metadata.amountCents === order.amount_cents
      ))
    if (paymentProven) directPaymentLifecycles += 1

    const fulfillmentProven = fulfillmentsByOrder.get(order.id)?.status === 'fulfilled'
      && events.some((event) => event.event_type === 'fulfillment_updated' && event.metadata.toStatus === 'fulfilled')
    if (paymentProven && fulfillmentProven) directFulfillmentLifecycles += 1

    const requests = requestsByOrder.get(order.id) ?? []
    const issueResolutionProven = requests.some((request) => (
      request.kind === 'problem_report'
      && request.status === 'resolved'
      && events.some((event) => (
        event.event_type === 'buyer_request_received'
        && event.metadata.requestId === request.id
        && event.metadata.kind === request.kind
      ))
      && events.some((event) => (
        event.event_type === 'buyer_request_updated'
        && event.metadata.requestId === request.id
        && event.metadata.status === 'resolved'
      ))
    ))
    if (paymentProven && issueResolutionProven) directIssueResolutionLifecycles += 1

    const refundTotals = events
      .filter((event) => event.event_type === 'refund_recorded')
      .map((event) => ({
        total: evidenceNumber(event.metadata.refundedCents),
        fully: event.metadata.fullyRefunded === true,
      }))
      .filter((event): event is { total: number; fully: boolean } => event.total != null)
    const refundProven = order.status === 'refunded'
      && Number(order.refunded_cents) >= order.amount_cents
      && refundTotals.some((event) => event.total > 0 && event.total < order.amount_cents)
      && refundTotals.some((event) => event.fully && event.total >= order.amount_cents)
      && new Set(refundTotals.map((event) => event.total)).size >= 2
    if (paymentProven && refundProven) directRefundLifecycles += 1

    if (paymentProven && fulfillmentProven && issueResolutionProven && refundProven) {
      directOperationalLifecycles += 1
    }
  }

  return {
    directPaymentLifecycles,
    directFulfillmentLifecycles,
    directIssueResolutionLifecycles,
    directRefundLifecycles,
    directOperationalLifecycles,
  }
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>()
  for (const row of rows) {
    const id = key(row)
    grouped.set(id, [...(grouped.get(id) ?? []), row])
  }
  return grouped
}

function evidenceNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function deriveAdvancedCommerceEvidence(input: {
  orders: AdvancedCommerceOrderEvidence[]
  resourcePools: ResourcePoolEvidence[]
  resourceHolds: ResourceHoldEvidence[]
  resourceReservations: ResourceReservationEvidence[]
  stagedSettlementAgreements: StagedSettlementAgreementEvidence[]
  stagedSettlementObligations: StagedSettlementObligationEvidence[]
}): AdvancedCommerceEvidence {
  const settledLiveOrders = input.orders.filter((order) => (
    order.stripe_livemode === true && SETTLED_ORDER_STATUSES.has(order.status)
  ))
  const resourceOrdersByHold = new Map(
    settledLiveOrders
      .filter((order) => order.channel === 'reservable_resource' && order.resource_hold_id)
      .map((order) => [order.resource_hold_id as string, order]),
  )
  const committedHoldIds = new Set(
    input.resourceHolds.filter((hold) => hold.status === 'committed').map((hold) => hold.id),
  )
  const provenReservationIds = new Set(
    input.resourceReservations
      .filter((reservation) => {
        if (!['committed', 'fulfilled'].includes(reservation.status) || !reservation.checkout_order_id) return false
        if (!committedHoldIds.has(reservation.hold_id)) return false
        const order = resourceOrdersByHold.get(reservation.hold_id)
        return order?.id === reservation.checkout_order_id
      })
      .map((reservation) => reservation.id),
  )

  const stagedOrdersByObligation = new Map(
    settledLiveOrders
      .filter((order) => (
        order.channel === 'staged_settlement'
        && order.staged_settlement_agreement_id
        && order.staged_settlement_obligation_id
      ))
      .map((order) => [order.staged_settlement_obligation_id as string, order]),
  )
  const obligationsByAgreement = new Map<string, StagedSettlementObligationEvidence[]>()
  for (const obligation of input.stagedSettlementObligations) {
    const obligations = obligationsByAgreement.get(obligation.agreement_id) ?? []
    obligations.push(obligation)
    obligationsByAgreement.set(obligation.agreement_id, obligations)
  }
  const fullyProvenAgreements = input.stagedSettlementAgreements.filter((agreement) => {
    if (agreement.status !== 'complete') return false
    const obligations = obligationsByAgreement.get(agreement.id) ?? []
    return obligations.length > 0 && obligations.every((obligation) => {
      if (obligation.status !== 'paid' || obligation.stripe_livemode !== true) return false
      const order = stagedOrdersByObligation.get(obligation.id)
      return order?.staged_settlement_agreement_id === agreement.id
    })
  })

  return {
    resourcePoolsConfigured: input.resourcePools.filter((pool) => pool.status === 'active').length,
    resourceHoldsOpen: input.resourceHolds.filter((hold) => ['active', 'payment_pending'].includes(hold.status)).length,
    resourceHoldsExpired: input.resourceHolds.filter((hold) => hold.status === 'expired').length,
    resourceHoldsFailed: input.resourceHolds.filter((hold) => hold.status === 'failed').length,
    resourceHoldsCancelled: input.resourceHolds.filter((hold) => hold.status === 'cancelled').length,
    resourceSettlements: provenReservationIds.size,
    stagedSettlementAgreements: input.stagedSettlementAgreements.length,
    stagedSettlementAgreementsOpen: input.stagedSettlementAgreements.filter((agreement) => ['pending', 'active'].includes(agreement.status)).length,
    stagedSettlementObligationsPaid: input.stagedSettlementObligations.filter((obligation) => (
      obligation.status === 'paid' && obligation.stripe_livemode === true
    )).length,
    stagedSettlementSettlements: fullyProvenAgreements.length,
    stagedSettlementFailures: input.stagedSettlementAgreements.filter((agreement) => ['cancelled', 'disputed'].includes(agreement.status)).length,
  }
}

export function buildConfigurationChecks(input: LaunchConfigurationInput): LaunchCheck[] {
  const priceCountReady = input.priceIdsConfigured === input.priceIdsExpected && input.priceIdsInvalid === 0
  const catalogStatus: LaunchStatus = input.stripeCatalogVerified === true
    ? 'ready'
    : input.stripeCatalogVerified === false
      ? 'blocked'
      : priceCountReady
        ? 'attention'
        : 'blocked'

  return [
    {
      id: 'supabase',
      label: 'Core data access',
      detail: 'Public requests use the publishable key; privileged jobs use the server-only service role.',
      evidence: input.supabasePublic && input.supabaseAdmin
        ? 'Public and service-role configuration detected.'
        : 'One or more required Supabase settings are missing.',
      status: input.supabasePublic && input.supabaseAdmin ? 'ready' : 'blocked',
      required: true,
      action: 'Set the Supabase URL, publishable key, and service-role key in the production environment.',
    },
    {
      id: 'stripe-rails',
      label: 'Stripe transaction rails',
      detail: 'The platform key and both webhook secrets must agree on the same Stripe mode.',
      evidence: input.stripeMode === 'live'
        ? 'Live Stripe key detected with account and Connect webhook secrets.'
        : input.stripeMode === 'test'
          ? 'Test-mode Stripe key detected.'
          : 'Stripe mode could not be determined.',
      status: input.stripeMode === 'unknown' || !input.stripeWebhooks || !input.stripeConnectWebhook
        ? 'blocked'
        : input.stripeMode === 'test'
          ? 'attention'
          : 'ready',
      required: true,
      action: 'Configure the live Stripe key plus separate account and connected-account webhook secrets.',
    },
    {
      id: 'stripe-catalog',
      label: 'Subscription price catalog',
      detail: 'Launch, Pro, and Scale must point to active recurring Prices in the same Stripe mode as the key.',
      evidence: input.stripeCatalogDetail,
      status: catalogStatus,
      required: true,
      action: 'Open each Stripe product, copy its active recurring Price ID, update the matching STRIPE_PRICE_* setting, and redeploy.',
    },
    {
      id: 'approval-safety',
      label: 'Buyer approval enforcement',
      detail: 'Checkout and negotiation actions require a short-lived, payload-bound approval token.',
      evidence: input.actionApprovalSecret && input.actionApprovalRequired
        ? 'Signing secret and mandatory enforcement are active.'
        : 'The signing secret or mandatory enforcement flag is missing.',
      status: input.actionApprovalSecret && input.actionApprovalRequired ? 'ready' : 'blocked',
      required: true,
      action: 'Set NEXEZ_ACTION_APPROVAL_SECRET and NEXEZ_REQUIRE_ACTION_APPROVAL_TOKEN=true, then redeploy.',
    },
    {
      id: 'release-certification',
      label: 'Release certification ingress',
      detail: 'The post-deploy verifier writes signed, append-only evidence without exposing operational state publicly.',
      evidence: input.releaseCertificationSecret
        ? 'A dedicated release-certification secret is configured.'
        : 'The release-certification endpoint is dormant.',
      status: input.releaseCertificationSecret ? 'ready' : 'blocked',
      required: true,
      action: 'Set the same 32-byte NEXEZ_RELEASE_CERT_SECRET in production and GitHub Actions, then redeploy.',
    },
    {
      id: 'background-jobs',
      label: 'Background job authorization',
      detail: 'Reconciliation, negotiation processing, freshness, and integration workers fail closed behind one secret.',
      evidence: input.cronSecret ? 'Cron authorization is configured.' : 'Cron authorization is not configured.',
      status: input.cronSecret ? 'ready' : 'blocked',
      required: true,
      action: 'Set CRON_SECRET in production before enabling scheduled jobs.',
    },
    {
      id: 'transaction-email',
      label: 'Transaction email',
      detail: 'Receipts, negotiation notices, and money-state updates need a verified sender.',
      evidence: input.email ? 'Email provider and sender are configured.' : 'Email delivery is dormant.',
      status: input.email ? 'ready' : 'attention',
      required: true,
      action: 'Configure RESEND_API_KEY and EMAIL_FROM on a verified domain.',
    },
    {
      id: 'integration-encryption',
      label: 'Integration credential encryption',
      detail: 'Stored Calendly and Shopify credentials require a valid 32-byte encryption key.',
      evidence: input.integrationEncryption ? 'Credential encryption is active.' : 'Stored-credential integrations are dormant.',
      status: input.integrationEncryption ? 'ready' : 'attention',
      required: true,
      action: 'Set a valid INTEGRATION_SECRET_KEY and keep it stable across deploys.',
    },
    {
      id: 'observability',
      label: 'Operational alerting',
      detail: 'Runtime errors and worker events should leave the platform through the configured drain.',
      evidence: input.observability ? 'Observability drain is configured.' : 'Only function logs will receive errors.',
      status: input.observability ? 'ready' : 'attention',
      required: true,
      action: 'Configure OBSERVABILITY_WEBHOOK_URL and its token.',
    },
    {
      id: 'platform-hosts',
      label: 'Three-host routing',
      detail: 'Marketing, authenticated management, and agent runtime must stay on their intended hosts.',
      evidence: input.hostsAligned
        ? 'nexez.ai, app.nexez.ai, and nexez.app resolve to their intended roles.'
        : 'One or more canonical host settings do not match the production architecture.',
      status: input.hostsAligned ? 'ready' : 'blocked',
      required: true,
      action: 'Correct the public host environment settings before the next production deploy.',
    },
    {
      id: 'llm',
      label: 'LLM assistance',
      detail: 'Copilot and assisted negotiation can run deterministically without a model, but launch quality improves with one.',
      evidence: input.llm ? 'An LLM provider is configured.' : 'AI-enhanced paths will use deterministic fallbacks.',
      status: input.llm ? 'ready' : 'attention',
      required: false,
      action: 'Configure LLM_API_KEY when enhanced assistance is part of the launch offer.',
    },
  ]
}

export function buildOperationalChecks(
  metrics: LaunchMetrics,
  sources: LaunchSourceAvailability,
  nowIso: string,
): LaunchCheck[] {
  const endpointsEnabled = metrics.stripeWebhookEndpointsEnabled
  const endpointRolesCovered = metrics.stripeWebhookEndpointRolesCovered
  const refundEventsCovered = metrics.stripeWebhookRefundEventsCovered
  const endpointConfigurationBroken = [
    endpointsEnabled,
    endpointRolesCovered,
    refundEventsCovered,
  ].some((value) => value === false)
  const endpointConfigurationVerified = [
    endpointsEnabled,
    endpointRolesCovered,
    refundEventsCovered,
  ].every((value) => value === true)
  // Delivery health includes the Stripe-side configuration that makes refund
  // recovery possible. Traffic recency cannot prove an omitted event type.
  // A quiet account remains ready when both endpoint roles are enabled and every
  // matching destination subscribes to the required refund events.
  const webhookStatus: LaunchStatus = !sources.stripeWebhooks
    ? 'unknown'
    : endpointConfigurationBroken
      ? 'blocked'
      : endpointConfigurationVerified
        ? 'ready'
        : 'attention'

  const workerStatus: LaunchStatus = !sources.negotiations
    ? 'unknown'
    : metrics.staleNegotiationDecisions > 0
      ? 'blocked'
      : metrics.pendingNegotiationDecisions > 20
        ? 'attention'
        : 'ready'

  const shopifyStatus: LaunchStatus = !sources.shopify
    ? 'unknown'
    : metrics.shopifyErrors > 0
      ? 'blocked'
      : metrics.shopifyStale > 0 || metrics.shopifyPending > 10
        ? 'attention'
        : 'ready'

  const checkoutErrorStatus: LaunchStatus = !sources.checkoutEvents
    ? 'unknown'
    : metrics.checkoutStripeErrors24h >= 3
      ? 'blocked'
      : metrics.checkoutStripeErrors24h > 0
        ? 'attention'
        : 'ready'

  return [
    {
      id: 'stripe-delivery',
      label: 'Stripe event delivery',
      detail: 'Delivery health requires Stripe-verified account and connected-account endpoints with refund recovery event coverage.',
      evidence: !sources.stripeWebhooks
        ? 'Stripe event ledger is unavailable.'
        : endpointsEnabled === false
          ? `Stripe reports a disabled webhook destination among ${metrics.stripeWebhookEndpointCount ?? 0} matching endpoints.`
          : endpointRolesCovered === false
            ? `Stripe is missing the expected ${metrics.stripeWebhookMissingEndpointRoles.join(' and ')} webhook destination.`
            : refundEventsCovered === false
              ? `Stripe webhook destinations omit required events: ${metrics.stripeWebhookMissingRefundEvents.join(', ')}.`
              : endpointConfigurationVerified
                ? `${metrics.stripeWebhookEndpointCount} matching endpoints are enabled with account, connected-account, and refund event coverage${metrics.latestStripeWebhookAt ? `; ${metrics.stripeWebhookEvents} recorded events, latest ${relativeAge(metrics.latestStripeWebhookAt, nowIso)}` : '; no events recorded yet'}.`
                : metrics.latestStripeWebhookAt
                  ? `${metrics.stripeWebhookEvents} recorded events; latest ${relativeAge(metrics.latestStripeWebhookAt, nowIso)}, but full endpoint role and refund event coverage could not be verified.`
                  : 'No Stripe events are recorded and full endpoint role and refund event coverage could not be verified.',
      status: webhookStatus,
      required: true,
      action: 'Configure separate account and connected-account destinations for this route, enable every required refund event on both, and verify their signing secrets.',
    },
    {
      id: 'checkout-errors',
      label: 'Checkout error pressure',
      detail: 'Recent Stripe errors are counted independently from normal validation and provider handoffs.',
      evidence: sources.checkoutEvents
        ? `${metrics.checkoutStripeErrors24h} Stripe checkout errors in the last 24 hours.`
        : 'Checkout telemetry is unavailable.',
      status: checkoutErrorStatus,
      required: true,
      action: 'Inspect recent checkout incidents, seller Connect readiness, and Stripe request logs.',
    },
    {
      id: 'negotiation-worker',
      label: 'Negotiation decision worker',
      detail: 'The five-minute worker must clear any decision that outlives its normal asynchronous window.',
      evidence: sources.negotiations
        ? `${metrics.pendingNegotiationDecisions} pending; ${metrics.staleNegotiationDecisions} older than 10 minutes.`
        : 'Negotiation queue is unavailable.',
      status: workerStatus,
      required: true,
      action: 'Inspect the process-negotiations cron, LLM provider, and decision claim lease.',
    },
    {
      id: 'shopify-worker',
      label: 'Shopify catalog worker',
      detail: 'Product webhooks debounce into a recoverable, exact-shop sync queue.',
      evidence: sources.shopify
        ? `${metrics.shopifyInstalls} active installs; ${metrics.shopifyPending} queued; ${metrics.shopifyStale} stale; ${metrics.shopifyErrors} failed.`
        : 'Shopify queue is unavailable.',
      status: shopifyStatus,
      required: true,
      action: 'Inspect the Shopify catalog cron, app credentials, and the failed install row.',
    },
    {
      id: 'outbound-delivery',
      label: 'Seller webhook delivery',
      detail: 'Active seller endpoints should end on a successful delivery status.',
      evidence: sources.outboundWebhooks
        ? `${metrics.activeOutboundWebhooks} active endpoints; ${metrics.failedOutboundWebhooks} report a failed last delivery.`
        : 'Seller webhook state is unavailable.',
      status: !sources.outboundWebhooks
        ? 'unknown'
        : metrics.failedOutboundWebhooks > 0
          ? 'attention'
          : 'ready',
      required: false,
      action: 'Ask the seller to repair or disable endpoints that repeatedly reject signed deliveries.',
    },
    {
      id: 'protocol-sessions',
      label: 'Agent checkout sessions',
      detail: 'ACP and UCP session snapshots should complete or expire without remaining actionable.',
      evidence: sources.checkoutSessions
        ? `${metrics.expiredCheckoutSessions} expired sessions still remain in an actionable state.`
        : 'Agent checkout session state is unavailable.',
      status: !sources.checkoutSessions
        ? 'unknown'
        : metrics.expiredCheckoutSessions > 0
          ? 'attention'
          : 'ready',
      required: false,
      action: 'Expire or garbage-collect stale protocol sessions and inspect their originating agent requests.',
    },
    {
      id: 'support-pressure',
      label: 'Urgent support pressure',
      detail: 'Urgent unresolved tickets are launch signals even when the underlying service remains healthy.',
      evidence: sources.support
        ? `${metrics.urgentSupportTickets} urgent unresolved tickets.`
        : 'Support queue is unavailable.',
      status: !sources.support
        ? 'unknown'
        : metrics.urgentSupportTickets > 0
          ? 'attention'
          : 'ready',
      required: false,
      action: 'Triage urgent tickets before widening launch traffic.',
    },
  ]
}

export function buildMarketplaceCurationCheck(
  signal: MarketplaceCurationSignal,
  discoveryEnabled = MARKETPLACE_DISCOVERY_ENABLED,
): LaunchCheck {
  const target = MARKETPLACE_DISCOVERY_MERCHANT_THRESHOLD
  const certifiedMerchants = signal.summary.certifiedMerchants ?? 0
  const supplyReady = signal.available
    && certifiedMerchants >= target
    && signal.summary.unreviewed === 0
  const enabledTooEarly = signal.available && discoveryEnabled && !supplyReady
  const action = !signal.available
    ? 'Restore the marketplace curation ledger before making a launch decision.'
    : enabledTooEarly
      ? 'Disable NEXT_PUBLIC_MARKETPLACE_DISCOVERY_ENABLED until the merchant and review thresholds are met.'
      : !supplyReady
        ? `Certify at least ${target} unique merchants and clear the unreviewed queue.`
        : !discoveryEnabled
          ? 'Complete the final supply-breadth review, enable NEXT_PUBLIC_MARKETPLACE_DISCOVERY_ENABLED, and deploy.'
          : 'Continue monitoring merchant quality and supply breadth.'
  return {
    id: 'marketplace-curation',
    label: 'Marketplace launch supply',
    detail: 'Human Discovery stays hidden until enough unique merchants have an explicit quality decision.',
    evidence: signal.available
      ? `${certifiedMerchants} of ${target} certified merchants; ${signal.summary.certified} certified listings, ${signal.summary.candidate} candidates, ${signal.summary.unreviewed} unreviewed, and ${signal.summary.excluded} excluded. Human Discovery is ${discoveryEnabled ? 'enabled' : 'hidden'}.`
      : 'The marketplace curation ledger is unavailable.',
    status: !signal.available ? 'unknown' : enabledTooEarly ? 'blocked' : supplyReady ? 'ready' : 'attention',
    required: false,
    action,
  }
}

export function buildCertificationChecks(
  metrics: LaunchMetrics,
  sources: LaunchSourceAvailability,
  configuration: LaunchCheck[],
): LaunchCheck[] {
  const configStatus = (id: string) => configuration.find((check) => check.id === id)?.status ?? 'unknown'
  const directEvidenceAvailable = sources.orders && sources.orderEvents
  const operationsEvidenceAvailable = directEvidenceAvailable && sources.orderFulfillments && sources.orderRequests
  const paymentEvidence = directEvidenceAvailable && metrics.directPaymentLifecycles > 0
  const refundEvidence = directEvidenceAvailable && metrics.directRefundLifecycles > 0
  const escrowEvidence = sources.negotiations && metrics.paymentBackedNegotiations > 0

  return [
    {
      id: 'cert-approval',
      label: 'Approval-token gauntlet',
      detail: 'Dry runs must issue payload-bound tokens, while tokenless live checkout and negotiation requests return 403.',
      evidence: configStatus('approval-safety') === 'ready'
        ? 'Mandatory payload-bound enforcement is active; the release record still includes the automated request gauntlet.'
        : 'Production enforcement is not ready.',
      status: configStatus('approval-safety') === 'ready' ? 'ready' : 'blocked',
      required: true,
      action: 'Run npm run certify:commerce and retain the passing output with the release record.',
    },
    {
      id: 'cert-connect',
      label: 'Seller payout readiness',
      detail: 'At least one certification seller must accept charges and payouts through its own Connect account.',
      evidence: sources.billing
        ? `${metrics.connectChargeReady} charge-ready and ${metrics.connectPayoutReady} payout-ready seller accounts.`
        : 'Billing state is unavailable.',
      status: !sources.billing
        ? 'unknown'
        : metrics.connectChargeReady > 0 && metrics.connectPayoutReady > 0
          ? 'ready'
          : 'blocked',
      required: true,
      action: 'Complete Stripe Connect onboarding on the certification seller and wait for account.updated.',
    },
    {
      id: 'cert-direct-checkout',
      label: 'Direct checkout lifecycle',
      detail: 'A real low-value order must settle through the seller account and persist in the durable order ledger.',
      evidence: directEvidenceAvailable
        ? `${metrics.directPaymentLifecycles} live direct orders contain linked order-recorded and Stripe-confirmed payment events.`
        : 'Direct order or activity evidence is unavailable.',
      status: !directEvidenceAvailable ? 'unknown' : paymentEvidence ? 'ready' : 'attention',
      required: true,
      action: 'Complete one low-value live checkout and confirm the receipt, fee, order portal, and seller ledger.',
    },
    {
      id: 'cert-order-operations',
      label: 'Direct order operations lifecycle',
      detail: 'One live direct order must preserve payment, fulfilled work, a resolved buyer problem report, and refund evidence on the same lineage.',
      evidence: operationsEvidenceAvailable
        ? `${metrics.directOperationalLifecycles} complete lineages; ${metrics.directFulfillmentLifecycles} fulfilled; ${metrics.directIssueResolutionLifecycles} with resolved buyer issues.`
        : 'Order activity, fulfillment, or buyer-request evidence is unavailable.',
      status: !operationsEvidenceAvailable
        ? 'unknown'
        : metrics.directOperationalLifecycles > 0
          ? 'ready'
          : 'attention',
      required: true,
      action: 'On one certification order, mark fulfillment complete, resolve a buyer problem report, then complete the partial and full refund proof.',
    },
    {
      id: 'cert-escrow',
      label: 'Negotiation and escrow lifecycle',
      detail: 'A proposal must reach agreement, fund on the seller account, and reconcile into a terminal state.',
      evidence: sources.negotiations
        ? `${metrics.paymentBackedNegotiations} payment-backed negotiations; ${metrics.heldNegotiations} currently held.`
        : 'Negotiation evidence is unavailable.',
      status: !sources.negotiations ? 'unknown' : escrowEvidence ? 'ready' : 'attention',
      required: true,
      action: 'Run one low-value proposal through agreement, funding, capture, webhook sync, and reconciliation.',
    },
    {
      id: 'cert-refund',
      label: 'Partial and full refund lifecycle',
      detail: 'A direct order must contain distinct partial and full cumulative refund events; fee reversal and buyer notification remain owner-confirmed proof.',
      evidence: directEvidenceAvailable
        ? `${metrics.directRefundLifecycles} live direct orders prove a partial refund followed by the full cumulative total.`
        : 'Direct order or activity evidence is unavailable.',
      status: !directEvidenceAvailable ? 'unknown' : refundEvidence ? 'ready' : 'attention',
      required: true,
      action: 'Partially refund a captured certification order, verify the remainder, then finish the refund and confirm both ledgers.',
    },
    {
      id: 'cert-subscription',
      label: 'Subscription billing lifecycle',
      detail: 'A paid plan must subscribe, update through the webhook, open the billing portal, and cancel cleanly.',
      evidence: sources.billing
        ? `${metrics.subscriptionRecords} durable subscription records exist; ${metrics.activeSubscriptions} currently confer paid access.`
        : 'Subscription state is unavailable.',
      status: !sources.billing
        ? 'unknown'
        : configStatus('stripe-catalog') === 'blocked'
          ? 'blocked'
          : metrics.subscriptionRecords > 0
            ? 'ready'
            : 'attention',
      required: true,
      action: 'Use the authenticated certification account to subscribe, verify webhook sync, open the portal, and cancel.',
    },
    {
      id: 'cert-price-sync',
      label: 'Stripe price synchronization',
      detail: 'A Stripe default-price replacement should reach Nexez and leave both webhook and listing audit evidence.',
      evidence: sources.stripeWebhooks
        ? `${metrics.stripePriceWebhookEvents} Stripe catalog webhook events and ${metrics.stripePriceSyncEvents} linked-offer audit events are present.`
        : 'Stripe webhook evidence is unavailable.',
      status: !sources.stripeWebhooks
        ? 'unknown'
        : metrics.stripePriceWebhookEvents > 0 && metrics.stripePriceSyncEvents > 0
          ? 'ready'
          : 'attention',
      required: false,
      action: 'Replace a certification Product default Price and confirm the linked offer and checkout audit event change once.',
    },
    {
      id: 'cert-reservable-resource',
      label: 'Reservable resource lifecycle',
      detail: 'A resource settlement requires one live order, committed hold, and linked reservation with the same authority chain.',
      evidence: sources.orders && sources.resourcePools && sources.resourceHolds && sources.resourceReservations
        ? `${metrics.resourcePoolsConfigured} active pools; ${metrics.resourceHoldsOpen} open holds; ${metrics.resourceSettlements} proven settlements; ${metrics.resourceHoldsExpired} expired; ${metrics.resourceHoldsFailed} failed; ${metrics.resourceHoldsCancelled} cancelled.`
        : 'Reservable resource evidence is unavailable.',
      status: !sources.orders || !sources.resourcePools || !sources.resourceHolds || !sources.resourceReservations
        ? 'unknown'
        : metrics.resourceSettlements > 0
          ? 'ready'
          : 'attention',
      required: false,
      action: 'Run one low-value reservable checkout, then confirm the live order, committed hold, reservation, and replay-safe linkage.',
    },
    {
      id: 'cert-staged-settlement',
      label: 'Staged settlement lifecycle',
      detail: 'A staged agreement is proven only when every obligation is live-paid and linked to its own settled order.',
      evidence: sources.orders && sources.stagedSettlementAgreements && sources.stagedSettlementObligations
        ? `${metrics.stagedSettlementAgreements} agreements; ${metrics.stagedSettlementAgreementsOpen} open; ${metrics.stagedSettlementSettlements} fully proven; ${metrics.stagedSettlementObligationsPaid} live-paid obligations; ${metrics.stagedSettlementFailures} cancelled or disputed.`
        : 'Staged settlement evidence is unavailable.',
      status: !sources.orders || !sources.stagedSettlementAgreements || !sources.stagedSettlementObligations
        ? 'unknown'
        : metrics.stagedSettlementSettlements > 0
          ? 'ready'
          : 'attention',
      required: false,
      action: 'Complete one low-value staged agreement with fresh approval for every obligation, then confirm every live order link.',
    },
    {
      id: 'cert-protocol',
      label: 'ACP and UCP delegated checkout',
      detail: 'Adapter checks, sandbox lifecycle evidence, and real delegated-payment proof are separate gates.',
      evidence: sources.orders && sources.orderEvents
        ? `Delegated proof: ${metrics.acpDelegatedPayments} ACP SPT and ${metrics.ucpDelegatedPayments} UCP Google Pay orders. Ledger counts: ACP ${metrics.acpLiveProtocolOrders} live and ${metrics.acpSandboxProtocolOrders} sandbox; UCP ${metrics.ucpLiveProtocolOrders} live and ${metrics.ucpSandboxProtocolOrders} sandbox.`
        : 'Protocol order or credential evidence is unavailable.',
      status: !sources.orders || !sources.orderEvents
        ? 'unknown'
        : metrics.acpDelegatedPayments > 0 && metrics.ucpDelegatedPayments > 0
          ? 'ready'
          : 'attention',
      required: false,
      action: 'Run npm run certify:protocol-adapters. After enrollment, deliberately complete the owner-run ACP SPT smoke test. Keep UCP checkout off until its declared handler and gateway processing path are certified.',
    },
  ]
}

export function summarizeLaunchChecks(checks: LaunchCheck[]): LaunchSummary {
  const counts: Record<LaunchStatus, number> = { ready: 0, attention: 0, blocked: 0, unknown: 0 }
  for (const check of checks) counts[check.status] += 1

  const required = checks.filter((check) => check.required)
  const weighted = required.reduce((sum, check) => sum + READY_WEIGHT[check.status], 0)
  const score = required.length ? Math.round((weighted / required.length) * 100) : 0
  const status: LaunchStatus = required.some((check) => check.status === 'blocked')
    ? 'blocked'
    : required.some((check) => check.status !== 'ready')
      ? 'attention'
      : 'ready'

  return { status, score, ...counts }
}

export function ageHours(value: string | null, nowIso: string): number | null {
  if (!value) return null
  const occurred = Date.parse(value)
  const now = Date.parse(nowIso)
  if (!Number.isFinite(occurred) || !Number.isFinite(now)) return null
  return Math.max(0, (now - occurred) / 3_600_000)
}

export function relativeAge(value: string, nowIso: string): string {
  const hours = ageHours(value, nowIso)
  if (hours == null) return 'at an unknown time'
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m ago`
  if (hours < 48) return `${Math.round(hours)}h ago`
  return `${Math.round(hours / 24)}d ago`
}

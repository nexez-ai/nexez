import { describe, expect, it } from 'vitest'
import { buildCertificationChecks, buildOperationalChecks, type LaunchMetrics, type LaunchSourceAvailability } from '../launch-control'

const NOW = '2026-08-10T00:00:00.000Z'
const hoursAgo = (h: number) => new Date(Date.parse(NOW) - h * 3_600_000).toISOString()

const baseMetrics: LaunchMetrics = {
  stripeWebhookEvents: 0,
  latestStripeWebhookAt: null,
  stripeWebhookEndpointsEnabled: null,
  stripeWebhookEndpointRolesCovered: null,
  stripeWebhookRefundEventsCovered: null,
  stripeWebhookEndpointCount: null,
  stripeWebhookMissingEndpointRoles: [],
  stripeWebhookMissingRefundEvents: [],
  stripePriceWebhookEvents: 0,
  stripePriceSyncEvents: 0,
  checkoutStripeErrors24h: 0,
  checkoutOrders: 0,
  directOrders: 0,
  paidOrders: 0,
  refundedOrders: 0,
  disputedOrders: 0,
  directPaymentLifecycles: 0,
  directFulfillmentLifecycles: 0,
  directIssueResolutionLifecycles: 0,
  directRefundLifecycles: 0,
  directOperationalLifecycles: 0,
  protocolOrders: 0,
  sandboxProtocolOrders: 0,
  acpLiveProtocolOrders: 0,
  ucpLiveProtocolOrders: 0,
  acpSandboxProtocolOrders: 0,
  ucpSandboxProtocolOrders: 0,
  acpDelegatedPayments: 0,
  ucpDelegatedPayments: 0,
  negotiations: 0,
  pendingNegotiationDecisions: 0,
  staleNegotiationDecisions: 0,
  completedNegotiations: 0,
  heldNegotiations: 0,
  paymentBackedNegotiations: 0,
  refundedNegotiations: 0,
  activeSubscriptions: 0,
  subscriptionRecords: 0,
  connectChargeReady: 0,
  connectPayoutReady: 0,
  shopifyInstalls: 0,
  shopifyPending: 0,
  shopifyStale: 0,
  shopifyErrors: 0,
  activeOutboundWebhooks: 0,
  failedOutboundWebhooks: 0,
  urgentSupportTickets: 0,
  expiredCheckoutSessions: 0,
  resourcePoolsConfigured: 0,
  resourceHoldsOpen: 0,
  resourceHoldsExpired: 0,
  resourceHoldsFailed: 0,
  resourceHoldsCancelled: 0,
  resourceSettlements: 0,
  stagedSettlementAgreements: 0,
  stagedSettlementAgreementsOpen: 0,
  stagedSettlementObligationsPaid: 0,
  stagedSettlementSettlements: 0,
  stagedSettlementFailures: 0,
}

const allSources: LaunchSourceAvailability = {
  stripeWebhooks: true,
  checkoutEvents: true,
  orders: true,
  orderEvents: true,
  orderFulfillments: true,
  orderRequests: true,
  negotiations: true,
  billing: true,
  shopify: true,
  outboundWebhooks: true,
  support: true,
  checkoutSessions: true,
  resourcePools: true,
  resourceHolds: true,
  resourceReservations: true,
  stagedSettlementAgreements: true,
  stagedSettlementObligations: true,
}

function stripeDelivery(overrides: Partial<LaunchMetrics>, sources: LaunchSourceAvailability = allSources) {
  const checks = buildOperationalChecks({ ...baseMetrics, ...overrides }, sources, NOW)
  const check = checks.find((c) => c.id === 'stripe-delivery')
  if (!check) throw new Error('stripe-delivery check missing')
  return check
}

describe('stripe-delivery launch check', () => {
  it('is unknown when the ledger source is unavailable', () => {
    const check = stripeDelivery({}, { ...allSources, stripeWebhooks: false })
    expect(check.status).toBe('unknown')
  })

  it('BLOCKS when Stripe reports an endpoint disabled, regardless of ledger recency', () => {
    const fresh = stripeDelivery({
      stripeWebhookEndpointsEnabled: false,
      stripeWebhookEndpointCount: 2,
      stripeWebhookEvents: 50,
      latestStripeWebhookAt: hoursAgo(1),
    })
    expect(fresh.status).toBe('blocked')
    expect(fresh.evidence).toMatch(/disabled webhook destination among 2 matching endpoints/)
  })

  it('does not treat recent unrelated traffic as proof of refund event coverage', () => {
    const check = stripeDelivery({
      stripeWebhookEvents: 12,
      latestStripeWebhookAt: hoursAgo(2),
      stripeWebhookEndpointsEnabled: null,
    })
    expect(check.status).toBe('attention')
    expect(check.evidence).toMatch(/could not be verified/)
  })

  it('stays ready on an idle ledger when Stripe verifies both roles and refund events', () => {
    const check = stripeDelivery({
      stripeWebhookEvents: 71,
      latestStripeWebhookAt: hoursAgo(10 * 24), // 10 days silent - the real production incident shape
      stripeWebhookEndpointsEnabled: true,
      stripeWebhookEndpointRolesCovered: true,
      stripeWebhookRefundEventsCovered: true,
      stripeWebhookEndpointCount: 2,
    })
    expect(check.status).toBe('ready')
    expect(check.evidence).toMatch(/2 matching endpoints are enabled/)
  })

  it('degrades to attention when endpoint coverage is unverifiable', () => {
    const check = stripeDelivery({
      stripeWebhookEvents: 71,
      latestStripeWebhookAt: hoursAgo(10 * 24),
      stripeWebhookEndpointsEnabled: null,
    })
    expect(check.status).toBe('attention')
  })

  it('requires endpoint roles and refund events even when endpoints report enabled', () => {
    expect(stripeDelivery({ stripeWebhookEvents: 0, stripeWebhookEndpointsEnabled: true }).status).toBe('attention')
    expect(stripeDelivery({
      stripeWebhookEvents: 0,
      stripeWebhookEndpointsEnabled: true,
      stripeWebhookEndpointRolesCovered: true,
      stripeWebhookRefundEventsCovered: true,
      stripeWebhookEndpointCount: 2,
    }).status).toBe('ready')
    expect(stripeDelivery({ stripeWebhookEvents: 0, stripeWebhookEndpointsEnabled: null }).status).toBe('attention')
  })

  it('blocks a missing connected-account destination', () => {
    const check = stripeDelivery({
      stripeWebhookEndpointsEnabled: true,
      stripeWebhookEndpointRolesCovered: false,
      stripeWebhookRefundEventsCovered: true,
      stripeWebhookEndpointCount: 1,
      stripeWebhookMissingEndpointRoles: ['connected-account'],
    })
    expect(check.status).toBe('blocked')
    expect(check.evidence).toMatch(/connected-account/)
  })

  it('blocks any required refund event omitted by a destination', () => {
    const check = stripeDelivery({
      stripeWebhookEndpointsEnabled: true,
      stripeWebhookEndpointRolesCovered: true,
      stripeWebhookRefundEventsCovered: false,
      stripeWebhookEndpointCount: 2,
      stripeWebhookMissingRefundEvents: ['refund.failed'],
    })
    expect(check.status).toBe('blocked')
    expect(check.evidence).toMatch(/refund\.failed/)
  })
})

function protocolCertification(overrides: Partial<LaunchMetrics>, sources: LaunchSourceAvailability = allSources) {
  const checks = buildCertificationChecks({ ...baseMetrics, ...overrides }, sources, [])
  const check = checks.find((candidate) => candidate.id === 'cert-protocol')
  if (!check) throw new Error('cert-protocol check missing')
  return check
}

describe('protocol certification evidence', () => {
  it('does not treat one sandbox order per channel as delegated-payment proof', () => {
    const check = protocolCertification({
      sandboxProtocolOrders: 2,
      acpSandboxProtocolOrders: 1,
      ucpSandboxProtocolOrders: 1,
    })
    expect(check.status).toBe('attention')
    expect(check.evidence).toMatch(/Delegated proof: 0 ACP SPT and 0 UCP Google Pay orders/)
  })

  it('does not infer credential kind from live protocol orders', () => {
    const check = protocolCertification({
      protocolOrders: 2,
      acpLiveProtocolOrders: 1,
      ucpLiveProtocolOrders: 1,
    })
    expect(check.status).toBe('attention')
    expect(check.evidence).toMatch(/Delegated proof: 0 ACP SPT and 0 UCP Google Pay orders/)
  })

  it('becomes ready only when both channels have token-free delegated proof events', () => {
    const check = protocolCertification({ acpDelegatedPayments: 1, ucpDelegatedPayments: 1 })
    expect(check.status).toBe('ready')
  })

  it('is unknown when the order ledger cannot be read', () => {
    const check = protocolCertification({}, { ...allSources, orders: false })
    expect(check.status).toBe('unknown')
  })
})

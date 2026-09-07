import { describe, expect, it } from 'vitest'
import type { LaunchControlSnapshot } from './launch-control'
import {
  buildMachineLaunchHealth,
  buildReleaseCertificationDecision,
  type ReleaseDeploymentIdentity,
  type ReleaseProbe,
} from './release-certification'

const deployment: ReleaseDeploymentIdentity = {
  revision: 'a'.repeat(40),
  deploymentId: 'dpl_123',
  deploymentUrl: 'https://nexez.example.vercel.app',
  environment: 'production',
}

const passingProbe: ReleaseProbe = {
  id: 'public-hosts',
  label: 'Public hosts',
  status: 'pass',
  required: true,
  durationMs: 42,
}

function check(id: string, status: 'ready' | 'attention' | 'blocked' | 'unknown' = 'ready') {
  return {
    id,
    label: id,
    detail: 'detail',
    evidence: 'redacted evidence',
    status,
    required: true,
  } as const
}

function snapshot(overrides: Partial<LaunchControlSnapshot> = {}): LaunchControlSnapshot {
  return {
    generatedAt: '2026-07-18T12:00:00.000Z',
    environment: {
      stripeMode: 'live',
      marketingHost: 'nexez.ai',
      appHost: 'app.nexez.ai',
      agentHost: 'nexez.app',
    },
    configuration: [check('config')],
    operations: [check('worker')],
    certification: [check('commerce')],
    summary: { status: 'ready', score: 100, ready: 3, attention: 0, blocked: 0, unknown: 0 },
    metrics: {
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
    },
    sources: {
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
    },
    supportQueue: [],
    incidents: [],
    ...overrides,
  }
}

describe('machine launch health', () => {
  it('returns redacted required-check state and safe Stripe coverage metadata', () => {
    const health = buildMachineLaunchHealth(snapshot({
      supportQueue: [{
        id: 'ticket-private',
        subject: 'Private seller support subject',
        severity: 'normal',
        createdAt: '2026-07-18T11:00:00.000Z',
        serviceTier: 'priority',
        planId: 'scale',
      }],
    }), deployment)
    expect(health.ok).toBe(true)
    expect(health.requiredChecks).toEqual([
      expect.objectContaining({ area: 'configuration', id: 'config', status: 'ready' }),
      expect.objectContaining({ area: 'operations', id: 'worker', status: 'ready' }),
      expect.objectContaining({ area: 'certification', id: 'commerce', status: 'ready' }),
    ])
    expect(JSON.stringify(health)).not.toContain('redacted evidence')
    expect(JSON.stringify(health)).not.toContain('Private seller support subject')
    expect(health.stripeWebhookConfiguration).toEqual({
      stripeWebhookEndpointsEnabled: null,
      stripeWebhookEndpointRolesCovered: null,
      stripeWebhookRefundEventsCovered: null,
      stripeWebhookEndpointCount: null,
      stripeWebhookMissingEndpointRoles: [],
      stripeWebhookMissingRefundEvents: [],
    })
  })

  it('identifies every required launch blocker', () => {
    const blocked = snapshot({
      operations: [check('worker', 'blocked')],
      summary: { status: 'blocked', score: 67, ready: 2, attention: 0, blocked: 1, unknown: 0 },
    })
    const health = buildMachineLaunchHealth(blocked, deployment)
    expect(health.ok).toBe(false)
    expect(health.blockers).toEqual([
      expect.objectContaining({ area: 'operations', id: 'worker', status: 'blocked' }),
    ])
  })
})

describe('release certification decision', () => {
  it('passes only when probes, Launch Control, environment, and revision agree', () => {
    const decision = buildReleaseCertificationDecision(
      snapshot(),
      [passingProbe],
      deployment.revision!,
      deployment,
    )
    expect(decision).toMatchObject({ status: 'passed', requiredFailureCount: 0 })
  })

  it('fails on a skipped required probe, even when Launch Control is green', () => {
    const decision = buildReleaseCertificationDecision(
      snapshot(),
      [{ ...passingProbe, status: 'skip' }],
      deployment.revision!,
      deployment,
    )
    expect(decision.status).toBe('failed')
    expect(decision.requiredProbeFailures).toHaveLength(1)
  })

  it('fails closed when the deployed revision or environment cannot be proven', () => {
    const decision = buildReleaseCertificationDecision(
      snapshot(),
      [passingProbe],
      'b'.repeat(40),
      { ...deployment, environment: 'preview' },
    )
    expect(decision.status).toBe('failed')
    expect(decision.launchFailures.map((item) => item.id)).toEqual([
      'production-environment',
      'deployed-revision',
    ])
  })

  it('does not let passing external probes hide a required Launch Control warning', () => {
    const unhealthy = snapshot({
      certification: [check('commerce', 'attention')],
      summary: { status: 'attention', score: 85, ready: 2, attention: 1, blocked: 0, unknown: 0 },
    })
    const decision = buildReleaseCertificationDecision(
      unhealthy,
      [passingProbe],
      deployment.revision!,
      deployment,
    )
    expect(decision.status).toBe('failed')
    expect(decision.launchFailures).toEqual([
      expect.objectContaining({ area: 'certification', id: 'commerce', status: 'attention' }),
    ])
  })
})

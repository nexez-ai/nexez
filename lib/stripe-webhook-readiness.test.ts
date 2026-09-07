import { describe, expect, it } from 'vitest'
import {
  STRIPE_REFUND_WEBHOOK_EVENTS,
  evaluateStripeWebhookEndpointReadiness,
  listStripeWebhookEndpoints,
  type StripeWebhookEndpointInput,
} from './stripe-webhook-readiness'

const options = {
  allowedHosts: ['app.nexez.ai', 'nexez.app'],
  expectedRoles: { account: true, connectedAccount: true },
}

function endpoint(overrides: StripeWebhookEndpointInput = {}): StripeWebhookEndpointInput {
  return {
    url: 'https://app.nexez.ai/api/webhooks/stripe',
    status: 'enabled',
    enabled_events: [...STRIPE_REFUND_WEBHOOK_EVENTS],
    application: null,
    ...overrides,
  }
}

describe('evaluateStripeWebhookEndpointReadiness', () => {
  it('passes enabled account and connected-account destinations with every refund event', () => {
    const result = evaluateStripeWebhookEndpointReadiness([
      endpoint(),
      endpoint({
        url: 'https://nexez.app/api/webhooks/stripe',
        application: 'ca_test',
      }),
    ], options)

    expect(result).toEqual({
      matchingEndpointCount: 2,
      endpointsEnabled: true,
      endpointRolesCovered: true,
      refundEventsCovered: true,
      missingEndpointRoles: [],
      missingRefundEvents: [],
    })
  })

  it('accepts Stripe wildcard event coverage', () => {
    const result = evaluateStripeWebhookEndpointReadiness([
      endpoint({ enabled_events: ['*'] }),
      endpoint({ application: 'ca_test', enabled_events: ['*'] }),
    ], options)

    expect(result.refundEventsCovered).toBe(true)
  })

  it('reports an event omitted by any matching destination', () => {
    const result = evaluateStripeWebhookEndpointReadiness([
      endpoint(),
      endpoint({
        application: 'ca_test',
        enabled_events: STRIPE_REFUND_WEBHOOK_EVENTS.filter((event) => event !== 'refund.failed'),
      }),
    ], options)

    expect(result.refundEventsCovered).toBe(false)
    expect(result.missingRefundEvents).toEqual(['refund.failed'])
  })

  it('reports a missing connected-account destination even when two account endpoints exist', () => {
    const result = evaluateStripeWebhookEndpointReadiness([
      endpoint(),
      endpoint({ url: 'https://nexez.app/api/webhooks/stripe' }),
    ], options)

    expect(result.endpointRolesCovered).toBe(false)
    expect(result.missingEndpointRoles).toEqual(['connected-account'])
  })

  it('blocks disabled matching destinations', () => {
    const result = evaluateStripeWebhookEndpointReadiness([
      endpoint(),
      endpoint({ application: 'ca_test', status: 'disabled' }),
    ], options)

    expect(result.endpointsEnabled).toBe(false)
  })

  it('rejects query-string, wrong-host, insecure, credentialed, and malformed lookalikes', () => {
    const lookalikes = [
      endpoint({ url: 'https://evil.example/?next=/api/webhooks/stripe' }),
      endpoint({ url: 'https://app.nexez.ai/api/webhooks/stripe?source=other' }),
      endpoint({ url: 'http://app.nexez.ai/api/webhooks/stripe' }),
      endpoint({ url: 'https://user:pass@app.nexez.ai/api/webhooks/stripe' }),
      endpoint({ url: 'not a url' }),
    ]
    const result = evaluateStripeWebhookEndpointReadiness(lookalikes, options)

    expect(result.matchingEndpointCount).toBe(0)
    expect(result.endpointsEnabled).toBeNull()
    expect(result.endpointRolesCovered).toBeNull()
    expect(result.refundEventsCovered).toBeNull()
  })

  it('does not claim event coverage when Stripe omits an event list', () => {
    const result = evaluateStripeWebhookEndpointReadiness([
      endpoint(),
      endpoint({ application: 'ca_test', enabled_events: undefined }),
    ], options)

    expect(result.refundEventsCovered).toBeNull()
    expect(result.missingRefundEvents).toEqual([])
  })
})

describe('listStripeWebhookEndpoints', () => {
  it('reads later pages so a hidden broken destination cannot pass readiness', async () => {
    const requestedUrls: URL[] = []
    const fetchImpl = async (input: string | URL | Request) => {
      const url = new URL(String(input))
      requestedUrls.push(url)
      const secondPage = Boolean(url.searchParams.get('starting_after'))
      return Response.json(secondPage
        ? {
            has_more: false,
            data: [endpoint({
              id: 'we_second',
              application: 'ca_test',
              enabled_events: STRIPE_REFUND_WEBHOOK_EVENTS.filter((event) => event !== 'refund.failed'),
            })],
          }
        : {
            has_more: true,
            data: [endpoint({ id: 'we_first' })],
          })
    }

    const endpoints = await listStripeWebhookEndpoints('sk_test_safe', { fetchImpl })
    expect(requestedUrls).toHaveLength(2)
    expect(requestedUrls[1].searchParams.get('starting_after')).toBe('we_first')
    expect(evaluateStripeWebhookEndpointReadiness(endpoints ?? [], options).refundEventsCovered).toBe(false)
  })

  it('returns unverifiable when Stripe claims another page without a usable cursor', async () => {
    const endpoints = await listStripeWebhookEndpoints('sk_test_safe', {
      fetchImpl: async () => Response.json({
        has_more: true,
        data: [endpoint()],
      }),
    })

    expect(endpoints).toBeNull()
  })

  it('returns unverifiable instead of accepting a list beyond the bounded page cap', async () => {
    const endpoints = await listStripeWebhookEndpoints('sk_test_safe', {
      maxPages: 1,
      fetchImpl: async () => Response.json({
        has_more: true,
        data: [endpoint({ id: 'we_first' })],
      }),
    })

    expect(endpoints).toBeNull()
  })
})

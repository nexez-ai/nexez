import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'
import { createSupabaseMock } from '../../../../test/supabase-mock'

const refs = vi.hoisted(() => ({
  adminHandler: vi.fn(),
}))

const rateLimitRef = vi.hoisted(() => ({ response: null as NextResponse | null }))
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }))
vi.mock('../../../../lib/rate-limit', () => ({
  enforceRateLimit: vi.fn(async () => rateLimitRef.response),
}))
vi.mock('../../../../utils/supabase/server', () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'owner-1' } } })) },
  })),
}))
vi.mock('../../../../utils/supabase/admin', () => ({
  hasSupabaseAdminEnv: vi.fn(() => true),
  createAdminClient: vi.fn(() => createSupabaseMock(refs.adminHandler)),
}))
vi.mock('../../../../lib/server/shopify-billing', () => ({
  getOwnerShopifyBillingContext: vi.fn(async () => null),
}))

import { POST } from './route'
import { getOwnerShopifyBillingContext } from '../../../../lib/server/shopify-billing'

const request = () => new Request('https://nexez.test/api/billing/start-trial', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ plan: 'pro' }),
})

describe('POST /api/billing/start-trial', () => {
  beforeEach(() => {
    rateLimitRef.response = null
    vi.clearAllMocks()
    vi.mocked(getOwnerShopifyBillingContext).mockResolvedValue(null)
    refs.adminHandler.mockImplementation((query) => {
      if (query.op === 'select') return { data: null, error: null }
      return { data: { plan_id: 'pro', status: 'trialing', trial_ends_at: '2026-08-29T00:00:00.000Z' }, error: null }
    })
  })

  it('maps an entitlement allocation race to a retryable conflict', async () => {
    refs.adminHandler.mockImplementation((query) => {
      if (query.op === 'select') return { data: null, error: null }
      return {
        data: null,
        error: { code: '40001', message: 'NEXEZ_ENTITLEMENT_ALLOCATION_RETRY' },
      }
    })

    const response = await POST(request())

    expect(response.status).toBe(409)
    expect(response.headers.get('retry-after')).toBe('1')
    await expect(response.json()).resolves.toMatchObject({
      code: 'entitlement_allocation_retry',
      retryable: true,
    })
  })

  it('blocks Nexez trial allocation for Shopify-linked owners', async () => {
    vi.mocked(getOwnerShopifyBillingContext).mockResolvedValue({
      provider: 'shopify',
      shop: 'review.myshopify.com',
      pricingUrl: 'https://admin.shopify.com/store/review/charges/nexez-agent-ready/pricing_plans',
      planHandle: 'free',
      status: 'free',
      verifiedAt: '2026-08-28T00:00:00.000Z',
    })

    const response = await POST(request())

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ provider: 'shopify' })
  })
})

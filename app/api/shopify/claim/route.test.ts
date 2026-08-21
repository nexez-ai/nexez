import { beforeEach, describe, expect, it, vi } from 'vitest'

const jar = { set: vi.fn(), get: vi.fn(), delete: vi.fn() }
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => jar) }))
vi.mock('../../../../lib/rate-limit', () => ({ enforceRateLimit: vi.fn(async () => null) }))
vi.mock('../../../../lib/site', () => ({ appUrl: (path: string) => `https://app.nexez.ai${path}` }))
vi.mock('../../../../lib/server/shopify', () => ({
  shopifyConfigured: vi.fn(() => true),
  signPendingShop: vi.fn((shop: string) => `signed:${shop}`),
}))
vi.mock('../../../../lib/server/shopify-install', () => ({ consumeShopifyLinkToken: vi.fn() }))
vi.mock('../../../../utils/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({})),
  hasSupabaseAdminEnv: vi.fn(() => true),
}))
vi.mock('../../../../utils/supabase/server', () => ({
  createClient: vi.fn(() => ({ auth: { getUser: vi.fn(async () => ({ data: { user: null } })) } })),
}))

import { GET } from './route'
import { consumeShopifyLinkToken } from '../../../../lib/server/shopify-install'

describe('GET /api/shopify/claim', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(consumeShopifyLinkToken).mockResolvedValue('demo.myshopify.com')
  })

  it('consumes the one-time token before issuing the top-level link cookie', async () => {
    const response = await GET(new Request('https://app.nexez.ai/api/shopify/claim?token=opaque-token'))

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toContain('/login?next=/shopify/link')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(consumeShopifyLinkToken).toHaveBeenCalledWith(expect.anything(), 'opaque-token')
    expect(jar.set).toHaveBeenCalledWith('shopify_pending_shop', 'signed:demo.myshopify.com', expect.objectContaining({ httpOnly: true }))
  })

  it('does not issue a cookie for an expired or replayed token', async () => {
    vi.mocked(consumeShopifyLinkToken).mockResolvedValue(null)
    const response = await GET(new Request('https://app.nexez.ai/api/shopify/claim?token=replayed'))

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toContain('shopify_link_expired')
    expect(jar.set).not.toHaveBeenCalled()
  })
})

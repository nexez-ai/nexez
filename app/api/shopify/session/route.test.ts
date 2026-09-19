import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSupabaseMock } from '../../../../test/supabase-mock'

vi.mock('../../../../lib/rate-limit', () => ({ enforceRateLimit: vi.fn(async () => null) }))
vi.mock('../../../../lib/server/secret-crypto', () => ({ hasSecretCryptoKey: vi.fn(() => true) }))
vi.mock('../../../../lib/server/shopify', () => ({
  shopifyApiKey: vi.fn(() => 'client-id'),
  shopifyConfigured: vi.fn(() => true),
  verifyShopifySessionToken: vi.fn(),
}))
vi.mock('../../../../lib/server/shopify-install', () => ({
  ensureShopifySessionInstall: vi.fn(),
  getShopifyInstallCredentialsByShop: vi.fn(async () => null),
  issueShopifyLinkToken: vi.fn(async () => 'link-token'),
}))
vi.mock('../../../../lib/server/shopify-channel', () => ({
  ensureShopifySalesChannel: vi.fn(),
}))
vi.mock('../../../../lib/server/shopify-billing', () => ({
  shopifyPartnerBillingConfigured: vi.fn(() => false),
  shopifyPricingUrl: vi.fn((shop: string) => `https://admin.shopify.com/store/${shop.split('.')[0]}/charges/nexez-agent-ready/pricing_plans`),
  verifyShopifyBilling: vi.fn(),
}))
vi.mock('../../../../utils/supabase/admin', () => ({
  createAdminClient: vi.fn(),
  hasSupabaseAdminEnv: vi.fn(() => true),
}))

import { POST } from './route'
import { verifyShopifySessionToken } from '../../../../lib/server/shopify'
import {
  ensureShopifySessionInstall,
  getShopifyInstallCredentialsByShop,
  issueShopifyLinkToken,
} from '../../../../lib/server/shopify-install'
import { ensureShopifySalesChannel } from '../../../../lib/server/shopify-channel'
import { createAdminClient } from '../../../../utils/supabase/admin'

const request = () => new Request('https://app.nexez.ai/api/shopify/session', {
  method: 'POST',
  headers: { authorization: 'Bearer session-token' },
})

describe('POST /api/shopify/session', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getShopifyInstallCredentialsByShop).mockResolvedValue(null)
    vi.mocked(ensureShopifySalesChannel).mockReset()
    vi.mocked(verifyShopifySessionToken).mockReturnValue({
      shop: 'demo.myshopify.com',
      userId: '42',
      sessionId: 'session-1',
      expiresAt: 9999999999,
    })
    vi.mocked(createAdminClient).mockReturnValue(createSupabaseMock(() => ({ data: null, error: null })) as any)
  })

  it('rejects a request without a valid App Bridge session', async () => {
    vi.mocked(verifyShopifySessionToken).mockReturnValue(null)
    const response = await POST(request())
    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('returns a one-time top-level account-link URL for an unlinked install', async () => {
    vi.mocked(ensureShopifySessionInstall).mockResolvedValue({
      shop_domain: 'demo.myshopify.com',
      owner_id: null,
      page_id: null,
      scope: 'read_products,write_app_proxy',
      uninstalled_at: null,
    })

    const response = await POST(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.state).toBe('link_required')
    expect(body.connectUrl).toContain('/api/shopify/claim?token=link-token')
    expect(issueShopifyLinkToken).toHaveBeenCalledWith(expect.anything(), 'demo.myshopify.com')
  })

  it('returns listing and sync state without minting a link token once connected', async () => {
    vi.mocked(createAdminClient).mockReturnValue(createSupabaseMock((ctx) => ({
      data: ctx.table === 'pages' ? {
        id: 'page-1', name: 'Demo', slug: 'demo', is_published: true,
        products: [{ name: 'Test mug', price: '$18.00', source: 'shopify',
          url: 'https://demo.myshopify.com/products/mug',
          metadata: { shopify_shop: 'demo.myshopify.com', shopify_mapping_generation: 2 },
          rules: { minPrice: '$1.00' },
        }],
      } : null,
      error: null,
    })) as any)
    vi.mocked(ensureShopifySessionInstall).mockResolvedValue({
      shop_domain: 'demo.myshopify.com',
      owner_id: 'owner-1',
      page_id: 'page-1',
      mapping_generation: 2,
      scope: 'read_products,write_app_proxy',
      uninstalled_at: null,
      last_synced_at: '2026-07-13T18:00:00Z',
      catalog_sync_pending_at: null,
      catalog_sync_attempts: 0,
      catalog_sync_error: null,
      channel_id: 'gid://shopify/Channel/1',
      channel_handle: 'nexez-page1',
      channel_specification_handle: 'nexez-us',
      channel_connected_at: '2026-07-13T17:00:00Z',
    })
    vi.mocked(getShopifyInstallCredentialsByShop).mockResolvedValue({
      shop: 'demo.myshopify.com',
      accessToken: 'access-token',
    })
    vi.mocked(ensureShopifySalesChannel).mockResolvedValue({
      id: 'gid://shopify/Channel/1',
      handle: 'nexez-page1',
      accountId: 'page-1',
      accountName: 'Demo',
      specificationHandle: 'nexez-us',
      connectedAt: '2026-09-03T18:00:00Z',
    })

    const body = await (await POST(request())).json()
    expect(body).toMatchObject({
      state: 'linked',
      listing: { id: 'page-1', name: 'Demo', slug: 'demo' },
      catalog: { published: true, products: [{ name: 'Test mug', url: 'https://demo.myshopify.com/products/mug' }] },
      connectUrl: null,
      channel: { id: 'gid://shopify/Channel/1', handle: 'nexez-page1', accountId: 'page-1' },
      channelError: null,
      sync: { lastSyncedAt: '2026-07-13T18:00:00Z', pending: false, attempts: 0, error: null },
    })
    expect(ensureShopifySalesChannel).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ channel_id: 'gid://shopify/Channel/1' }),
      { shop: 'demo.myshopify.com', accessToken: 'access-token' },
      { pageId: 'page-1', accountName: 'Demo', startFullSync: false },
    )
    expect(issueShopifyLinkToken).not.toHaveBeenCalled()
    expect(body.listing.products).toBeUndefined()
    expect(JSON.stringify(body)).not.toContain('minPrice')
  })

  it('returns an attention state instead of trusting a stale stored channel id', async () => {
    vi.mocked(createAdminClient).mockReturnValue(createSupabaseMock((ctx) => ({
      data: ctx.table === 'pages' ? { id: 'page-1', name: 'Demo', slug: 'demo' } : null,
      error: null,
    })) as any)
    vi.mocked(ensureShopifySessionInstall).mockResolvedValue({
      shop_domain: 'demo.myshopify.com',
      owner_id: 'owner-1',
      page_id: 'page-1',
      scope: 'read_products,write_app_proxy',
      uninstalled_at: null,
      channel_id: 'gid://shopify/Channel/stale',
    })
    vi.mocked(getShopifyInstallCredentialsByShop).mockResolvedValue({
      shop: 'demo.myshopify.com',
      accessToken: 'access-token',
    })
    vi.mocked(ensureShopifySalesChannel).mockRejectedValueOnce(new Error('Channel no longer exists'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const body = await (await POST(request())).json()

    expect(body).toMatchObject({
      state: 'linked',
      channel: null,
      channelError: expect.stringMatching(/could not verify/i),
    })
    expect(body.channel?.id).not.toBe('gid://shopify/Channel/stale')
    error.mockRestore()
  })

  it('fails closed while a mapping lifecycle transition is still finishing', async () => {
    vi.mocked(ensureShopifySessionInstall).mockResolvedValue({
      shop_domain: 'demo.myshopify.com',
      owner_id: 'owner-1',
      page_id: 'page-1',
      scope: 'read_products,write_app_proxy',
      uninstalled_at: null,
      mapping_generation: 5,
      mapping_transition_token: 'lease-1',
    })

    const response = await POST(request())

    expect(response.status).toBe(409)
    expect(issueShopifyLinkToken).not.toHaveBeenCalled()
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  adminConfigured: true,
  cryptoConfigured: true,
  user: { id: 'owner-1' } as { id: string } | null,
  upsert: vi.fn(async () => {}),
  setCookie: vi.fn(),
  deleteCookie: vi.fn(),
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => (name === 'shopify_oauth_state' ? { value: 'state-1' } : undefined),
    set: h.setCookie,
    delete: h.deleteCookie,
  })),
}))
vi.mock('../../../../lib/server/shopify', () => ({
  shopifyApiKey: () => 'client-id',
  shopifyConfigured: () => true,
  signPendingShop: (shop: string) => `signed:${shop}`,
  verifyShopifyOAuthHmac: () => true,
}))
vi.mock('../../../../lib/server/integration-importers', () => ({
  resolveShopDomain: (shop: string) => (shop.endsWith('.myshopify.com') ? shop : null),
}))
vi.mock('../../../../lib/server/shopify-install', () => ({ upsertInstall: h.upsert }))
vi.mock('../../../../lib/site', () => ({ appUrl: (path: string) => `https://app.nexez.ai${path}` }))
vi.mock('../../../../utils/supabase/server', () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: h.user } }) } }),
}))
vi.mock('../../../../utils/supabase/admin', () => ({
  createAdminClient: () => ({ admin: true }),
  hasSupabaseAdminEnv: () => h.adminConfigured,
}))
vi.mock('../../../../lib/server/secret-crypto', () => ({ hasSecretCryptoKey: () => h.cryptoConfigured }))

import { GET } from './route'

const request = () => new Request(
  'https://app.nexez.ai/api/shopify/callback?shop=demo.myshopify.com&code=code-1&state=state-1&hmac=ok',
)

function tokenResponse(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    json: async () => ({
      access_token: 'shpat_access',
      refresh_token: 'shprt_refresh',
      expires_in: 3600,
      refresh_token_expires_in: 7776000,
      scope: 'read_products,write_app_proxy',
      ...overrides,
    }),
  } as Response
}

describe('GET /api/shopify/callback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    h.adminConfigured = true
    h.cryptoConfigured = true
    h.user = { id: 'owner-1' }
    vi.stubGlobal('fetch', vi.fn(async () => tokenResponse()))
  })

  it('fails before token exchange when encrypted service-role storage is unavailable', async () => {
    h.cryptoConfigured = false
    const response = await GET(request())
    expect(response.status).toBe(503)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('requests rotating offline credentials and stores the complete token lifecycle', async () => {
    const response = await GET(request())
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://app.nexez.ai/shopify/link')
    const [, init] = vi.mocked(fetch).mock.calls[0]
    expect(init?.headers).toMatchObject({ 'content-type': 'application/x-www-form-urlencoded' })
    expect(String(init?.body)).toContain('expiring=1')
    expect(h.upsert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        shop: 'demo.myshopify.com',
        ownerId: 'owner-1',
        offlineToken: 'shpat_access',
        refreshToken: 'shprt_refresh',
        expiresIn: 3600,
        refreshTokenExpiresIn: 7776000,
      }),
    )
    expect(h.setCookie).toHaveBeenCalledWith('shopify_pending_shop', 'signed:demo.myshopify.com', expect.any(Object))
  })

  it('sends signed-out installs to the isolated Shopify login flow', async () => {
    h.user = null

    const response = await GET(request())

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://app.nexez.ai/login?next=/shopify/link')
  })

  it('rejects a non-rotating token response instead of persisting an unusable install', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => tokenResponse({ refresh_token: undefined })))
    const response = await GET(request())
    expect(response.status).toBe(502)
    expect(h.upsert).not.toHaveBeenCalled()
  })
})

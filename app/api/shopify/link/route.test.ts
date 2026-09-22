import { describe, it, expect, vi, beforeEach } from 'vitest'

const { deletePendingCookie } = vi.hoisted(() => ({ deletePendingCookie: vi.fn() }))
const mappingMocks = vi.hoisted(() => {
  class MappingError extends Error {
    constructor(readonly reason: string) {
      super(reason)
    }
  }
  return {
    MappingError,
    begin: vi.fn(),
    finish: vi.fn(),
    abort: vi.fn(async () => true),
    cleanup: vi.fn(async () => undefined),
  }
})
const state = {
  cfg: true,
  pending: 'demo.myshopify.com' as string | null,
  user: { id: 'u1', email: 'a@b.co', email_confirmed_at: 'x' } as { id: string; email: string; email_confirmed_at: string } | null,
  // resolvePageAccess always returns the authoritative pageId (see PageAccess);
  // the route now inserts THAT rather than the client-supplied one, so the mock
  // has to carry it.
  access: { pageId: 'p1', ownerId: 'owner-1', role: 'owner' } as unknown,
  install: { shop_domain: 'demo.myshopify.com', page_id: null } as any,
  conflictingInstall: null as { shop_domain: string } | null,
  credentials: { shop: 'demo.myshopify.com', accessToken: 'access-token' } as { shop: string; accessToken: string } | null,
  syncResult: { ok: true, provider: 'shopify', imported: 4, windows: 0, availabilitySynced: false, note: 'Imported 4' } as any,
  integrationsAllowed: true,
  lease: {
    shop: 'demo.myshopify.com',
    token: '00000000-0000-4000-8000-000000000001',
    kind: 'relink',
    generation: 2,
    catalogGeneration: null,
    ownerId: null,
    pageId: null,
  } as any,
  mapping: {
    shop: 'demo.myshopify.com',
    ownerId: 'owner-1',
    pageId: 'p1',
    generation: 3,
  },
}
const updateSpy = vi.fn(() => ({
  eq: vi.fn(() => ({ is: vi.fn(async () => ({ error: null })) })),
}))
const adminQuery = () => {
  const query: any = {}
  query.select = () => query
  query.eq = () => query
  query.is = () => query
  query.neq = () => query
  query.limit = () => query
  query.maybeSingle = async () => ({ data: state.conflictingInstall, error: null })
  query.update = updateSpy
  return query
}

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => ({ value: 'tok' }), delete: deletePendingCookie })),
}))
vi.mock('../../../../lib/server/shopify', () => ({ shopifyConfigured: () => state.cfg, readPendingShop: () => state.pending }))
vi.mock('../../../../lib/server/shopify-channel', () => ({
  ensureShopifySalesChannel: vi.fn(async () => ({
    id: 'gid://shopify/Channel/1',
    handle: 'nexez-p1',
    accountId: 'p1',
    accountName: 'Demo catalog',
    specificationHandle: 'nexez-us',
    connectedAt: '2026-08-28T00:00:00Z',
  })),
}))
vi.mock('../../../../lib/server/shopify-billing', () => ({
  rememberShopifyBillingOwner: vi.fn(async () => undefined),
  shopifyPartnerBillingConfigured: vi.fn(() => false),
  verifyShopifyBilling: vi.fn(),
}))
vi.mock('../../../../utils/supabase/server', () => ({ createClient: () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }) }))
vi.mock('../../../../utils/supabase/admin', () => ({ createAdminClient: () => ({ from: () => adminQuery() }), hasSupabaseAdminEnv: () => true }))
vi.mock('../../../../lib/server/page-access', () => ({ resolvePageAccess: async () => state.access }))
vi.mock('../../../../lib/server/shopify-install', () => ({
  ShopifyMappingChangeError: mappingMocks.MappingError,
  beginShopifyMappingChange: mappingMocks.begin,
  finishShopifyRelink: mappingMocks.finish,
  abortShopifyMappingChange: mappingMocks.abort,
  getInstallByShop: vi.fn(async () => state.install),
  getShopifyInstallCredentialsByShop: vi.fn(async () => state.credentials),
  removeShopifyCatalogFromPage: mappingMocks.cleanup,
}))
vi.mock('../../../../lib/server/integration-sync', () => ({
  syncPageIntegration: vi.fn(async () => state.syncResult),
}))
vi.mock('../../../../lib/server/plan', () => ({ ownerAllows: vi.fn(async () => state.integrationsAllowed) }))
vi.mock('../../../../lib/rate-limit', () => ({ enforceRateLimit: async () => null }))

import { POST } from './route'
import {
  abortShopifyMappingChange,
  beginShopifyMappingChange,
  finishShopifyRelink,
  getInstallByShop,
  getShopifyInstallCredentialsByShop,
  removeShopifyCatalogFromPage,
} from '../../../../lib/server/shopify-install'
import { syncPageIntegration } from '../../../../lib/server/integration-sync'
import { ownerAllows } from '../../../../lib/server/plan'
import { rememberShopifyBillingOwner } from '../../../../lib/server/shopify-billing'

const post = (body: unknown = { pageId: 'p1' }) =>
  POST(new Request('https://app.nexez.ai/api/shopify/link', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))

describe('POST /api/shopify/link', () => {
  beforeEach(() => {
    state.cfg = true
    state.pending = 'demo.myshopify.com'
    state.user = { id: 'u1', email: 'a@b.co', email_confirmed_at: 'x' }
    state.access = { pageId: 'p1', ownerId: 'owner-1', role: 'owner' }
    state.install = { shop_domain: 'demo.myshopify.com', page_id: null }
    state.conflictingInstall = null
    state.credentials = { shop: 'demo.myshopify.com', accessToken: 'access-token' }
    state.syncResult = { ok: true, provider: 'shopify', imported: 4, windows: 0, availabilitySynced: false, note: 'Imported 4' }
    state.integrationsAllowed = true
    state.lease = {
      shop: 'demo.myshopify.com',
      token: '00000000-0000-4000-8000-000000000001',
      kind: 'relink',
      generation: 2,
      catalogGeneration: null,
      ownerId: null,
      pageId: null,
    }
    state.mapping = {
      shop: 'demo.myshopify.com',
      ownerId: 'owner-1',
      pageId: 'p1',
      generation: 3,
    }
    vi.clearAllMocks()
    mappingMocks.begin.mockImplementation(async () => state.lease)
    mappingMocks.finish.mockImplementation(async () => state.mapping)
    mappingMocks.abort.mockResolvedValue(true)
    mappingMocks.cleanup.mockResolvedValue(undefined)
    updateSpy.mockClear()
  })

  it('404 when Shopify is not configured', async () => {
    state.cfg = false
    expect((await post()).status).toBe(404)
  })
  it('401 when not signed in', async () => {
    state.user = null
    expect((await post()).status).toBe(401)
  })
  it('400 without a valid pending-shop cookie', async () => {
    state.pending = null
    expect((await post()).status).toBe(400)
  })
  it('400 without a pageId', async () => {
    expect((await post({})).status).toBe(400)
  })
  it('403 when the caller lacks edit access to the listing', async () => {
    state.access = null
    expect((await post()).status).toBe(403)
    expect(updateSpy).not.toHaveBeenCalled()
  })
  it('preserves the pending connection and mapping if billing ownership cannot be saved', async () => {
    vi.mocked(rememberShopifyBillingOwner).mockRejectedValueOnce(new Error('database unavailable'))
    expect((await post()).status).toBe(503)
    expect(beginShopifyMappingChange).not.toHaveBeenCalled()
    expect(deletePendingCookie).not.toHaveBeenCalled()
  })
  it('links owner_id + page_id on success', async () => {
    const res = await post({ pageId: 'p1' })
    expect(res.status).toBe(200)
    expect(beginShopifyMappingChange).toHaveBeenCalledWith(expect.anything(), {
      shop: 'demo.myshopify.com',
      kind: 'relink',
      targetOwnerId: 'owner-1',
      targetPageId: 'p1',
    })
    expect(removeShopifyCatalogFromPage).toHaveBeenCalledWith(
      expect.anything(), null, 'demo.myshopify.com', null,
    )
    expect(finishShopifyRelink).toHaveBeenCalledWith(expect.anything(), {
      lease: state.lease,
      ownerId: 'owner-1',
      pageId: 'p1',
    })
    expect(syncPageIntegration).toHaveBeenCalledWith(expect.anything(), 'shopify', 'p1', {
      shopifyCredentials: state.credentials,
      shopifyMapping: state.mapping,
      shopifyChannelHandle: 'nexez-p1',
      clearShopifyCatalogSyncState: true,
      trigger: 'oauth_callback',
    })
    expect(await res.json()).toMatchObject({
      ok: true,
      sync: { status: 'synced', imported: 4 },
    })
  })

  it('keeps installed Shopify linking available below Pro', async () => {
    state.integrationsAllowed = false

    const res = await post({ pageId: 'p1' })

    expect(res.status).toBe(200)
    expect(ownerAllows).not.toHaveBeenCalled()
    expect(getInstallByShop).toHaveBeenCalledWith(expect.anything(), 'demo.myshopify.com')
    expect(beginShopifyMappingChange).toHaveBeenCalled()
    expect(finishShopifyRelink).toHaveBeenCalled()
    expect(getShopifyInstallCredentialsByShop).toHaveBeenCalled()
    expect(removeShopifyCatalogFromPage).toHaveBeenCalledWith(
      expect.anything(), null, 'demo.myshopify.com', null,
    )
    expect(syncPageIntegration).toHaveBeenCalled()
    expect(deletePendingCookie).toHaveBeenCalled()
  })

  it('rejects linking two active stores to the same listing', async () => {
    state.conflictingInstall = { shop_domain: 'other.myshopify.com' }
    const res = await post({ pageId: 'p1' })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/already connected/i)
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('removes this shop catalog from its previous listing before moving it', async () => {
    state.install = { shop_domain: 'demo.myshopify.com', page_id: 'old-page' }
    state.lease = { ...state.lease, pageId: 'old-page', catalogGeneration: 7 }
    const res = await post({ pageId: 'p1' })
    expect(res.status).toBe(200)
    expect(removeShopifyCatalogFromPage).toHaveBeenCalledWith(
      expect.anything(), 'old-page', 'demo.myshopify.com', 7,
    )
  })

  it('keeps the successful link when the first catalog sync needs attention', async () => {
    state.syncResult = { ok: false, status: 502, error: 'Shopify catalog is temporarily unavailable.' }
    const res = await post({ pageId: 'p1' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      ok: true,
      sync: { status: 'attention', error: 'Shopify catalog is temporarily unavailable.' },
    })
  })

  it('aborts the exact lease and leaves the mapping untouched when cleanup fails', async () => {
    state.lease = { ...state.lease, pageId: 'old-page', catalogGeneration: 7 }
    mappingMocks.cleanup.mockRejectedValueOnce(new Error('page conflict'))

    const res = await post({ pageId: 'p1' })

    expect(res.status).toBe(503)
    expect(abortShopifyMappingChange).toHaveBeenCalledWith(expect.anything(), state.lease)
    expect(finishShopifyRelink).not.toHaveBeenCalled()
    expect(syncPageIntegration).not.toHaveBeenCalled()
  })

  it('maps a competing active lease to a retryable conflict without aborting it', async () => {
    mappingMocks.begin.mockRejectedValueOnce(new mappingMocks.MappingError('busy'))

    const res = await post({ pageId: 'p1' })

    expect(res.status).toBe(409)
    expect(abortShopifyMappingChange).not.toHaveBeenCalled()
    expect(finishShopifyRelink).not.toHaveBeenCalled()
  })
})

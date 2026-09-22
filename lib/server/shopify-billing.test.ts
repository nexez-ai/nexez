import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { shopifyPricingUrl, verifyShopifyBilling } from './shopify-billing'

function adminMock(existingBilling: unknown = null) {
  const installUpdate = vi.fn()
  const billingUpsert = vi.fn(async () => ({ error: null }))
  const from = vi.fn((table: string) => {
    if (table === 'shopify_installs') {
      const query: any = {}
      query.update = vi.fn((row: unknown) => {
        installUpdate(row)
        return query
      })
      query.eq = vi.fn(() => query)
      query.is = vi.fn(async () => ({ error: null }))
      return query
    }
    const query: any = {}
    query.select = vi.fn(() => query)
    query.eq = vi.fn(() => query)
    query.maybeSingle = vi.fn(async () => ({ data: existingBilling, error: null }))
    query.upsert = billingUpsert
    return query
  })
  return { client: { from } as any, installUpdate, billingUpsert }
}

describe('Shopify App Pricing verification', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubEnv('SHOPIFY_PARTNER_ORG_ID', '123')
    vi.stubEnv('SHOPIFY_PARTNER_API_ACCESS_TOKEN', 'partner-token')
    vi.stubEnv('SHOPIFY_APP_GID', 'gid://shopify/App/99')
    vi.stubEnv('SHOPIFY_APP_HANDLE', 'nexez-agent-ready')
  })

  it('verifies the Partner API subscription and writes a Shopify-origin plan', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ data: { shop: { id: 'gid://shopify/Shop/1' } } }))
      .mockResolvedValueOnce(Response.json({
        data: {
          activeSubscription: {
            billingPeriod: 'EVERY_30_DAYS',
            cancelAtEndOfCycle: false,
            trialEndsAt: null,
            currentBillingCycle: { startTime: '2026-08-01T00:00:00Z', endTime: '2026-09-01T00:00:00Z' },
            items: [{ handle: 'pro', description: 'Nexez Pro' }],
          },
        },
      }))
    vi.stubGlobal('fetch', fetchMock)
    const admin = adminMock()

    const result = await verifyShopifyBilling(
      admin.client,
      { shop_domain: 'demo.myshopify.com', owner_id: 'owner-1' },
      { shop: 'demo.myshopify.com', accessToken: 'offline-token' },
    )

    expect(result).toMatchObject({ status: 'active', planHandle: 'pro', planId: 'pro', shopGid: 'gid://shopify/Shop/1' })
    expect(admin.installUpdate).toHaveBeenCalledWith(expect.objectContaining({
      shop_gid: 'gid://shopify/Shop/1',
      shopify_plan_handle: 'pro',
      shopify_billing_status: 'active',
    }))
    expect(admin.billingUpsert).toHaveBeenCalledWith(expect.objectContaining({
      owner_id: 'owner-1',
      plan_id: 'pro',
      status: 'active',
      account_origin: 'shopify',
    }), { onConflict: 'owner_id' })
    expect(fetchMock.mock.calls[1][0]).toBe('https://partners.shopify.com/123/api/2026-07/graphql.json')
  })

  it.each(['paid', 'shopify'])('refuses to overwrite a live Stripe subscription with %s origin', async (origin) => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(Response.json({ data: { shop: { id: 'gid://shopify/Shop/1' } } }))
      .mockResolvedValueOnce(Response.json({
        data: {
          activeSubscription: {
            billingPeriod: 'EVERY_30_DAYS',
            cancelAtEndOfCycle: false,
            trialEndsAt: null,
            currentBillingCycle: null,
            items: [],
          },
        },
      })))
    const admin = adminMock({
      owner_id: 'owner-1',
      stripe_subscription_id: 'sub_123',
      status: 'active',
      account_origin: origin,
    })

    await expect(verifyShopifyBilling(
      admin.client,
      { shop_domain: 'demo.myshopify.com', owner_id: 'owner-1' },
      { shop: 'demo.myshopify.com', accessToken: 'offline-token' },
      'pro',
    )).rejects.toThrow('must be migrated')
  })

  it('migrates a canceled legacy Stripe record to Shopify billing', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(Response.json({ data: { shop: { id: 'gid://shopify/Shop/1' } } }))
      .mockResolvedValueOnce(Response.json({ data: { activeSubscription: null } })))
    const admin = adminMock({
      owner_id: 'owner-1',
      stripe_subscription_id: 'sub_canceled',
      status: 'canceled',
      account_origin: 'legacy',
    })

    await expect(verifyShopifyBilling(
      admin.client,
      { shop_domain: 'demo.myshopify.com', owner_id: 'owner-1' },
      { shop: 'demo.myshopify.com', accessToken: 'offline-token' },
    )).resolves.toMatchObject({ status: 'free', planId: 'free' })

    expect(admin.billingUpsert).toHaveBeenCalledWith(expect.objectContaining({
      owner_id: 'owner-1',
      plan_id: 'free',
      status: 'active',
      account_origin: 'shopify',
    }), { onConflict: 'owner_id' })
  })

  it('builds the Shopify-hosted plan selection URL', () => {
    expect(shopifyPricingUrl('demo.myshopify.com')).toBe(
      'https://admin.shopify.com/store/demo/charges/nexez-agent-ready/pricing_plans',
    )
  })
})

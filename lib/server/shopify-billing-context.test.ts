import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSupabaseMock, type QueryContext } from '../../test/supabase-mock'
import { getOwnerShopifyBillingContext } from './shopify-billing'
import { signPendingShop } from './shopify'

vi.mock('server-only', () => ({}))

function fixture() {
  const state = { origin: null as string | null, linked: false, installed: true, readError: false, writeError: false }
  const writes: QueryContext[] = []
  const client = createSupabaseMock((ctx) => {
    if (ctx.op === 'upsert') {
      writes.push(ctx)
      if (state.writeError) return { data: null, error: { message: 'unavailable' } }
      state.origin = ctx.payload.account_origin
      return { data: null, error: null }
    }
    if (state.readError) return { data: null, error: { message: 'unavailable' } }
    if (ctx.table === 'billing_subscriptions') return { data: state.origin ? { account_origin: state.origin } : null }
    const matches = state.installed && (ctx.eqs.shop_domain === 'review.myshopify.com' || (state.linked && ctx.eqs.owner_id === 'owner'))
    return { data: matches ? { shop_domain: 'review.myshopify.com', shopify_plan_handle: 'free', shopify_billing_status: 'free', shopify_billing_verified_at: null } : null }
  })
  return { state, writes, client: client as any }
}

beforeEach(() => vi.stubEnv('SHOPIFY_API_SECRET', 'test-signing-secret'))
afterEach(() => vi.unstubAllEnvs())

describe('Shopify billing source across the merchant lifecycle', () => {
  it('recognizes an authenticated merchant before their store or listing is linked, and retains the source after cookie loss', async () => {
    const f = fixture()
    const first = await getOwnerShopifyBillingContext(f.client, 'owner', signPendingShop('review.myshopify.com'))
    expect(first).toMatchObject({ provider: 'shopify', shop: 'review.myshopify.com', status: 'connection_required' })
    expect(first?.pricingUrl).toContain('/dashboard/shopify')
    expect(f.writes[0].payload).toEqual({ owner_id: 'owner', account_origin: 'shopify' })
    expect(await getOwnerShopifyBillingContext(f.client, 'owner')).toMatchObject({ provider: 'shopify', status: 'connection_required' })
    expect(f.writes).toHaveLength(1)
  })

  it('retains Shopify billing after uninstall/redaction removes the installation', async () => {
    const f = fixture()
    f.state.linked = true
    expect((await getOwnerShopifyBillingContext(f.client, 'owner'))?.pricingUrl).toContain('admin.shopify.com/store/review/charges/')
    f.state.installed = false
    expect(await getOwnerShopifyBillingContext(f.client, 'owner')).toMatchObject({ provider: 'shopify', shop: null, status: 'connection_required' })
  })

  it('does not turn forged, expired, or uninstalled-shop handoffs into billing ownership', async () => {
    const f = fixture()
    const valid = signPendingShop('review.myshopify.com')
    expect(await getOwnerShopifyBillingContext(f.client, 'owner', `${valid.slice(0, -1)}${valid.endsWith('0') ? '1' : '0'}`)).toBeNull()
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 3_600_001)
    expect(await getOwnerShopifyBillingContext(f.client, 'owner', valid)).toBeNull()
    vi.restoreAllMocks()
    f.state.installed = false
    expect(await getOwnerShopifyBillingContext(f.client, 'owner', signPendingShop('review.myshopify.com'))).toBeNull()
    expect(f.writes).toHaveLength(0)
  })

  it('leaves ordinary Nexez accounts on their direct billing path', async () => {
    const f = fixture()
    f.state.origin = 'paid'
    expect(await getOwnerShopifyBillingContext(f.client, 'owner')).toBeNull()
    expect(f.writes).toHaveLength(0)
  })

  it('fails closed when origin cannot be read or persisted', async () => {
    const f = fixture()
    f.state.readError = true
    await expect(getOwnerShopifyBillingContext(f.client, 'owner')).rejects.toThrow('billing origin')
    f.state.readError = false
    f.state.writeError = true
    await expect(getOwnerShopifyBillingContext(f.client, 'owner', signPendingShop('review.myshopify.com'))).rejects.toThrow('retain Shopify')
  })
})

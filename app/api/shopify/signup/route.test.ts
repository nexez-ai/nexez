import { beforeEach, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ shop: 'review.myshopify.com' as string | null, installed: true, signUp: vi.fn(), remember: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'signed-proof' }) }) }))
vi.mock('../../../../lib/rate-limit', () => ({ enforceRateLimit: async () => null }))
vi.mock('../../../../lib/server/shopify', () => ({ readPendingShop: () => h.shop }))
vi.mock('../../../../lib/server/shopify-install', () => ({ getInstallByShop: async () => h.installed ? { shop_domain: h.shop } : null }))
vi.mock('../../../../lib/server/shopify-billing', () => ({ rememberShopifyBillingOwner: h.remember }))
vi.mock('../../../../utils/supabase/admin', () => ({ hasSupabaseAdminEnv: () => true, createAdminClient: () => ({}) }))
vi.mock('../../../../utils/supabase/server', () => ({ createClient: () => ({ auth: { signUp: h.signUp } }) }))
import { POST } from './route'

const request = () => new Request('https://app.nexez.ai/api/shopify/signup', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'review@example.com', password: 'test-only-password', fullName: 'Review', company: 'Test shop', plan: 'scale' }),
})

beforeEach(() => {
  vi.clearAllMocks()
  h.shop = 'review.myshopify.com'
  h.installed = true
  h.remember.mockResolvedValue(undefined)
  h.signUp.mockResolvedValue({ data: { user: { id: 'new-owner', created_at: new Date().toISOString(), identities: [{ id: 'identity' }] }, session: null }, error: null })
})

it('records Shopify origin before email confirmation and ignores a requested direct paid plan', async () => {
  const response = await POST(request())
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ needsEmailConfirm: true })
  expect(h.remember).toHaveBeenCalledWith({}, 'new-owner')
  const options = h.signUp.mock.calls[0][0].options
  expect(options.data).toEqual({ full_name: 'Review', company: 'Test shop' })
  expect(options.emailRedirectTo).toContain('/auth/callback?next=%2Fdashboard%2Fshopify')
})

it('requires a valid, still-installed Shopify handoff before creating an account', async () => {
  h.shop = null
  expect((await POST(request())).status).toBe(400)
  h.shop = 'review.myshopify.com'
  h.installed = false
  expect((await POST(request())).status).toBe(400)
  expect(h.signUp).not.toHaveBeenCalled()
})

it('does not modify existing accounts from obfuscated or unconfirmed signup responses', async () => {
  for (const user of [
    { id: 'obfuscated', created_at: new Date().toISOString(), identities: [] },
    { id: 'existing-unconfirmed', created_at: '2025-01-01T00:00:00Z', identities: [{ id: 'identity' }] },
  ]) {
    h.signUp.mockResolvedValue({ data: { user, session: null }, error: null })
    expect((await POST(request())).status).toBe(200)
  }
  expect(h.remember).not.toHaveBeenCalled()
})

it('does not claim setup succeeded if billing origin cannot be retained', async () => {
  h.remember.mockRejectedValue(new Error('database unavailable'))
  expect((await POST(request())).status).toBe(503)
})

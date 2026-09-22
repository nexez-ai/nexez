import { beforeEach, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ shop: null as string | null, user: null as any, billing: null as any }))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'signed-handoff' }) }) }))
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`) } }))
vi.mock('../../utils/supabase/server', () => ({ createClient: () => ({ auth: { getUser: async () => ({ data: { user: h.user } }) } }) }))
vi.mock('../../utils/supabase/admin', () => ({ createAdminClient: () => ({}), hasSupabaseAdminEnv: () => true }))
vi.mock('../../lib/server/shopify', () => ({ readPendingShop: () => h.shop }))
vi.mock('../../lib/server/shopify-billing', () => ({ getOwnerShopifyBillingContext: async () => h.billing }))
vi.mock('../../components/LoginForm', () => ({ LoginForm: () => null }))
vi.mock('./OnboardClient', () => ({ default: () => null }))
import OnboardPage from './page'
import OnboardClient from './OnboardClient'
import { LoginForm } from '../../components/LoginForm'
beforeEach(() => { h.shop = null; h.user = null; h.billing = null })
it('renders Shopify account setup before sign-in without the Nexez plan picker', async () => {
  h.shop = 'review.myshopify.com'
  const result = await OnboardPage()
  expect(result.type).toBe(LoginForm)
  expect(result.props).toMatchObject({ initialMode: 'signup', nextPath: '/dashboard/shopify', shopifyShop: h.shop })
})
it('keeps the ordinary signup flow for non-Shopify visitors', async () => {
  expect((await OnboardPage()).type).toBe(OnboardClient)
})
it('routes returning Shopify users past onboarding, including an explicit plan deep link', async () => {
  h.user = { id: 'owner' }
  h.billing = { provider: 'shopify' }
  await expect(OnboardPage()).rejects.toThrow('redirect:/dashboard/billing')
  h.shop = 'review.myshopify.com'
  await expect(OnboardPage()).rejects.toThrow('redirect:/dashboard/shopify')
})

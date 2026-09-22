import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSupabaseMock } from '../../../test/supabase-mock'
import { signPendingShop } from '../../../lib/server/shopify'

const h = vi.hoisted(() => ({ pending: undefined as string | undefined, admin: null as any, configured: true, stripe: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('stripe', () => ({ default: class { constructor() { h.stripe() } } }))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: h.pending }) }) }))
vi.mock('../../../lib/rate-limit', () => ({ enforceRateLimit: async () => null }))
vi.mock('../../../utils/supabase/server', () => ({ createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'owner' } } }) } }) }))
vi.mock('../../../utils/supabase/admin', () => ({ hasSupabaseAdminEnv: () => h.configured, createAdminClient: () => h.admin }))
import { POST as embedded } from './create-subscription/route'
import { POST as hosted } from './checkout/route'
import { POST as portal } from './portal/route'
import { POST as connect } from './connect/route'
import { POST as trial } from './start-trial/route'

function request(kind: string) {
  return new Request(`https://app.nexez.ai/api/billing/${kind}`, {
    method: 'POST',
    headers: { 'content-type': kind === 'checkout' ? 'application/x-www-form-urlencoded' : 'application/json' },
    body: kind === 'checkout' ? 'plan=scale' : JSON.stringify({ plan: 'scale' }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('SHOPIFY_API_SECRET', 'test-only-secret')
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_never_used')
  h.pending = signPendingShop('review.myshopify.com')
  h.configured = true
})
afterEach(() => vi.unstubAllEnvs())

for (const [name, handler, blockedStatus] of [
  ['create-subscription', embedded, 409], ['checkout', hosted, 303], ['portal', portal, 303], ['start-trial', trial, 409], ['connect', connect, 409],
] as const) {
  describe(name, () => {
    it('blocks the reviewer path before account linking, then after the handoff cookie disappears', async () => {
      let origin: string | null = null
      h.admin = createSupabaseMock((q) => {
        if (q.op === 'upsert') { origin = q.payload.account_origin; return { data: null } }
        if (q.table === 'billing_subscriptions') return { data: origin ? { account_origin: origin } : null }
        return { data: q.eqs.shop_domain ? { shop_domain: 'review.myshopify.com' } : null }
      })
      expect((await handler(request(name))).status).toBe(blockedStatus)
      expect(origin).toBe('shopify')
      h.pending = undefined
      expect((await handler(request(name))).status).toBe(blockedStatus)
      expect(h.stripe).not.toHaveBeenCalled()
    })

    it('does not reach Stripe on a billing lookup failure', async () => {
      h.admin = createSupabaseMock(() => ({ data: null, error: { message: 'database unavailable' } }))
      expect((await handler(request(name))).status).toBe(503)
      expect(h.stripe).not.toHaveBeenCalled()
    })

    it('does not reach Stripe when server billing storage is unavailable', async () => {
      h.configured = false
      expect((await handler(request(name))).status).toBe(name === 'connect' ? 500 : 503)
      expect(h.stripe).not.toHaveBeenCalled()
    })
  })
}

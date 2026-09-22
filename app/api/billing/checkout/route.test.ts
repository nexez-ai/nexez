import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextResponse } from 'next/server'
import { createSupabaseMock } from '../../../../test/supabase-mock'

const { checkoutSessionsCreate, checkoutSessionsExpire, subscriptionsList, subscriptionsUpdate, subscriptionsCancel } = vi.hoisted(() => ({
  checkoutSessionsCreate: vi.fn(),
  checkoutSessionsExpire: vi.fn(),
  subscriptionsList: vi.fn(),
  subscriptionsUpdate: vi.fn(),
  subscriptionsCancel: vi.fn(),
}))
const billingAttempt = vi.hoisted(() => ({ claim: vi.fn(), markReady: vi.fn(), release: vi.fn(), retire: vi.fn() }))
const rateLimitRef = vi.hoisted(() => ({ response: null as NextResponse | null }))
vi.mock('stripe', () => ({
  default: class {
    checkout = { sessions: { create: checkoutSessionsCreate, expire: checkoutSessionsExpire } }
    subscriptions = { list: subscriptionsList, update: subscriptionsUpdate, cancel: subscriptionsCancel }
  },
}))
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ getAll: () => [], get: () => undefined, set: () => {} })) }))
vi.mock('../../../../utils/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('../../../../utils/supabase/admin', () => ({ hasSupabaseAdminEnv: vi.fn(() => false), createAdminClient: vi.fn() }))
vi.mock('../../../../lib/rate-limit', () => ({
  enforceRateLimit: vi.fn(async () => rateLimitRef.response),
}))
vi.mock('../../../../lib/billing', () => ({
  getBillingPlan: vi.fn(),
  getPlanPriceId: vi.fn(),
  isSelfServePlanId: (value: unknown) => ['launch', 'pro', 'scale'].includes(String(value)),
  isStripePriceId: (value: string | null | undefined) => typeof value === 'string' && value.trim().startsWith('price_'),
  isUniqueSelfServePlanPrice: vi.fn(() => true),
}))
vi.mock('../../../../lib/server/billing-checkout-attempt', () => ({
  claimBillingCheckoutAttempt: billingAttempt.claim,
  markBillingCheckoutAttemptReady: billingAttempt.markReady,
  releaseBillingCheckoutAttempt: billingAttempt.release,
  retireSupersededBillingObject: billingAttempt.retire,
  stripeBillingIdempotencyKey: (attempt: string, operation: string) => `nexez-billing:${operation}:${attempt}`,
}))
vi.mock('../../../../lib/server/shopify-billing', () => ({
  getOwnerShopifyBillingContext: vi.fn(async () => null),
}))

import { POST } from './route'
import { createClient } from '../../../../utils/supabase/server'
import { getBillingPlan, getPlanPriceId, isUniqueSelfServePlanPrice } from '../../../../lib/billing'
import { hasSupabaseAdminEnv, createAdminClient } from '../../../../utils/supabase/admin'
import { getOwnerShopifyBillingContext } from '../../../../lib/server/shopify-billing'

const form = (plan: string) =>
  new Request('https://nexez.test/api/billing/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ plan }).toString(),
  })

describe('POST /api/billing/checkout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getOwnerShopifyBillingContext).mockResolvedValue(null)
    vi.mocked(hasSupabaseAdminEnv).mockReturnValue(true)
    vi.mocked(createAdminClient).mockReturnValue(createSupabaseMock(() => ({ data: null, error: null })) as any)
    vi.mocked(isUniqueSelfServePlanPrice).mockReturnValue(true)
    // Default: no live subscription -> a first purchase creates a Checkout Session.
    subscriptionsList.mockResolvedValue({ data: [] })
    billingAttempt.claim.mockResolvedValue({ ok: true, attempt: { attempt_key: 'attempt-1' }, reused: false })
    billingAttempt.markReady.mockResolvedValue(true)
    billingAttempt.release.mockResolvedValue(true)
    billingAttempt.retire.mockResolvedValue('preserved')
    rateLimitRef.response = null
  })
  afterEach(() => vi.unstubAllEnvs())

  it('redirects with ?error=plan for an unknown plan', async () => {
    vi.mocked(getBillingPlan).mockReturnValue(null as any)
    const res = await POST(form('bogus'))
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toContain('/dashboard/billing?error=plan')
  })

  it('rejects an unsupported body before attempting to parse it', async () => {
    const res = await POST(new Request('https://nexez.test/api/billing/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }))

    expect(res.status).toBe(415)
    expect(await res.json()).toMatchObject({ error: 'unsupported_media_type' })
    expect(getBillingPlan).not.toHaveBeenCalled()
  })

  it('returns 400 for malformed multipart form data', async () => {
    const res = await POST(new Request('https://nexez.test/api/billing/checkout', {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data' },
      body: 'missing-boundary',
    }))

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_form_data' })
    expect(getBillingPlan).not.toHaveBeenCalled()
  })

  it('rate limits before validating or parsing the request body', async () => {
    rateLimitRef.response = NextResponse.json({ error: 'rate limited' }, { status: 429 })

    const res = await POST(new Request('https://nexez.test/api/billing/checkout', { method: 'POST' }))

    expect(res.status).toBe(429)
    expect(getBillingPlan).not.toHaveBeenCalled()
  })

  it('redirects to login when not authenticated', async () => {
    vi.mocked(getBillingPlan).mockReturnValue({ id: 'pro', name: 'Pro' } as any)
    vi.mocked(createClient).mockReturnValue(createSupabaseMock(() => ({ data: null }), { user: null }) as any)
    const res = await POST(form('pro'))
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toContain('/login')
  })

  it('redirects Shopify-linked owners to Shopify App Pricing before Stripe', async () => {
    vi.mocked(getBillingPlan).mockReturnValue({ id: 'pro', name: 'Pro' } as any)
    vi.mocked(createClient).mockReturnValue(createSupabaseMock(() => ({ data: null }), { user: { id: 'u1', email: 'a@b.c' } }) as any)
    vi.mocked(hasSupabaseAdminEnv).mockReturnValue(true)
    vi.mocked(getOwnerShopifyBillingContext).mockResolvedValue({
      provider: 'shopify',
      shop: 'review.myshopify.com',
      pricingUrl: 'https://admin.shopify.com/store/review/charges/nexez-agent-ready/pricing_plans',
      planHandle: 'pro',
      status: 'active',
      verifiedAt: '2026-08-28T00:00:00.000Z',
    })

    const res = await POST(form('pro'))

    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toContain('admin.shopify.com/store/review/charges')
    expect(checkoutSessionsCreate).not.toHaveBeenCalled()
  })

  it('redirects to Stripe setup when Stripe / price ID is not configured', async () => {
    vi.mocked(getBillingPlan).mockReturnValue({ id: 'pro', name: 'Pro' } as any)
    vi.mocked(getPlanPriceId).mockReturnValue('' as any)
    vi.mocked(createClient).mockReturnValue(createSupabaseMock(() => ({ data: null }), { user: { id: 'u1', email: 'a@b.c' } }) as any)
    const res = await POST(form('pro'))
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toContain('setup=stripe')
  })

  it('redirects to bad_price_id before contacting Stripe when a product id is configured', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_ready')
    vi.mocked(getBillingPlan).mockReturnValue({ id: 'pro', name: 'Pro' } as any)
    vi.mocked(getPlanPriceId).mockReturnValue('prod_wrong' as any)
    vi.mocked(createClient).mockReturnValue(createSupabaseMock(() => ({ data: null }), { user: { id: 'u1', email: 'a@b.c' } }) as any)

    const res = await POST(form('pro'))

    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toContain('error=bad_price_id')
    expect(checkoutSessionsCreate).not.toHaveBeenCalled()
  })

  it('rejects a Stripe Price mapped to more than one self-serve plan', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_ready')
    vi.mocked(getBillingPlan).mockReturnValue({ id: 'pro', name: 'Pro' } as any)
    vi.mocked(getPlanPriceId).mockReturnValue('price_shared' as any)
    vi.mocked(isUniqueSelfServePlanPrice).mockReturnValue(false)
    vi.mocked(createClient).mockReturnValue(createSupabaseMock(() => ({ data: null }), { user: { id: 'u1', email: 'a@b.c' } }) as any)

    const res = await POST(form('pro'))

    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toContain('error=duplicate_price_id')
    expect(checkoutSessionsCreate).not.toHaveBeenCalled()
  })

  it('creates a Stripe subscription checkout session and reuses a stored customer', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_ready')
    vi.mocked(getBillingPlan).mockReturnValue({ id: 'pro', name: 'Pro' } as any)
    vi.mocked(getPlanPriceId).mockReturnValue('price_pro' as any)
    checkoutSessionsCreate.mockResolvedValue({ id: 'cs_1', url: 'https://checkout.stripe.test/session' })
    vi.mocked(createClient).mockReturnValue(
      createSupabaseMock(
        (ctx) => (
          ctx.table === 'billing_subscriptions'
            ? { data: { stripe_customer_id: 'cus_existing' } }
            : { data: null }
        ),
        { user: { id: 'u1', email: 'a@b.c' } },
      ) as any,
    )

    const res = await POST(form('pro'))

    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('https://checkout.stripe.test/session')
    expect(checkoutSessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'subscription',
        customer: 'cus_existing',
        client_reference_id: 'u1',
        allow_promotion_codes: true,
        line_items: [{ price: 'price_pro', quantity: 1 }],
        metadata: expect.objectContaining({
          nexez_user_id: 'u1',
          nexez_plan: 'pro',
          nexez_price_id: 'price_pro',
          nexez_source: 'billing_page',
        }),
        subscription_data: {
          metadata: expect.objectContaining({
            nexez_user_id: 'u1',
            nexez_plan: 'pro',
            nexez_price_id: 'price_pro',
          }),
        },
      }),
      { idempotencyKey: 'nexez-billing:checkout-session-create:attempt-1' },
    )
    expect(billingAttempt.markReady).toHaveBeenCalledWith('u1', 'attempt-1', 'cs_1')
  })

  it('a live subscription makes a plan change UPDATE the sub in place - no second Checkout Session', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_ready')
    vi.mocked(getBillingPlan).mockReturnValue({ id: 'pro', name: 'Pro' } as any)
    vi.mocked(getPlanPriceId).mockReturnValue('price_pro' as any)
    vi.mocked(createClient).mockReturnValue(
      createSupabaseMock(
        (ctx) => (ctx.table === 'billing_subscriptions' ? { data: { stripe_customer_id: 'cus_existing' } } : { data: null }),
        { user: { id: 'u1', email: 'a@b.c' } },
      ) as any,
    )
    subscriptionsList.mockResolvedValue({
      data: [{ id: 'sub_live', status: 'active', items: { data: [{ id: 'si_1', price: { id: 'price_launch' } }] } }],
    })
    subscriptionsUpdate.mockResolvedValue({ id: 'sub_live', status: 'active' })

    const res = await POST(form('pro'))

    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toContain('plan_changed=pro')
    expect(subscriptionsUpdate).toHaveBeenCalledWith(
      'sub_live',
      expect.objectContaining({
        items: [{ id: 'si_1', price: 'price_pro' }],
        proration_behavior: 'create_prorations',
      }),
      { idempotencyKey: 'nexez-billing:subscription-update:attempt-1' },
    )
    expect(checkoutSessionsCreate).not.toHaveBeenCalled()
  })

  it('does not create a hosted session while another checkout owns the account slot', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_ready')
    vi.mocked(getBillingPlan).mockReturnValue({ id: 'pro', name: 'Pro' } as any)
    vi.mocked(getPlanPriceId).mockReturnValue('price_pro' as any)
    vi.mocked(createClient).mockReturnValue(
      createSupabaseMock(() => ({ data: { stripe_customer_id: 'cus_existing' } }), { user: { id: 'u1', email: 'a@b.c' } }) as any,
    )
    billingAttempt.claim.mockResolvedValue({ ok: false, reason: 'busy' })

    const res = await POST(form('pro'))

    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toContain('error=checkout_busy')
    expect(checkoutSessionsCreate).not.toHaveBeenCalled()
  })
})

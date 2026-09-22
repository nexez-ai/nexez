import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextResponse } from 'next/server'
import { createSupabaseMock } from '../../../../test/supabase-mock'

const { customersCreate, checkoutExpire, subscriptionsCreate, subscriptionsList, subscriptionsUpdate, subscriptionsCancel } = vi.hoisted(() => ({
  customersCreate: vi.fn(),
  checkoutExpire: vi.fn(),
  subscriptionsCreate: vi.fn(),
  subscriptionsList: vi.fn(),
  subscriptionsUpdate: vi.fn(),
  subscriptionsCancel: vi.fn(),
}))
const billingAttempt = vi.hoisted(() => ({
  claim: vi.fn(),
  markReady: vi.fn(),
  release: vi.fn(),
  retire: vi.fn(),
}))
const rateLimitRef = vi.hoisted(() => ({ response: null as NextResponse | null }))

vi.mock('stripe', () => ({
  default: class {
    customers = { create: customersCreate }
    checkout = { sessions: { expire: checkoutExpire } }
    subscriptions = { create: subscriptionsCreate, list: subscriptionsList, update: subscriptionsUpdate, cancel: subscriptionsCancel }
  },
}))
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ getAll: () => [], get: () => undefined, set: () => {} })) }))
vi.mock('../../../../lib/rate-limit', () => ({
  enforceRateLimit: vi.fn(async () => rateLimitRef.response),
}))
vi.mock('../../../../utils/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('../../../../utils/supabase/admin', () => ({
  hasSupabaseAdminEnv: vi.fn(() => false),
  createAdminClient: vi.fn(),
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

const jsonRequest = (body: Record<string, unknown>) =>
  new Request('https://nexez.test/api/billing/create-subscription', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('POST /api/billing/create-subscription', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getOwnerShopifyBillingContext).mockResolvedValue(null)
    vi.mocked(hasSupabaseAdminEnv).mockReturnValue(true)
    vi.mocked(createAdminClient).mockReturnValue(createSupabaseMock(() => ({ data: null, error: null })) as any)
    vi.mocked(isUniqueSelfServePlanPrice).mockReturnValue(true)
    // Default: the customer has NO live subscription, so create-subscription proceeds
    // to mint the first one. Tests exercising a plan change override this.
    subscriptionsList.mockResolvedValue({ data: [] })
    subscriptionsCancel.mockResolvedValue({})
    billingAttempt.claim.mockResolvedValue({ ok: true, attempt: { attempt_key: 'attempt-1' }, reused: false })
    billingAttempt.markReady.mockResolvedValue(true)
    billingAttempt.release.mockResolvedValue(true)
    billingAttempt.retire.mockResolvedValue('preserved')
    rateLimitRef.response = null
  })
  afterEach(() => vi.unstubAllEnvs())

  it('rate limits before validating or parsing the request body', async () => {
    rateLimitRef.response = NextResponse.json({ error: 'rate limited' }, { status: 429 })

    const res = await POST(new Request('https://nexez.test/api/billing/create-subscription', {
      method: 'POST',
      body: JSON.stringify({ plan: 'pro' }),
    }))

    expect(res.status).toBe(429)
    expect(getBillingPlan).not.toHaveBeenCalled()
  })

  it('rejects unsupported plans', async () => {
    vi.mocked(getBillingPlan).mockReturnValue(null as any)

    const res = await POST(jsonRequest({ plan: 'bogus' }))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toContain('Invalid')
  })

  it('requires authentication', async () => {
    vi.mocked(getBillingPlan).mockReturnValue({ id: 'pro', name: 'Pro' } as any)
    vi.mocked(createClient).mockReturnValue(createSupabaseMock(() => ({ data: null }), { user: null }) as any)

    const res = await POST(jsonRequest({ plan: 'pro' }))

    expect(res.status).toBe(401)
  })

  it('blocks Stripe subscription creation for Shopify-linked owners', async () => {
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

    const res = await POST(jsonRequest({ plan: 'pro' }))

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({ provider: 'shopify' })
    expect(subscriptionsCreate).not.toHaveBeenCalled()
  })

  it('returns setup guidance when Stripe or the plan price is missing', async () => {
    vi.mocked(getBillingPlan).mockReturnValue({ id: 'pro', name: 'Pro' } as any)
    vi.mocked(getPlanPriceId).mockReturnValue('')
    vi.mocked(createClient).mockReturnValue(createSupabaseMock(() => ({ data: null }), { user: { id: 'u1', email: 'a@b.c' } }) as any)

    const res = await POST(jsonRequest({ plan: 'pro' }))
    const body = await res.json()

    expect(res.status).toBe(412)
    expect(body.error).toContain('not configured')
  })

  it('rejects product ids before contacting Stripe', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_ready')
    vi.mocked(getBillingPlan).mockReturnValue({ id: 'pro', name: 'Pro' } as any)
    vi.mocked(getPlanPriceId).mockReturnValue('prod_wrong')
    vi.mocked(createClient).mockReturnValue(createSupabaseMock(() => ({ data: null }), { user: { id: 'u1', email: 'a@b.c' } }) as any)

    const res = await POST(jsonRequest({ plan: 'pro' }))
    const body = await res.json()

    expect(res.status).toBe(412)
    expect(body.error).toContain('Price ID')
    expect(subscriptionsCreate).not.toHaveBeenCalled()
  })

  it('rejects a Stripe Price mapped to more than one self-serve plan', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_ready')
    vi.mocked(getBillingPlan).mockReturnValue({ id: 'pro', name: 'Pro' } as any)
    vi.mocked(getPlanPriceId).mockReturnValue('price_shared')
    vi.mocked(isUniqueSelfServePlanPrice).mockReturnValue(false)
    vi.mocked(createClient).mockReturnValue(createSupabaseMock(() => ({ data: null }), { user: { id: 'u1', email: 'a@b.c' } }) as any)

    const res = await POST(jsonRequest({ plan: 'pro' }))
    const body = await res.json()

    expect(res.status).toBe(412)
    expect(body.error).toContain('distinct Price ID')
    expect(subscriptionsCreate).not.toHaveBeenCalled()
  })

  it('creates an incomplete subscription and returns the invoice confirmation_secret', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_ready')
    vi.mocked(getBillingPlan).mockReturnValue({ id: 'pro', name: 'Pro' } as any)
    vi.mocked(getPlanPriceId).mockReturnValue('price_pro')
    vi.mocked(createClient).mockReturnValue(
      createSupabaseMock(
        (ctx) => (ctx.table === 'billing_subscriptions' ? { data: { stripe_customer_id: 'cus_existing' } } : { data: null }),
        { user: { id: 'u1', email: 'a@b.c' } },
      ) as any,
    )
    // Stripe API 2025-Basil+ shape: client secret lives on latest_invoice.confirmation_secret.
    subscriptionsCreate.mockResolvedValue({
      id: 'sub_1',
      latest_invoice: { confirmation_secret: { client_secret: 'pi_secret_123' } },
    })

    const res = await POST(jsonRequest({ plan: 'pro' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.clientSecret).toBe('pi_secret_123')
    expect(subscriptionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: 'cus_existing',
        items: [{ price: 'price_pro' }],
        payment_behavior: 'default_incomplete',
        expand: ['latest_invoice.confirmation_secret'],
        metadata: expect.objectContaining({
          nexez_user_id: 'u1',
          nexez_plan: 'pro',
          nexez_price_id: 'price_pro',
          nexez_source: 'embedded_billing',
        }),
      }),
      { idempotencyKey: 'nexez-billing:subscription-create:attempt-1' },
    )
  })

  it('falls back to latest_invoice.payment_intent for older Stripe API versions', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_ready')
    vi.mocked(getBillingPlan).mockReturnValue({ id: 'pro', name: 'Pro' } as any)
    vi.mocked(getPlanPriceId).mockReturnValue('price_pro')
    vi.mocked(createClient).mockReturnValue(
      createSupabaseMock(
        (ctx) => (ctx.table === 'billing_subscriptions' ? { data: { stripe_customer_id: 'cus_existing' } } : { data: null }),
        { user: { id: 'u1', email: 'a@b.c' } },
      ) as any,
    )
    subscriptionsCreate.mockResolvedValue({
      id: 'sub_1',
      latest_invoice: { payment_intent: { client_secret: 'pi_legacy_456' } },
    })

    const res = await POST(jsonRequest({ plan: 'pro' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.clientSecret).toBe('pi_legacy_456')
  })

  it('500s with actionable copy when the invoice carries no client secret', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_ready')
    vi.mocked(getBillingPlan).mockReturnValue({ id: 'pro', name: 'Pro' } as any)
    vi.mocked(getPlanPriceId).mockReturnValue('price_pro')
    vi.mocked(createClient).mockReturnValue(
      createSupabaseMock(
        (ctx) => (ctx.table === 'billing_subscriptions' ? { data: { stripe_customer_id: 'cus_existing' } } : { data: null }),
        { user: { id: 'u1', email: 'a@b.c' } },
      ) as any,
    )
    subscriptionsCreate.mockResolvedValue({ id: 'sub_1', latest_invoice: {} })

    const res = await POST(jsonRequest({ plan: 'pro' }))
    expect(res.status).toBe(500)
  })

  it('UPDATES the existing live subscription on a plan change instead of creating a second (no double-billing)', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_ready')
    vi.mocked(getBillingPlan).mockReturnValue({ id: 'pro', name: 'Pro' } as any)
    vi.mocked(getPlanPriceId).mockReturnValue('price_pro')
    vi.mocked(createClient).mockReturnValue(
      createSupabaseMock(
        (ctx) => (ctx.table === 'billing_subscriptions' ? { data: { stripe_customer_id: 'cus_existing', plan_id: 'launch', status: 'active' } } : { data: null }),
        { user: { id: 'u1', email: 'a@b.c' } },
      ) as any,
    )
    // Customer already has a LIVE (active) subscription on a different price.
    subscriptionsList.mockResolvedValue({
      data: [{ id: 'sub_live', status: 'active', items: { data: [{ id: 'si_1', price: { id: 'price_launch' } }] } }],
    })
    subscriptionsUpdate.mockResolvedValue({ id: 'sub_live', status: 'active' })

    const res = await POST(jsonRequest({ plan: 'pro' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.planChanged).toBe(true)
    expect(body.subscriptionId).toBe('sub_live')
    // The critical assertion: we UPDATED the existing sub's item, never created a 2nd.
    expect(subscriptionsUpdate).toHaveBeenCalledWith(
      'sub_live',
      expect.objectContaining({
        items: [{ id: 'si_1', price: 'price_pro' }],
        proration_behavior: 'create_prorations',
      }),
      { idempotencyKey: 'nexez-billing:subscription-update:attempt-1' },
    )
    expect(subscriptionsCreate).not.toHaveBeenCalled()
  })

  it('is a no-op when the live subscription is already on the requested plan', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_ready')
    vi.mocked(getBillingPlan).mockReturnValue({ id: 'pro', name: 'Pro' } as any)
    vi.mocked(getPlanPriceId).mockReturnValue('price_pro')
    vi.mocked(createClient).mockReturnValue(
      createSupabaseMock(
        (ctx) => (ctx.table === 'billing_subscriptions' ? { data: { stripe_customer_id: 'cus_existing', plan_id: 'pro', status: 'active' } } : { data: null }),
        { user: { id: 'u1', email: 'a@b.c' } },
      ) as any,
    )
    subscriptionsList.mockResolvedValue({
      data: [{ id: 'sub_live', status: 'active', items: { data: [{ id: 'si_1', price: { id: 'price_pro' } }] } }],
    })

    const res = await POST(jsonRequest({ plan: 'pro' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.alreadyOnPlan).toBe(true)
    expect(subscriptionsUpdate).not.toHaveBeenCalled()
    expect(subscriptionsCreate).not.toHaveBeenCalled()
  })

  it('an incomplete_expired sub is NOT live: a plan pick creates the first real subscription', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_ready')
    vi.mocked(getBillingPlan).mockReturnValue({ id: 'pro', name: 'Pro' } as any)
    vi.mocked(getPlanPriceId).mockReturnValue('price_pro')
    vi.mocked(createClient).mockReturnValue(
      createSupabaseMock(
        (ctx) => (ctx.table === 'billing_subscriptions' ? { data: { stripe_customer_id: 'cus_existing', plan_id: null, status: 'incomplete' } } : { data: null }),
        { user: { id: 'u1', email: 'a@b.c' } },
      ) as any,
    )
    subscriptionsList.mockResolvedValue({ data: [{ id: 'sub_dead', status: 'incomplete_expired', items: { data: [{ id: 'si_x', price: { id: 'price_pro' } }] } }] })
    subscriptionsCreate.mockResolvedValue({ id: 'sub_new', latest_invoice: { confirmation_secret: { client_secret: 'pi_secret_123' } } })

    const res = await POST(jsonRequest({ plan: 'pro' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.clientSecret).toBe('pi_secret_123')
    expect(subscriptionsUpdate).not.toHaveBeenCalled()
    expect(subscriptionsCreate).toHaveBeenCalledOnce()
  })

  it('reuses an existing incomplete subscription for the same plan instead of creating another', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_ready')
    vi.mocked(getBillingPlan).mockReturnValue({ id: 'pro', name: 'Pro' } as any)
    vi.mocked(getPlanPriceId).mockReturnValue('price_pro')
    vi.mocked(createClient).mockReturnValue(
      createSupabaseMock(
        (ctx) => (ctx.table === 'billing_subscriptions' ? { data: { stripe_customer_id: 'cus_existing' } } : { data: null }),
        { user: { id: 'u1', email: 'a@b.c' } },
      ) as any,
    )
    subscriptionsList.mockResolvedValue({
      data: [{
        id: 'sub_pending',
        status: 'incomplete',
        items: { data: [{ id: 'si_pending', price: { id: 'price_pro' } }] },
        latest_invoice: { confirmation_secret: { client_secret: 'pi_pending_secret' } },
      }],
    })

    const res = await POST(jsonRequest({ plan: 'pro' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({ reusedPending: true, subscriptionId: 'sub_pending', clientSecret: 'pi_pending_secret' })
    expect(subscriptionsCreate).not.toHaveBeenCalled()
    expect(billingAttempt.markReady).toHaveBeenCalledWith('u1', 'attempt-1', 'sub_pending')
  })

  it('fails closed when another plan checkout already owns the account slot', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_ready')
    vi.mocked(getBillingPlan).mockReturnValue({ id: 'pro', name: 'Pro' } as any)
    vi.mocked(getPlanPriceId).mockReturnValue('price_pro')
    vi.mocked(createClient).mockReturnValue(
      createSupabaseMock(() => ({ data: { stripe_customer_id: 'cus_existing' } }), { user: { id: 'u1', email: 'a@b.c' } }) as any,
    )
    billingAttempt.claim.mockResolvedValue({ ok: false, reason: 'busy' })

    const res = await POST(jsonRequest({ plan: 'pro' }))

    expect(res.status).toBe(409)
    expect(subscriptionsList).not.toHaveBeenCalled()
    expect(subscriptionsCreate).not.toHaveBeenCalled()
  })

  it('returns setup guidance instead of a 500 when Stripe cannot find the configured price', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_ready')
    vi.mocked(getBillingPlan).mockReturnValue({ id: 'pro', name: 'Pro' } as any)
    vi.mocked(getPlanPriceId).mockReturnValue('price_missing')
    vi.mocked(createClient).mockReturnValue(
      createSupabaseMock(
        (ctx) => (ctx.table === 'billing_subscriptions' ? { data: { stripe_customer_id: 'cus_existing' } } : { data: null }),
        { user: { id: 'u1', email: 'a@b.c' } },
      ) as any,
    )
    subscriptionsCreate.mockRejectedValue({ message: 'No such price: price_missing', code: 'resource_missing', param: 'items[0][price]' })

    const res = await POST(jsonRequest({ plan: 'pro' }))
    const body = await res.json()

    expect(res.status).toBe(412)
    expect(body.error).toContain('misconfigured')
  })
})

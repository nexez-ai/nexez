import Stripe from 'stripe'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { appUrl } from '../../../../lib/site'
import { getBillingPlan, getPlanPriceId, isSelfServePlanId, isStripePriceId, isUniqueSelfServePlanPrice } from '../../../../lib/billing'
import { createClient } from '../../../../utils/supabase/server'
import { createAdminClient, hasSupabaseAdminEnv } from '../../../../utils/supabase/admin'
import { getSubscriptionPriceId, pickLiveStripeSubscription } from '../../../../lib/stripe-billing'
import { enforceRateLimit } from '../../../../lib/rate-limit'
import {
  claimBillingCheckoutAttempt,
  markBillingCheckoutAttemptReady,
  releaseBillingCheckoutAttempt,
  retireSupersededBillingObject,
  stripeBillingIdempotencyKey,
} from '../../../../lib/server/billing-checkout-attempt'
import { getOwnerShopifyBillingContext } from '../../../../lib/server/shopify-billing'

// /login and /dashboard/billing live on the APP host (app.nexez.ai), so build
// these redirects with appUrl() - getBaseUrl() returns the agent-runtime host
// (nexez.app) and would mint a wrong-host URL that the proxy then has to re-redirect.
export async function POST(request: Request) {
  const rateLimited = await enforceRateLimit(request, 'billing-checkout', 12, 60_000, { failClosed: true })
  if (rateLimited) return rateLimited

  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (contentType !== 'application/x-www-form-urlencoded' && contentType !== 'multipart/form-data') {
    return NextResponse.json(
      { error: 'unsupported_media_type', message: 'Submit billing checkout as form data.' },
      { status: 415 },
    )
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'invalid_form_data' }, { status: 400 })
  }
  const planId = String(formData.get('plan') || '')
  const plan = getBillingPlan(planId)

  if (!plan || !isSelfServePlanId(plan.id)) {
    return NextResponse.redirect(appUrl('/dashboard/billing?error=plan'), 303)
  }

  const cookieStore = await cookies()
  const supabase = createClient(cookieStore)
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.redirect(appUrl(`/login?next=/dashboard/billing?plan=${plan.id}`), 303)
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({ error: 'Billing ownership verification is unavailable. Please try again shortly.' }, { status: 503 })
  }
  try {
    const shopifyBilling = await getOwnerShopifyBillingContext(createAdminClient(), user.id, cookieStore.get('shopify_pending_shop')?.value)
    if (shopifyBilling) return NextResponse.redirect(shopifyBilling.pricingUrl, 303)
  } catch {
    return NextResponse.json({ error: 'Could not verify billing ownership. Please try again shortly.' }, { status: 503 })
  }

  const priceId = getPlanPriceId(plan)

  if (!process.env.STRIPE_SECRET_KEY || !priceId) {
    return NextResponse.redirect(appUrl('/dashboard/billing?setup=stripe'), 303)
  }

  if (!isStripePriceId(priceId)) {
    return NextResponse.redirect(appUrl('/dashboard/billing?error=bad_price_id'), 303)
  }
  if (!isUniqueSelfServePlanPrice(plan)) {
    return NextResponse.redirect(appUrl('/dashboard/billing?error=duplicate_price_id'), 303)
  }

  const { data: billingState } = await supabase
    .from('billing_subscriptions')
    .select('stripe_customer_id, stripe_subscription_id, status')
    .eq('owner_id', user.id)
    .maybeSingle<{ stripe_customer_id: string | null; stripe_subscription_id: string | null; status: string | null }>()

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
  const claim = await claimBillingCheckoutAttempt({ ownerId: user.id, planId: plan.id, flow: 'hosted' })
  if (!claim.ok) {
    return NextResponse.redirect(
      appUrl(`/dashboard/billing?error=${claim.reason === 'busy' ? 'checkout_busy' : 'checkout_unavailable'}`),
      303,
    )
  }
  const attempt = claim.attempt

  if (claim.superseded?.stripe_object_id) {
    const staleId = claim.superseded.stripe_object_id
    try {
      await retireSupersededBillingObject(stripe, staleId)
    } catch (error) {
      console.warn('[billing/checkout] stale checkout cleanup failed', {
        objectId: staleId,
        message: error instanceof Error ? error.message : 'unknown',
      })
    }
  }

  // Plan CHANGE, not first purchase: a customer with a live subscription gets its
  // price switched in place (prorated) - a second Checkout Session would mint a
  // second concurrent subscription and double-bill every cycle.
  if (billingState?.stripe_customer_id) {
    try {
      const existing = await stripe.subscriptions.list({
        customer: billingState.stripe_customer_id,
        status: 'all',
        limit: 20,
        expand: ['data.items.data.price'],
      })
      const live = pickLiveStripeSubscription(existing.data)
      if (live) {
        if (getSubscriptionPriceId(live) === priceId) {
          await releaseBillingCheckoutAttempt(user.id, attempt.attempt_key)
          return NextResponse.redirect(appUrl('/dashboard/billing?already_on_plan=1'), 303)
        }
        const item = live.items?.data?.[0]
        if (!item) {
          console.error('[billing/checkout] live subscription has no item to update', { subId: live.id })
          return NextResponse.redirect(appUrl('/dashboard/billing?error=stripe'), 303)
        }
        const updated = await stripe.subscriptions.update(
          live.id,
          {
            items: [{ id: item.id, price: priceId }],
            proration_behavior: 'create_prorations',
            metadata: {
              nexez_user_id: user.id,
              nexez_plan: plan.id,
              nexez_price_id: priceId,
              nexez_source: 'billing_page_plan_change',
            },
          },
          { idempotencyKey: stripeBillingIdempotencyKey(attempt.attempt_key, 'subscription-update') },
        )
        // Optimistic sync from REAL Stripe state; the subscription.updated webhook re-confirms.
        if (hasSupabaseAdminEnv()) {
          await createAdminClient()
            .from('billing_subscriptions')
            .update({ plan_id: plan.id, stripe_price_id: priceId, stripe_subscription_id: updated.id, status: updated.status })
            .eq('owner_id', user.id)
        }
        await releaseBillingCheckoutAttempt(user.id, attempt.attempt_key)
        return NextResponse.redirect(appUrl(`/dashboard/billing?plan_changed=${plan.id}`), 303)
      }
    } catch (err) {
      console.error('[billing/checkout] plan-change path failed', err)
      return NextResponse.redirect(appUrl('/dashboard/billing?error=stripe'), 303)
    }
  }

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: 'subscription',
    client_reference_id: user.id,
    ...(billingState?.stripe_customer_id
      ? { customer: billingState.stripe_customer_id }
      : { customer_email: user.email || undefined }),
    allow_promotion_codes: true,
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    success_url: appUrl(`/dashboard/billing/success?session_id={CHECKOUT_SESSION_ID}&plan=${plan.id}`),
    cancel_url: appUrl('/dashboard/billing?canceled=1'),
    metadata: {
      nexez_user_id: user.id,
      nexez_plan: plan.id,
      nexez_price_id: priceId,
      nexez_source: 'billing_page',
    },
    subscription_data: {
      metadata: {
        nexez_user_id: user.id,
        nexez_plan: plan.id,
        nexez_price_id: priceId,
      },
    },
  }

  let session
  try {
    session = await stripe.checkout.sessions.create(
      sessionParams,
      { idempotencyKey: stripeBillingIdempotencyKey(attempt.attempt_key, 'checkout-session-create') },
    )
    await markBillingCheckoutAttemptReady(user.id, attempt.attempt_key, session.id)
  } catch (err: any) {
    console.error('[billing/checkout] Failed to create Stripe Checkout Session', err)

    let target = appUrl('/dashboard/billing?error=stripe')

    if (err.message && err.message.toLowerCase().includes('no such price')) {
      target = appUrl('/dashboard/billing?error=bad_price_id')
      // Note: the real cause is almost always STRIPE_PRICE_* env var set to a prod_xxx (product) instead of price_xxx (price)
    }

    return NextResponse.redirect(target, 303)
  }

  return NextResponse.redirect(session.url || appUrl('/dashboard/billing'), 303)
}

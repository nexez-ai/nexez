import Stripe from 'stripe'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '../../../../utils/supabase/server'
import { createAdminClient, hasSupabaseAdminEnv } from '../../../../utils/supabase/admin'
import { getBillingPlan, getPlanPriceId, isSelfServePlanId, isStripePriceId, isUniqueSelfServePlanPrice } from '../../../../lib/billing'
import { getSubscriptionPriceId, pickLiveStripeSubscription } from '../../../../lib/stripe-billing'
import {
  claimBillingCheckoutAttempt,
  markBillingCheckoutAttemptReady,
  releaseBillingCheckoutAttempt,
  retireSupersededBillingObject,
  stripeBillingIdempotencyKey,
} from '../../../../lib/server/billing-checkout-attempt'
import { enforceRateLimit } from '../../../../lib/rate-limit'
import { getOwnerShopifyBillingContext } from '../../../../lib/server/shopify-billing'

/**
 * Creates a Stripe Subscription for recurring paid plans using Embedded Components flow.
 * 
 * Returns a client_secret from the Subscription's latest invoice confirmation secret
 * so the client can use <PaymentElement> + stripe.confirmPayment() without leaving the page.
 * 
 * - Only for self-serve paid plans (Launch/Pro/Scale). Enterprise uses sales-assisted billing.
 * - Separate from transaction commissions (handled via Stripe Connect + app fees in /api/checkout).
 * - Webhook (customer.subscription.* + checkout if any) will sync full state to billing_subscriptions.
 * - Production: errors logged, auth required, env checks, customer reuse.
 */

export async function POST(request: Request) {
  const rateLimited = await enforceRateLimit(request, 'billing-create-subscription', 12, 60_000, { failClosed: true })
  if (rateLimited) return rateLimited
  try {
    const body = await request.json().catch(() => ({}))
    const planId = String(body.plan || body.planId || '')
    const plan = getBillingPlan(planId)

    if (!plan || !isSelfServePlanId(plan.id)) {
      return NextResponse.json(
        { error: 'Invalid or unsupported plan for self-serve subscription. Use Enterprise contact sales or Free tier.' },
        { status: 400 }
      )
    }

    const cookieStore = await cookies()
    const supabase = createClient(cookieStore)
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    if (!hasSupabaseAdminEnv()) {
      return NextResponse.json({ error: 'Billing ownership verification is unavailable. Please try again shortly.' }, { status: 503 })
    }
    try {
      const shopifyBilling = await getOwnerShopifyBillingContext(createAdminClient(), user.id, cookieStore.get('shopify_pending_shop')?.value)
      if (shopifyBilling) {
        return NextResponse.json(
          {
            error: 'This account is billed through Shopify. Manage its plan in Shopify admin.',
            provider: 'shopify',
            pricingUrl: shopifyBilling.pricingUrl,
          },
          { status: 409 },
        )
      }
    } catch {
      return NextResponse.json({ error: 'Could not verify billing ownership. Please try again shortly.' }, { status: 503 })
    }

    const priceId = getPlanPriceId(plan)
    if (!process.env.STRIPE_SECRET_KEY || !priceId) {
      console.error('[billing/create-subscription] Stripe not configured for plan', plan.id)
      return NextResponse.json({ error: 'Stripe Billing is not configured for this plan yet. Add the Stripe secret key and plan Price ID, then try again.' }, { status: 412 })
    }
    // Guard the common misconfiguration up front: a value that isn't a Stripe Price ID
    // (e.g. a "prod_…" product id pasted by mistake) would otherwise reach Stripe and
    // 500. A TEST price id under LIVE keys still passes this check - Stripe's "no such
    // price" path below catches that and returns the same actionable guidance.
    if (!isStripePriceId(priceId)) {
      console.error('[billing/create-subscription] plan price id is not a Stripe Price id', { plan: plan.id, priceId })
      return NextResponse.json(
        { error: 'Stripe Billing for this plan is misconfigured: the configured value is not a Stripe Price ID (it must start with "price_"). Set the plan’s STRIPE_PRICE_… env var to the live Price ID and redeploy.' },
        { status: 412 },
      )
    }
    if (!isUniqueSelfServePlanPrice(plan)) {
      console.error('[billing/create-subscription] duplicate self-serve Stripe Price mapping', { plan: plan.id })
      return NextResponse.json(
        { error: 'Stripe Billing is misconfigured: Launch, Pro, and Scale must each use a distinct Price ID.' },
        { status: 412 },
      )
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

    // Get or reuse existing customer from our billing_subscriptions (dual model row)
    const { data: billingState } = await supabase
      .from('billing_subscriptions')
      .select('stripe_customer_id, plan_id, status')
      .eq('owner_id', user.id)
      .maybeSingle<{ stripe_customer_id: string | null; plan_id: string | null; status: string | null }>()

    let customerId = billingState?.stripe_customer_id || null

    const claim = await claimBillingCheckoutAttempt({ ownerId: user.id, planId: plan.id, flow: 'embedded' })
    if (!claim.ok) {
      return NextResponse.json(
        {
          error: claim.reason === 'busy'
            ? 'Another subscription checkout is already open. Finish it or try again in a few minutes.'
            : 'Secure checkout is temporarily unavailable. Please try again shortly.',
        },
        { status: claim.reason === 'busy' ? 409 : 503 },
      )
    }
    const attempt = claim.attempt

    // An expired attempt may still own a Stripe object. Invalidate it before a new
    // checkout starts so an old browser tab cannot later complete a second plan.
  if (claim.superseded?.stripe_object_id) {
    const staleId = claim.superseded.stripe_object_id
    try {
      await retireSupersededBillingObject(stripe, staleId)
    } catch (error) {
        console.warn('[billing/create-subscription] stale checkout cleanup failed', {
          objectId: staleId,
          message: error instanceof Error ? error.message : 'unknown',
        })
      }
    }

    if (!customerId) {
      // The attempt key serializes concurrent first-touch requests, including customer
      // creation, so two tabs cannot mint separate Stripe customers for one owner.
      const customer = await stripe.customers.create(
        {
          email: user.email || undefined,
          metadata: {
            nexez_user_id: user.id,
            nexez_source: 'embedded_subscription',
          },
        },
        { idempotencyKey: stripeBillingIdempotencyKey(attempt.attempt_key, 'customer-create') },
      )
      customerId = customer.id

      // Link the customer so the webhook can find it by owner_id. Deliberately DO NOT
      // write plan_id (payment hasn't happened) and NEVER overwrite an existing row's
      // status: stamping 'incomplete' over a live 'trialing'/'paused' row killed the
      // no-card trial's entitlements and permanently un-paused paused storefronts.
      if (hasSupabaseAdminEnv()) {
        const admin = createAdminClient()
        if (billingState) {
          const { error: linkError } = await admin
            .from('billing_subscriptions')
            .update({ stripe_customer_id: customerId })
            .eq('owner_id', user.id)
          if (linkError) console.error('[billing/create-subscription] failed to persist stripe_customer_id', linkError)
        } else {
          const { error: linkError } = await admin.from('billing_subscriptions').insert({
            owner_id: user.id,
            stripe_customer_id: customerId,
            status: 'incomplete',
            metadata: { source: 'create-subscription', created_via: 'embedded' },
          })
          if (linkError && linkError.code !== '23505') {
            console.error('[billing/create-subscription] failed to persist stripe_customer_id', linkError)
          }
        }
      }
    }

    // Plan CHANGE, not first purchase: if this customer already has a live subscription,
    // switch its price in place (prorated) instead of minting a second one. Creating a
    // new subscription here double-billed the customer every cycle and made the two
    // subs' webhook events flip-flop billing_subscriptions (plan + commission oscillated).
    const existing = await stripe.subscriptions.list({
      customer: customerId,
      status: 'all',
      limit: 20,
      expand: ['data.items.data.price', 'data.latest_invoice.confirmation_secret'],
    })
    const live = pickLiveStripeSubscription(existing.data)
    if (live) {
      if (getSubscriptionPriceId(live) === priceId) {
        await releaseBillingCheckoutAttempt(user.id, attempt.attempt_key)
        return NextResponse.json({ ok: true, alreadyOnPlan: true, planId: plan.id, subscriptionId: live.id })
      }
      const item = live.items?.data?.[0]
      if (!item) {
        console.error('[billing/create-subscription] live subscription has no item to update', { subId: live.id })
        return NextResponse.json({ error: 'Your current subscription could not be updated. Please contact support.' }, { status: 500 })
      }
      const updated = await stripe.subscriptions.update(
        live.id,
        {
          items: [{ id: item.id, price: priceId }],
          proration_behavior: 'create_prorations',
          payment_settings: { save_default_payment_method: 'on_subscription' },
          metadata: {
            nexez_user_id: user.id,
            nexez_plan: plan.id,
            nexez_price_id: priceId,
            nexez_source: 'embedded_billing_plan_change',
          },
        },
        { idempotencyKey: stripeBillingIdempotencyKey(attempt.attempt_key, 'subscription-update') },
      )
      // Optimistic sync from REAL Stripe state so the page reflects the switch
      // immediately; the customer.subscription.updated webhook re-confirms.
      if (hasSupabaseAdminEnv()) {
        const { error: syncError } = await createAdminClient()
          .from('billing_subscriptions')
          .update({
            plan_id: plan.id,
            stripe_price_id: priceId,
            stripe_subscription_id: updated.id,
            status: updated.status,
          })
          .eq('owner_id', user.id)
        if (syncError) console.warn('[billing/create-subscription] plan-change row sync failed (webhook will heal)', syncError)
      }
      await releaseBillingCheckoutAttempt(user.id, attempt.attempt_key)
      return NextResponse.json({ ok: true, planChanged: true, planId: plan.id, subscriptionId: updated.id })
    }

    // Resume an already-open Payment Element for this plan. This is both better UX
    // and a second layer of duplicate protection when a request is retried later.
    const pending = existing.data.find((subscription) =>
      subscription.status === 'incomplete' && getSubscriptionPriceId(subscription) === priceId,
    )
    if (pending) {
      const clientSecret = subscriptionInvoiceClientSecret(pending)
      if (!clientSecret) {
        return NextResponse.json({ error: 'Could not resume the existing checkout. Please try again shortly.' }, { status: 409 })
      }
      await markBillingCheckoutAttemptReady(user.id, attempt.attempt_key, pending.id)
      return NextResponse.json({
        ok: true,
        reusedPending: true,
        subscriptionId: pending.id,
        clientSecret,
        customerId,
        planId: plan.id,
        priceId,
      })
    }

    // A different abandoned plan must not remain payable in an old tab.
    for (const stale of existing.data.filter((subscription) => subscription.status === 'incomplete')) {
      await stripe.subscriptions.cancel(stale.id)
    }

    // Create the subscription in incomplete state so we get a client_secret for Elements.
    // This is the standard pattern for Stripe Embedded + Subscriptions (Payment Element).
    const subscription = await stripe.subscriptions.create(
      {
        customer: customerId,
        items: [{ price: priceId }],
        payment_behavior: 'default_incomplete',
        payment_settings: {
          save_default_payment_method: 'on_subscription',
        },
        // Stripe API 2025-Basil+ moved the invoice's client secret off
        // latest_invoice.payment_intent onto latest_invoice.confirmation_secret. Expand
        // confirmation_secret and read its PaymentIntent client secret for Elements.
        expand: ['latest_invoice.confirmation_secret'],
        metadata: {
          nexez_user_id: user.id,
          nexez_plan: plan.id,
          nexez_price_id: priceId,
          nexez_source: 'embedded_billing',
        },
      },
      { idempotencyKey: stripeBillingIdempotencyKey(attempt.attempt_key, 'subscription-create') },
    )

    await markBillingCheckoutAttemptReady(user.id, attempt.attempt_key, subscription.id)
    const clientSecret = subscriptionInvoiceClientSecret(subscription)

    if (!clientSecret) {
      console.error('[billing/create-subscription] No client_secret on invoice', { subId: subscription.id })
      return NextResponse.json({ error: 'Failed to initialize payment for subscription.' }, { status: 500 })
    }

    // Return everything the client needs for <Elements> + confirmPayment
    return NextResponse.json({
      ok: true,
      subscriptionId: subscription.id,
      clientSecret,
      customerId,
      planId: plan.id,
      priceId,
      // status will be 'incomplete' until confirmed + webhook
    })
  } catch (err: any) {
    console.error('[billing/create-subscription] Error creating embedded subscription', err)

    if (isStripePriceMisconfigurationError(err)) {
      return NextResponse.json(
        {
          error:
            'Stripe Billing for this plan is misconfigured. Open the plan in Stripe, copy the live Price ID from the pricing section, update STRIPE_PRICE_…, then redeploy.',
        },
        { status: 412 },
      )
    }

    return NextResponse.json({ error: 'Could not start secure checkout. Please try again or contact support if this continues.' }, { status: 500 })
  }
}

function isStripePriceMisconfigurationError(err: any) {
  const message = String(err?.message || '').toLowerCase()
  const code = String(err?.code || '')
  const param = String(err?.param || '')

  return message.includes('no such price') || (code === 'resource_missing' && param.includes('price'))
}

function subscriptionInvoiceClientSecret(subscription: Pick<Stripe.Subscription, 'latest_invoice'>): string | null {
  const invoice = subscription.latest_invoice as
    | { confirmation_secret?: { client_secret?: string | null } | null; payment_intent?: { client_secret?: string | null } | null }
    | null
  return invoice?.confirmation_secret?.client_secret ?? invoice?.payment_intent?.client_secret ?? null
}

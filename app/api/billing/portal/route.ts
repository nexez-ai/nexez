import Stripe from 'stripe'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { appUrl } from '../../../../lib/site'
import { createClient } from '../../../../utils/supabase/server'
import { createAdminClient, hasSupabaseAdminEnv } from '../../../../utils/supabase/admin'
import { enforceRateLimit } from '../../../../lib/rate-limit'
import { getOwnerShopifyBillingContext } from '../../../../lib/server/shopify-billing'

/**
 * Stripe Billing Portal for Nexez subscriptions.
 * Creates a portal session so users can manage their subscription, update
 * payment methods, cancel, etc. /login + /dashboard/billing live on the APP host,
 * so redirects use appUrl() (not getBaseUrl(), which is the agent-runtime host).
 */
export async function POST(request: Request) {
  const rateLimited = await enforceRateLimit(request, 'billing-portal', 12, 60_000, { failClosed: true })
  if (rateLimited) return rateLimited

  const cookieStore = await cookies()
  const supabase = createClient(cookieStore)
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.redirect(appUrl('/login?next=/dashboard/billing'), 303)
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

  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.redirect(appUrl('/dashboard/billing?setup=stripe'), 303)
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

  try {
    const { data: billingState } = await supabase
      .from('billing_subscriptions')
      .select('stripe_customer_id')
      .eq('owner_id', user.id)
      .maybeSingle<{ stripe_customer_id: string | null }>()

    let customerId = billingState?.stripe_customer_id || null
    let resolvedByFallback = false

    if (!customerId) {
      // Best effort fallback for accounts created before webhook state existed.
      const customers = await stripe.customers.list({
        email: user.email || undefined,
        limit: 1,
      })
      customerId = customers.data[0]?.id || null
      if (customerId) resolvedByFallback = true
    }

    if (!customerId) {
      // Create a minimal customer so the portal works.
      const customer = await stripe.customers.create({
        email: user.email || undefined,
        metadata: { nexez_user_id: user.id },
      })
      customerId = customer.id
      resolvedByFallback = true
    }

    // Persist a customer id resolved/created outside the webhook path so repeated
    // portal opens don't spawn duplicate Stripe customers (writes go through the
    // service-role client - RLS has no user insert/update on billing_subscriptions).
    if (resolvedByFallback && customerId && hasSupabaseAdminEnv()) {
      try {
        const admin = createAdminClient()
        await admin
          .from('billing_subscriptions')
          .upsert({ owner_id: user.id, stripe_customer_id: customerId }, { onConflict: 'owner_id' })
      } catch (persistErr) {
        console.warn('[billing/portal] could not persist stripe_customer_id (non-fatal)', persistErr)
      }
    }

    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: appUrl('/dashboard/billing'),
    })

    return NextResponse.redirect(portal.url || appUrl('/dashboard/billing'), 303)
  } catch (error: any) {
    console.error('Stripe portal error', error)
    return NextResponse.redirect(appUrl('/dashboard/billing?error=portal'), 303)
  }
}

import { getOwnerShopifyBillingContext } from '../../../../lib/server/shopify-billing'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '../../../../utils/supabase/server'
import { createAdminClient, hasSupabaseAdminEnv } from '../../../../utils/supabase/admin'
import { createStripeConnectAccount, createStripeConnectOnboardingLink } from '../../../../lib/stripe-billing'
import { appUrl } from '../../../../lib/site'
import { billingPlans } from '../../../../lib/billing'
import {
  entitlementAllocationRetryBody,
  entitlementAllocationRetryInit,
  isEntitlementAllocationRetry,
} from '../../../../lib/entitlement-allocation-error'
import Stripe from 'stripe'
import { enforceRateLimit } from '../../../../lib/rate-limit'

/**
 * Stripe Connect onboarding for business owners (for transaction payments).
 * Separate from subscription billing (which is Nexez charging the owner).
 * Express accounts for quick setup.
 * Stores account id in billing_subscriptions.stripe_connect_account_id
 */
export async function POST(request: Request) {
  const rateLimited = await enforceRateLimit(request, 'billing-connect', 12, 60_000, { failClosed: true })
  if (rateLimited) return rateLimited
  const requestUrl = new URL(request.url)
  const cookieStore = await cookies()
  const supabase = createClient(cookieStore, requestUrl.host)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  // billing_subscriptions is server-managed: RLS lets owners SELECT but NOT
  // insert/update, so the account id + status MUST be persisted with the
  // service-role client (same pattern as the webhook + portal route). Without it
  // the write is silently rejected by RLS and the account is forgotten - so never
  // create an orphan Stripe account we can't save.
  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({ error: 'Server is not configured to persist the Connect account.' }, { status: 500 })
  }
  const admin = createAdminClient()
  try {
    const shopifyBilling = await getOwnerShopifyBillingContext(admin, user.id, cookieStore.get('shopify_pending_shop')?.value)
    if (shopifyBilling) return NextResponse.json({
      error: 'Shopify handles checkout and payouts for this account. Continue in Shopify.',
      provider: 'shopify', pricingUrl: shopifyBilling.pricingUrl,
    }, { status: 409 })
  } catch {
    return NextResponse.json({ error: 'Could not verify billing ownership. Please try again shortly.' }, { status: 503 })
  }
  const secret = process.env.STRIPE_SECRET_KEY
  if (!secret) {
    return NextResponse.json({ error: 'Stripe not configured for Connect.' }, { status: 412 })
  }
  const stripe = new Stripe(secret)

  // Read through the service role before any Stripe side effect. An unreadable
  // billing row must not be treated as a missing row: doing so could create a
  // second Connect account and overwrite live subscription state with defaults.
  const { data: billing, error: billingError } = await admin
    .from('billing_subscriptions')
    .select('*')
    .eq('owner_id', user.id)
    .maybeSingle()
  if (billingError) {
    return NextResponse.json({ error: 'Failed to load billing state for Connect setup.' }, { status: 500 })
  }

  let accountId = billing?.stripe_connect_account_id

  if (!accountId) {
    // Establish the durable local row before creating anything in Stripe. This
    // is also the first entitlement-locked write, so normal allocation
    // contention returns the retry contract with no external side effect.
    const reservationWrite = billing
      ? admin.from('billing_subscriptions').upsert({
          owner_id: user.id,
          stripe_connect_status: 'pending',
        }, { onConflict: 'owner_id' })
      : admin.from('billing_subscriptions').upsert({
          owner_id: user.id,
          plan_id: 'free',
          status: 'unconfigured',
          account_origin: 'free',
          stripe_connect_status: 'pending',
        }, { onConflict: 'owner_id' })
    const { data: reservedBilling, error: reserveError } = await reservationWrite
      .select('stripe_connect_account_id')
      .maybeSingle<{ stripe_connect_account_id: string | null }>()
    if (reserveError) {
      console.error('Failed to reserve Connect billing state', reserveError)
      if (isEntitlementAllocationRetry(reserveError)) {
        return NextResponse.json(entitlementAllocationRetryBody, entitlementAllocationRetryInit)
      }
      return NextResponse.json({ error: 'Failed to prepare your Connect account.' }, { status: 500 })
    }

    // A parallel request may have persisted the owner-scoped account while this
    // request was reserving the row. Never create another one in that case.
    accountId = reservedBilling?.stripe_connect_account_id ?? null
  }

  if (!accountId) {
    // Create new Express account
    let account
    try {
      account = await createStripeConnectAccount(
        user.id,
        user.email || '',
        (user.user_metadata as any)?.company || (user.user_metadata as any)?.full_name
      )
    } catch (e: any) {
      console.error('Connect account create failed', e)
      return NextResponse.json({ error: 'Failed to create Stripe Connect account: ' + e.message }, { status: 500 })
    }
    accountId = account.id

    // The helper uses a stable owner-scoped Stripe idempotency key. If this
    // persistence loses an allocation race, the documented retry recovers the
    // same remote account rather than creating a duplicate.
    const { error: persistError } = await admin
      .from('billing_subscriptions')
      .update({
        stripe_connect_account_id: accountId,
        stripe_connect_status: 'pending',
        metadata: { ...(billing?.metadata || {}), connect_onboarding_started: new Date().toISOString() },
      })
      .eq('owner_id', user.id)
    if (persistError) {
      console.error('Failed to persist Connect account id', persistError)
      if (isEntitlementAllocationRetry(persistError)) {
        return NextResponse.json(entitlementAllocationRetryBody, entitlementAllocationRetryInit)
      }
      return NextResponse.json({ error: 'Failed to save your Connect account: ' + persistError.message }, { status: 500 })
    }
  }

  // Always refresh the latest status from Stripe.
  // These fields (details_submitted, charges_enabled, payouts_enabled) are updated asynchronously
  // by Stripe after the user completes steps or after review.
  let statusUpdate: Record<string, any> = {}
  let statusRefreshFailed = false
  try {
    const account = await stripe.accounts.retrieve(accountId)
    statusUpdate = {
      stripe_connect_status: account.details_submitted ? 'complete' : 'pending',
      stripe_connect_details_submitted: account.details_submitted,
      stripe_connect_charges_enabled: account.charges_enabled,
      stripe_connect_payouts_enabled: account.payouts_enabled,
    }
    const { error: updateError } = await admin.from('billing_subscriptions').update(statusUpdate).eq('owner_id', user.id)
    if (updateError) {
      console.error('Failed to update Connect account status', updateError)
      if (isEntitlementAllocationRetry(updateError)) {
        return NextResponse.json(entitlementAllocationRetryBody, entitlementAllocationRetryInit)
      }
      return NextResponse.json({ error: 'Failed to save the latest Connect account status.' }, { status: 500 })
    }
  } catch (e: any) {
    statusRefreshFailed = true
    console.error('Failed to retrieve Connect account status', e)
  }

  // If caller just wants a status refresh (no redirect), return early
  if (requestUrl.searchParams.get('refresh') === 'true') {
    if (statusRefreshFailed) {
      return NextResponse.json({ error: 'Failed to retrieve the latest Connect account status.' }, { status: 502 })
    }
    return NextResponse.json({ refreshed: true, ...statusUpdate })
  }

  // If the caller is mid-funnel on a paid plan (e.g. the onboarding wizard),
  // thread that plan through the return URL so payouts onboarding lands back on
  // billing with checkout auto-opening for that plan - keeping subscription +
  // payouts setup one coherent flow instead of dropping the subscription.
  const body = await request.json().catch(() => ({} as { plan?: string }))
  const requestedPlan = typeof body?.plan === 'string' ? body.plan : ''
  const resumePlan = billingPlans.find((p) => p.id === requestedPlan && p.envVar && p.id !== 'enterprise')?.id

  // Create onboarding / manage link (Stripe will show the appropriate flow for the account state)
  // Redirect back to billing page after Stripe Connect onboarding so the status/refetch logic can run immediately.
  const returnUrl = appUrl(`/dashboard/billing?connect=success${resumePlan ? `&plan=${resumePlan}` : ''}`)
  const refreshUrl = appUrl('/dashboard/billing?connect=refresh')

  try {
    const link = await createStripeConnectOnboardingLink(accountId, returnUrl, refreshUrl)
    return NextResponse.json({ url: link.url })
  } catch (e: any) {
    return NextResponse.json({ error: 'Failed to create onboarding link: ' + e.message }, { status: 500 })
  }
}

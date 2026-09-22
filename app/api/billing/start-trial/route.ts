import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '../../../../utils/supabase/server'
import { createAdminClient, hasSupabaseAdminEnv } from '../../../../utils/supabase/admin'
import { getBillingPlan } from '../../../../lib/billing'
import { isSelectablePlan } from '../../../../lib/server/trial'
import {
  entitlementAllocationRetryBody,
  entitlementAllocationRetryInit,
  isEntitlementAllocationRetry,
} from '../../../../lib/entitlement-allocation-error'
import { enforceRateLimit } from '../../../../lib/rate-limit'
import { getOwnerShopifyBillingContext, type ShopifyBillingContext } from '../../../../lib/server/shopify-billing'

const TRIAL_DAYS = 7

/**
 * Lightweight billing-presence probe for the signed-in user. /onboard uses it to decide
 * whether an authenticated visitor still needs the plan picker (an OAuth first-touch,
 * e.g. Continue with Google, has no billing row yet) or should bounce to the dashboard.
 * Exposes only the owner's own presence/plan/status booleans - data they already see
 * on the billing dashboard.
 */
export async function GET() {
  const cookieStore = await cookies()
  const supabase = createClient(cookieStore)
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({ error: 'Billing lookup unavailable.' }, { status: 503 })
  }

  const admin = createAdminClient()
  let shopifyBilling: ShopifyBillingContext | null
  try {
    shopifyBilling = await getOwnerShopifyBillingContext(admin, user.id, cookieStore.get('shopify_pending_shop')?.value)
  } catch {
    return NextResponse.json({ error: 'Could not verify billing ownership. Please try again shortly.' }, { status: 503 })
  }
  if (shopifyBilling) {
    return NextResponse.json({
      hasBilling: true,
      provider: 'shopify',
      pricingUrl: shopifyBilling.pricingUrl,
      planHandle: shopifyBilling.planHandle,
      status: shopifyBilling.status,
    })
  }
  const { data, error } = await admin
    .from('billing_subscriptions')
    .select('plan_id, status')
    .eq('owner_id', user.id)
    .maybeSingle<{ plan_id: string | null; status: string | null }>()
  if (error) return NextResponse.json({ error: 'Billing lookup failed.' }, { status: 500 })

  return NextResponse.json({ hasBilling: Boolean(data), planId: data?.plan_id ?? null, status: data?.status ?? null })
}

/**
 * Initialize the plan explicitly selected at signup. Free becomes a durable active
 * account; paid self-serve plans start the existing seven-day no-card trial.
 * Idempotent + one-per-account: it ONLY seeds a trial when the account has no billing row at
 * all. A row already present means the account is grandfathered ('legacy'), already trialing,
 * or already subscribed - none of which we overwrite (a legacy user upgrades via checkout,
 * not by replacing established billing state with a fresh trial).
 *
 * Service-role write: RLS blocks client inserts on billing_subscriptions, and the resolvers
 * key entitlements off this row, so it must be written server-side.
 */
export async function POST(request: Request) {
  const rateLimited = await enforceRateLimit(request, 'billing-start-trial', 12, 60_000, { failClosed: true })
  if (rateLimited) return rateLimited
  const cookieStore = await cookies()
  const supabase = createClient(cookieStore)
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({ error: 'Billing setup is unavailable on this deployment.' }, { status: 503 })
  }

  const body = (await request.json().catch(() => ({}))) as { plan?: string; planId?: string }
  const plan = getBillingPlan(String(body.plan || body.planId || ''))
  if (!plan || !isSelectablePlan(plan.id)) {
    return NextResponse.json(
      { error: 'Pick Free, Launch, Pro, or Scale.' },
      { status: 400 },
    )
  }

  const admin = createAdminClient()
  let shopifyBilling: ShopifyBillingContext | null
  try {
    shopifyBilling = await getOwnerShopifyBillingContext(admin, user.id, cookieStore.get('shopify_pending_shop')?.value)
  } catch {
    return NextResponse.json({ error: 'Could not verify billing ownership. Please try again shortly.' }, { status: 503 })
  }
  if (shopifyBilling) {
    return NextResponse.json(
      {
        error: 'This account uses Shopify App Pricing. Choose a plan in Shopify admin.',
        provider: 'shopify',
        pricingUrl: shopifyBilling.pricingUrl,
      },
      { status: 409 },
    )
  }
  const { data: existing } = await admin
    .from('billing_subscriptions')
    .select('account_origin, status, plan_id, trial_ends_at')
    .eq('owner_id', user.id)
    .maybeSingle<{ account_origin: string | null; status: string | null; plan_id: string | null; trial_ends_at: string | null }>()

  // Already has billing state → don't touch it (idempotent; legacy/trial/paid all preserved).
  if (existing) {
    return NextResponse.json({ ok: true, alreadyHadAccount: true, planId: existing.plan_id, status: existing.status })
  }

  const isFree = plan.id === 'free'
  const trialEndsAt = isFree ? null : new Date(Date.now() + TRIAL_DAYS * 86_400_000).toISOString()
  const { data, error } = await admin
    .from('billing_subscriptions')
    .insert({
      owner_id: user.id,
      plan_id: plan.id,
      status: isFree ? 'active' : 'trialing',
      trial_ends_at: trialEndsAt,
      account_origin: isFree ? 'free' : 'trial',
      metadata: { source: 'start-trial', billing_kind: isFree ? 'free' : 'trial' },
    })
    .select('plan_id, status, trial_ends_at')
    .maybeSingle()
  if (error) {
    // owner_id PK race (a parallel start-trial won) → treat as already-started, not an error.
    if (error.code === '23505') return NextResponse.json({ ok: true, alreadyHadAccount: true })
    if (isEntitlementAllocationRetry(error)) {
      return NextResponse.json(entitlementAllocationRetryBody, entitlementAllocationRetryInit)
    }
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({ ok: true, planId: data?.plan_id, status: data?.status, trialEndsAt: data?.trial_ends_at })
}

import { createAdminClient, hasSupabaseAdminEnv } from '../../utils/supabase/admin'
import { getOwnerShopifyBillingContext } from '../../lib/server/shopify-billing'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '../../utils/supabase/server'
import { getOwnerEntitlements } from '../../lib/server/plan'
import { getPlanFeatureEntitlements, getSerializablePlanLimits, type PlanId } from '../../lib/billing'
import { ensureBillingSeeded, hasBillingAccount, isSelectablePlan } from '../../lib/server/trial'
import { PlanProvider, type DashboardEntitlements } from '../../components/billing/PlanProvider'

/**
 * Resolves the viewer's plan once for the whole dashboard and provides it via
 * context, so client dashboard pages can gate features (PlanGate) without a
 * per-page fetch or a first-paint flash. Also the subtree-wide auth gate
 * (defense-in-depth behind the proxy gate + the per-page getUser() redirects):
 * a DEFINITIVE signed-out answer redirects to login; a transient auth error
 * falls through to the free-gated render instead of bouncing a logged-in user
 * (per-page gates still enforce), so a blip can't cause a redirect loop.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  let plan: PlanId = 'free'
  let entitlements: DashboardEntitlements = {
    planId: plan,
    features: getPlanFeatureEntitlements(plan),
    limits: getSerializablePlanLimits(plan),
  }
  let signedOut = false
  let needsPlanSelection = false
  // A transient auth/billing blip here should degrade to a free-gated dashboard,
  // not 500 the whole subtree. Failing soft to 'free' introduces no auth hole
  // (it only restricts features).
  try {
    const cookieStore = await cookies()
    const supabase = createClient(cookieStore)
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    signedOut = !user && !authError
    const resolved = await getOwnerEntitlements(supabase, user?.id)
    plan = resolved.planId
    entitlements = { planId: plan, features: resolved.features, limits: resolved.limits }
    const shopifyBilling = user && hasSupabaseAdminEnv()
      ? await getOwnerShopifyBillingContext(createAdminClient(), user.id, cookieStore.get('shopify_pending_shop')?.value)
      : null
    // Backstop for delayed email confirmation: seed only a plan the user explicitly
    // selected. A plan-less account is routed back to onboarding instead of receiving
    // an implicit Pro trial. Existing billing rows (legacy, paused, or paid) are preserved.
    if (plan === 'free' && user?.id && !shopifyBilling) {
      const planMeta = user.user_metadata?.plan
      const hasBilling = await hasBillingAccount(user.id)
      if (!hasBilling && !isSelectablePlan(planMeta)) {
        needsPlanSelection = true
      } else if (!hasBilling && await ensureBillingSeeded(user.id, planMeta)) {
        const reseeded = await getOwnerEntitlements(supabase, user.id)
        plan = reseeded.planId
        entitlements = { planId: plan, features: reseeded.features, limits: reseeded.limits }
      }
    }
  } catch {
    plan = 'free'
    entitlements = {
      planId: plan,
      features: getPlanFeatureEntitlements(plan),
      limits: getSerializablePlanLimits(plan),
    }
  }

  // Outside the try: redirect() throws NEXT_REDIRECT, which the catch above
  // must never swallow.
  if (signedOut) redirect('/login?next=/dashboard')
  if (needsPlanSelection) redirect('/onboard?next=/dashboard')

  return (
    <PlanProvider entitlements={entitlements}>
      <div className="nx-platform-surface contents">{children}</div>
    </PlanProvider>
  )
}

import Stripe from 'stripe'
import { ShopifyBillingPanel } from '../../../components/billing/ShopifyBillingPanel'
import { cookies } from 'next/headers'
import { AgentPage, OWNER_PAGE_SELECT, getOfferCount } from '../../../lib/agent-page'
import { billingPlans, getPlanLimits } from '../../../lib/billing'
import { getStripeBillingReadiness } from '../../../lib/server/billing-readiness'
import { getCommercialPlanDefaultCommission, getOwnerBillingState, getOwnerCommission } from '../../../lib/server/plan'
import {
  BillingSubscription,
  LIVE_SUBSCRIPTION_STATUSES,
} from '../../../lib/stripe-billing'
import {
  getAgentPageVisitCount,
  getCheckoutHandoffCount,
  getDiscoveryClickCount,
} from '../../../lib/analytics'
import { buildMarketplaceLedger, type DirectFinanceRow, type NegotiationFinanceRow } from '../../../lib/finance-analytics'
import type { CheckoutEvent } from '../../../lib/checkout-events'
import { createClient } from '../../../utils/supabase/server'
import { createAdminClient, hasSupabaseAdminEnv } from '../../../utils/supabase/admin'
import { getOwnerShopifyBillingContext } from '../../../lib/server/shopify-billing'

// Client components
import { AutoRefreshConnect } from '../../../components/billing/AutoRefreshConnect'
import BillingDashboardClient from '../../../components/billing/BillingDashboardClient'

type BillingProps = {
  searchParams: Promise<{ setup?: string; canceled?: string; error?: string; plan?: string; connect?: string }>
}

export default async function BillingPage({ searchParams }: BillingProps) {
  const search = await searchParams
  const initialPlanFromQuery = typeof search.plan === 'string' ? search.plan : null
  const connectSuccess = search.connect === 'success'
  const cookieStore = await cookies()
  const supabase = createClient(cookieStore)
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#090b10] text-white">
        <a href="/login?next=/dashboard/billing" className="rounded-lg bg-white px-5 py-3 font-medium text-zinc-950">
          Sign in to manage billing
        </a>
      </main>
    )
  }

  const admin = hasSupabaseAdminEnv() ? createAdminClient() : null
  if (!admin) {
    return <main className="p-8">Billing is temporarily unavailable. Please try again shortly.</main>
  }
  const shopifyBilling = await getOwnerShopifyBillingContext(admin, user.id, cookieStore.get('shopify_pending_shop')?.value)

  if (shopifyBilling) return <ShopifyBillingPanel billing={shopifyBilling} />

  const { data: pages } = await supabase
    .from('pages')
    .select(OWNER_PAGE_SELECT)
    .eq('owner_id', user.id)
    .returns<AgentPage[]>()

  const { data: billingState } = await supabase
    .from('billing_subscriptions')
    .select('*')
    .eq('owner_id', user.id)
    .maybeSingle<BillingSubscription>()

  // Canonical trial/paused lifecycle (trial-expiry aware) for the banner + active-plan
  // resolution. Days left is rounded up so "1 day left" shows on the final day.
  const trialState = await getOwnerBillingState(supabase, user.id)
  const trialDaysLeft = trialState.trialEndsAt
    ? Math.max(0, Math.ceil((new Date(trialState.trialEndsAt).getTime() - new Date().getTime()) / 86_400_000))
    : 0
  const trialPlanName = billingPlans.find((p) => p.id === trialState.chosenPlanId)?.name ?? 'plan'
  const hasLiveStripeSubscription = Boolean(
    billingState?.stripe_subscription_id
    && LIVE_SUBSCRIPTION_STATUSES.includes(
      billingState.status as (typeof LIVE_SUBSCRIPTION_STATUSES)[number],
    ),
  )
  const effectivePromotion =
    trialState.promotion
    && trialState.planId === trialState.promotion.planId
    && !hasLiveStripeSubscription
      ? trialState.promotion
      : null

  const publishedPages = (pages ?? []).filter((page) => page.is_published)
  const pageCount = publishedPages.length
  const offerCount = pages?.reduce((sum, page) => sum + getOfferCount(page), 0) ?? 0

  // Real this-month engagement figures.
  const monthStart = new Date()
  monthStart.setUTCDate(1)
  monthStart.setUTCHours(0, 0, 0, 0)
  const { data: monthEvents } = await supabase
    .from('checkout_events')
    .select('*')
    .eq('owner_id', user.id)
    .gte('created_at', monthStart.toISOString())
    .returns<CheckoutEvent[]>()
  const events = monthEvents ?? []
  const stripeReadiness = getStripeBillingReadiness()
  const stripeReady = stripeReadiness.subscriptionCheckoutReady
  const configuredPlanIds = stripeReadiness.configuredPlans.map((plan) => plan.id)
  // Show the effective entitlement plan, not merely the paid Stripe row. This matters
  // for platform-admin or Enterprise accounts, whose separate self-serve
  // subscription must never make the dashboard claim their access is Free or Launch.
  const activePlan = billingPlans.find((plan) => plan.id === trialState.planId)
  const hasEnterpriseOverride = trialState.planId === 'enterprise' && billingState?.plan_id !== 'enterprise'

  // Page limit comes from the billing catalog (single source of truth); 999 is the
  // client's "unlimited" sentinel, so map the catalog's Infinity onto it.
  const planPageLimit = getPlanLimits(activePlan?.id).pages
  const pageLimit = Number.isFinite(planPageLimit) ? planPageLimit : 999

  // Resolve the sanitized effective rate server-side so negotiated Enterprise terms
  // render accurately without exposing the commercial-terms table to the browser.
  const commission = admin
    ? await getOwnerCommission(admin, user.id, trialState)
    : getCommercialPlanDefaultCommission(trialState)
  const commissionPct = commission.percent

  // Durable, Stripe-proven money rows are the source of GMV and Nexez fees. Checkout
  // intent telemetry is deliberately excluded, and each charge keeps its own fee
  // snapshot so a later plan change never rewrites history.
  const [{ data: orderRows }, { data: negotiationRows }] = await Promise.all([
    supabase
      .from('checkout_orders')
      .select('id, status, channel, amount_cents, refunded_cents, currency, slug, offer_name, offer_key, buyer_agent, buyer_name, buyer_email, buyer_reference, commission_percent, application_fee_cents, stripe_livemode, created_at')
      .eq('owner_id', user.id)
      .eq('stripe_livemode', true)
      .gte('created_at', monthStart.toISOString())
      .order('created_at', { ascending: false })
      .limit(1000)
      .returns<DirectFinanceRow[]>(),
    supabase
      .from('agent_negotiations')
      .select('id, status, amount_cents, currency, slug, offer_name, buyer_agent, created_at, updated_at, commission_percent, application_fee_cents, stripe_livemode')
      .eq('owner_id', user.id)
      .eq('stripe_livemode', true)
      .in('status', ['held', 'complete', 'refunded', 'disputed'])
      .gte('updated_at', monthStart.toISOString())
      .order('updated_at', { ascending: false })
      .limit(1000)
      .returns<Array<NegotiationFinanceRow & { updated_at: string }>>(),
  ])
  const moneyEntries = buildMarketplaceLedger(
    orderRows ?? [],
    (negotiationRows ?? []).map((row) => ({ ...row, created_at: row.updated_at })),
    commissionPct,
    2000,
  )
  const moneyByCurrency = new Map<string, { gmvCents: number; feeCents: number }>()
  for (const entry of moneyEntries) {
    if (entry.isReversal) continue
    const current = moneyByCurrency.get(entry.currency) ?? { gmvCents: 0, feeCents: 0 }
    current.gmvCents += entry.amountCents
    current.feeCents += entry.feeCents
    moneyByCurrency.set(entry.currency, current)
  }
  const dominantEconomics = [...moneyByCurrency.entries()].sort((a, b) => b[1].gmvCents - a[1].gmvCents)[0]
  const revenueCurrency = dominantEconomics?.[0] ?? 'usd'
  const settledEconomics = dominantEconomics?.[1] ?? { gmvCents: 0, feeCents: 0 }
  const agentRevenueCents = settledEconomics.gmvCents
  const platformFeesCents = settledEconomics.feeCents
  const monthlySubscriptionCents =
    hasEnterpriseOverride
      ? null
      : effectivePromotion || trialState.isTrialing
        ? 0
        : activePlan?.monthlyPriceCents ?? null

  // Usage: pages metered against the plan limit; the rest are real this-month
  // engagement counts (limit: null → shown as a plain count, not a fake cap).
  const usage = {
    pages: { label: 'Published Listings', current: pageCount, limit: pageLimit },
    offers: { label: 'Total Offers', current: offerCount, limit: null },
    aiOptimizations: { label: 'Agent visits (mo)', current: getAgentPageVisitCount(events), limit: null },
    simulations: { label: 'Discovery clicks (mo)', current: getDiscoveryClickCount(events), limit: null },
    impressions: { label: 'Checkout handoffs (mo)', current: getCheckoutHandoffCount(events), limit: null },
  }

  // Real Stripe invoices for Billing History (replaces the hardcoded placeholders).
  let invoices: Array<{ id: string; date: string; description: string; amount: number; status: 'paid' | 'pending' | 'failed'; hostedUrl: string | null }> = []
  if (!shopifyBilling && billingState?.stripe_customer_id && process.env.STRIPE_SECRET_KEY) {
    try {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
      const list = await stripe.invoices.list({ customer: billingState.stripe_customer_id, limit: 12 })
      invoices = list.data.map((inv) => ({
        id: inv.number || inv.id || 'invoice',
        date: new Date((inv.created ?? 0) * 1000).toISOString().slice(0, 10),
        description: inv.lines?.data?.[0]?.description || (activePlan ? `${activePlan.name} plan` : 'Subscription'),
        amount: Math.round(inv.amount_paid ?? inv.total ?? 0) / 100,
        status: inv.status === 'paid' ? 'paid' : inv.status === 'open' ? 'pending' : inv.status === 'void' || inv.status === 'uncollectible' ? 'failed' : 'pending',
        hostedUrl: inv.hosted_invoice_url || null,
      }))
    } catch (e) {
      console.warn('[billing] Stripe invoice fetch failed (non-fatal)', e)
    }
  }

  return (
    <main className="nx-platform-surface min-h-screen bg-[var(--bg)] text-[var(--fg)]">
      <div className="mx-auto max-w-6xl px-6 py-10">
        {/* Top header (consistent with platform) */}
        <header className="surface-masthead mb-8 flex items-start justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 text-sm text-[var(--signal)]">
              <span className="inline-block size-1.5 rounded-full bg-[var(--signal-solid)]" />
              Billing
            </div>
            <h1 className="mt-1 text-4xl font-semibold tracking-[-1.5px]">Your plan &amp; payouts</h1>
          </div>
          <a href="/pricing" className="rounded-2xl border border-white/15 px-5 py-2 text-sm hover:bg-white/5 transition">
            Compare plans
          </a>
        </header>

        {/* Invisible helper for Stripe Connect success redirect (keeps existing behavior) */}
        <AutoRefreshConnect connectSuccess={connectSuccess} />

        {/* Feedback banners (preserved for connect/setup errors) */}
        {connectSuccess && (
          <div className="mb-6 rounded-2xl border border-[var(--ready)]/30 bg-[var(--ready)]/10 px-4 py-3 text-sm text-[var(--ready)]">
            Stripe Connect updated. Your payouts status has been refreshed.
          </div>
        )}
        {search.setup === 'stripe' && (
          <div className="mb-6 rounded-2xl border border-[var(--amber)]/30 bg-[var(--amber)]/10 px-4 py-3 text-sm text-[var(--amber)]">
            Billing setup is not complete yet. Add your Stripe keys in project settings to enable subscriptions and payouts.
          </div>
        )}
        {search.error === 'bad_price_id' && (
          <div className="mb-6 rounded-2xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">
            One of your Stripe plan IDs points to a product instead of a price. Copy the Price ID from Stripe, update project settings, and redeploy.
          </div>
        )}

        {/* Trial and Free-fallback lifecycle banners */}
        {!shopifyBilling && trialState.isTrialing && !effectivePromotion && (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--amber)]/40 bg-[var(--amber)]/10 px-4 py-3 text-sm">
            <span className="text-white">
              <span className="font-semibold">{trialDaysLeft} day{trialDaysLeft === 1 ? '' : 's'} left</span> in your {trialPlanName} trial. Add a payment method to keep this plan after it ends.
            </span>
            <a href={`?plan=${trialState.chosenPlanId}`} className="rounded-xl bg-[var(--amber)] px-4 py-1.5 font-medium text-zinc-950">
              Add payment method
            </a>
          </div>
        )}
        {!shopifyBilling && trialState.isTrialExpired && !effectivePromotion && trialState.planId === 'free' && (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--amber)]/40 bg-[var(--amber)]/10 px-4 py-3 text-sm">
            <span className="text-white">
              <span className="font-semibold">Your paid-plan trial ended.</span> Your account returned to Free and your primary listing remains live.
            </span>
            <a href={`?plan=${trialState.chosenPlanId ?? 'pro'}`} className="rounded-xl bg-[var(--amber)] px-4 py-1.5 font-medium text-zinc-950">
              Choose a paid plan
            </a>
          </div>
        )}

        {/* The entire new tabbed glassmorphic experience */}
        <BillingDashboardClient
          activePlan={activePlan}
          billingState={billingState}
          usage={usage}
          invoices={invoices}
          platformFeesCents={platformFeesCents}
          agentRevenueCents={agentRevenueCents}
          revenueCurrency={revenueCurrency}
          commissionPct={commissionPct}
          commissionBps={commission.basisPoints}
          commissionSource={commission.source}
          monthlySubscriptionCents={monthlySubscriptionCents}
          processorFeesCents={null}
          stripeReady={stripeReady}
          configuredPlanIds={configuredPlanIds}
          initialPlanId={initialPlanFromQuery}
          connectSuccess={connectSuccess}
          hasEnterpriseOverride={hasEnterpriseOverride}
          promotion={effectivePromotion}
          fallbackPages={publishedPages.map((page) => ({
            id: page.id,
            name: page.name || page.slug || 'Untitled listing',
          }))}
          shopifyBilling={shopifyBilling}
        />
      </div>
    </main>
  )
}

import { cookies } from 'next/headers'
import {
  Wallet,
  Lock,
  TrendingUp,
  ArrowDownToLine,
  Coins,
  Receipt,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  ArrowLeftRight,
  Activity,
  ShieldCheck,
  Handshake,
} from 'lucide-react'
import { ErrorBoundary } from '../../../components/ErrorBoundary'
import { createClient } from '../../../utils/supabase/server'
import { getOwnerPlanId } from '../../../lib/server/plan'
import { planAllows, getBillingPlan } from '../../../lib/billing'
import { clampHistoryRange, analyticsRangeBounds, previousPeriodBounds, pctDelta, type KpiDelta } from '../../../lib/analytics'
import {
  rollupFinanceByCurrency,
  rollupNegotiationsByCurrency,
  getReversalRate,
  buildMarketplaceLedger,
  getDailyRevenueSeries,
  getTopOffersByRevenueCents,
  getCurrencyOptions,
  type NegotiationFinanceRow,
  type DirectFinanceRow,
  type NegotiationCurrencyRow,
  type LedgerEntry,
} from '../../../lib/finance-analytics'
import { formatCurrencyAmount, normalizeCurrency } from '../../../lib/currency'
import { EmptyState, type EmptyStateCta } from '../../../components/EmptyState'
import { OrdersPanel, type OrderRow } from '../../../components/dashboard/OrdersPanel'
import { BuyerRequestsPanel, type BuyerRequestRow } from '../../../components/dashboard/BuyerRequestsPanel'
import { getCommissionPercentForPlan, billingStatusCopy, type BillingSubscription } from '../../../lib/stripe-billing'
import { getConnectPayoutSnapshot, getNextPayout } from '../../../lib/server/connect-finance'
import { getNegotiationStatusLabel, getNegotiationStatusTone, type NegotiationStatus } from '../../../lib/negotiations'
import { GlassCard } from '../../../components/billing/billing-ui'
import { ProBadge } from '../../../components/billing/PlanGate'
import { appUrl } from '../../../lib/site'
import { RevenueChart } from './RevenueChart'
import { DataLoadNotice } from '../../../components/dashboard/DataLoadNotice'
import { loadFinanceRollup, type FinanceRollup } from '../../../lib/finance-report'

type FinanceProps = {
  searchParams: Promise<{ range?: string; from?: string; to?: string; currency?: string }>
}

const RANGES = [
  { label: 'Today', value: 'today' },
  { label: '7d', value: '7d' },
  { label: '30d', value: '30d' },
  { label: 'All', value: 'all' },
]

const EMPTY_NEG: NegotiationCurrencyRow = {
  currency: 'usd',
  agreedCents: 0,
  deals: 0,
  heldCents: 0,
  completeCents: 0,
  reversedCents: 0,
}

export default async function FinancePage({ searchParams }: FinanceProps) {
  const filters = await searchParams
  const cookieStore = await cookies()
  const supabase = createClient(cookieStore)
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#090b10] text-white">
        <a href="/login?next=/dashboard/finance" className="rounded-lg bg-white px-5 py-3 font-medium text-zinc-950">
          Sign in to view finances
        </a>
      </main>
    )
  }

  // analyticsHistory (Pro): All-time + custom ranges are Pro; clamp server-side.
  const [planId, billingResult] = await Promise.all([
    getOwnerPlanId(supabase, user.id),
    supabase
      .from('billing_subscriptions')
      .select('*')
      .eq('owner_id', user.id)
      .maybeSingle<BillingSubscription>(),
  ])
  const fullHistory = planAllows(planId, 'analyticsHistory')
  const historyWindow = clampHistoryRange({ range: filters.range, from: filters.from, to: filters.to }, fullHistory)
  const range = historyWindow.range || '30d'
  const rangeBounds = analyticsRangeBounds(historyWindow)
  const { cutoff, until } = rangeBounds

  // Billing + Connect (the seller's own subscription + payout account).
  const { data: billing, error: billingError } = billingResult
  const activePlan = getBillingPlan(planId)
  const commissionPct = getCommissionPercentForPlan(planId)
  const connectAccountId = billing?.stripe_connect_account_id ?? null
  const payoutsReady = Boolean(billing?.stripe_connect_payouts_enabled)
  const cutoffIso = cutoff.toISOString()
  const untilIso = until?.toISOString()
  const prevBounds = previousPeriodBounds(rangeBounds)
  const fallbackCommissionBps = Math.round(commissionPct * 100)
  const [financeResult, previousFinanceResult, negotiationResult, orderResult, requestResult, payouts] = await Promise.all([
    loadFinanceRollup(supabase, { from: cutoff, to: until, fallbackCommissionBps }),
    prevBounds
      ? loadFinanceRollup(supabase, { from: prevBounds.cutoff, to: prevBounds.until, fallbackCommissionBps })
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from('agent_negotiations')
      .select('id, status, amount_cents, currency, refunded_cents, slug, offer_name, buyer_agent, created_at, updated_at, commission_percent, application_fee_cents, stripe_livemode')
      .eq('owner_id', user.id)
      .eq('stripe_livemode', true)
      .order('updated_at', { ascending: false })
      .limit(100)
      .returns<NegotiationFinanceRow[]>(),
    supabase
      .from('checkout_orders')
      .select('id, page_id, offer_name, offer_key, amount_cents, currency, status, channel, slug, refunded_cents, buyer_email, buyer_name, buyer_reference, buyer_agent, commission_percent, application_fee_cents, stripe_livemode, created_at')
      .eq('owner_id', user.id)
      .eq('stripe_livemode', true)
      .order('created_at', { ascending: false })
      .limit(100)
      .returns<DirectFinanceRow[]>(),
    supabase
      .from('order_requests')
      .select('id, order_kind, order_id, kind, status, message, buyer_email, slug, created_at')
      .eq('owner_id', user.id)
      .order('created_at', { ascending: false })
      .limit(100)
      .returns<BuyerRequestRow[]>(),
    getConnectPayoutSnapshot(connectAccountId),
  ])
  const nextPayout = getNextPayout(payouts)
  const report = financeResult.data
  const previousReport = previousFinanceResult.data
  const negRows = negotiationResult.data ?? []
  const orders = orderResult.data ?? []
  const ordersInWindow = orders.filter((order) => order.created_at >= cutoffIso && (!untilIso || order.created_at <= untilIso))
  const negInWindow = negRows.filter((n) => !!n.created_at && n.created_at >= cutoffIso && (!untilIso || n.created_at <= untilIso))
  const requestRows = requestResult.data
  const buyerRequests = requestRows ?? []
  const dataIssues = [
    financeResult.error ? 'exact finance reporting (showing a recent sample)' : null,
    billingError ? 'billing status' : null,
    negotiationResult.error ? 'recent negotiated transactions' : null,
    orderResult.error ? 'recent checkout orders' : null,
    requestResult.error ? 'buyer requests' : null,
    previousFinanceResult.error ? 'previous-period finance reporting' : null,
    connectAccountId && payouts == null ? 'payout status' : null,
  ].filter((issue): issue is string => Boolean(issue))

  // Per-currency roll-up + the selected currency for the hero/trend/top-offers.
  const byCurrency = report
    ? report.currencies.map((row) => ({
        currency: row.currency,
        gmvCents: row.grossCents,
        orders: row.transactions,
        refundedCents: row.outflowCents,
        nexezFeeCents: row.feeCents,
        netCents: row.netCents,
        aovCents: row.aovCents,
      }))
    : rollupFinanceByCurrency(ordersInWindow, commissionPct)
  // Currency selector spans BOTH channels (checkout + negotiated), dominant first,
  // so a seller with only negotiated revenue in a currency can still select it.
  const directCurrencies = report?.currencies.map((row) => row.currency) ?? getCurrencyOptions(ordersInWindow)
  const escrowCurrencies = report?.escrow.map((row) => row.currency) ?? rollupNegotiationsByCurrency(negRows).map((row) => row.currency)
  const currencyOptions = [...directCurrencies, ...escrowCurrencies.filter((currency) => !directCurrencies.includes(currency))]
  const requested = filters.currency ? normalizeCurrency(filters.currency) : null
  const selectedCurrency = requested && currencyOptions.includes(requested) ? requested : currencyOptions[0] ?? 'usd'
  const sel =
    byCurrency.find((r) => r.currency === selectedCurrency) ??
    { currency: selectedCurrency, gmvCents: 0, orders: 0, refundedCents: 0, nexezFeeCents: 0, netCents: 0, aovCents: 0 }
  // All-time negotiated roll-up powers CURRENT-BALANCE concepts: escrow held KPI,
  // the escrow-lifecycle strip, and the reversal rate.
  const exactEscrow = report?.escrow.find((row) => row.currency === selectedCurrency)
  const negSel = exactEscrow
    ? {
        currency: exactEscrow.currency,
        agreedCents: exactEscrow.fundedCents,
        deals: exactEscrow.deals,
        heldCents: exactEscrow.heldCents,
        completeCents: exactEscrow.capturedCents,
        reversedCents: exactEscrow.outflowCents,
      }
    : rollupNegotiationsByCurrency(negRows).find((row) => row.currency === selectedCurrency) ?? { ...EMPTY_NEG, currency: selectedCurrency }
  const heldSel = negSel.heldCents
  const reversalRate = exactEscrow
    ? exactEscrow.capturedCents > 0
      ? exactEscrow.outflowCents / exactEscrow.capturedCents
      : null
    : getReversalRate(negSel)
  // Windowed negotiated roll-up powers the FLOW comparison (channel cards + share
  // bar) so it's apples-to-apples with the windowed direct GMV.
  const exactNegotiatedWindow = report?.negotiatedWindow.find((row) => row.currency === selectedCurrency)
  const negWindowSel = exactNegotiatedWindow
    ? {
        currency: exactNegotiatedWindow.currency,
        agreedCents: exactNegotiatedWindow.fundedCents,
        deals: exactNegotiatedWindow.deals,
        heldCents: exactNegotiatedWindow.heldCents,
        completeCents: exactNegotiatedWindow.capturedCents,
        reversedCents: exactNegotiatedWindow.outflowCents,
      }
    : rollupNegotiationsByCurrency(negInWindow).find((row) => row.currency === selectedCurrency) ?? { ...EMPTY_NEG, currency: selectedCurrency }

  // Period-over-period deltas on the hero (bounded presets only; all-time/custom
  // have no "previous" so we skip the extra query and hide the chips).
  const periodLabel = range === 'today' ? 'prior period' : range === '7d' ? 'prev 7d' : range === '1d' ? 'prev 24h' : 'prev 30d'
  const periodHuman =
    range === 'today' ? 'the prior period' : range === '7d' ? 'the previous 7 days' : range === '1d' ? 'the previous 24 hours' : 'the previous 30 days'
  let gmvDelta: KpiDelta | null = null
  let netDelta: KpiDelta | null = null
  let feeDelta: KpiDelta | null = null
  let aovDelta: KpiDelta | null = null
  if (prevBounds && previousReport) {
    const prevExact = previousReport?.currencies.find((row) => row.currency === selectedCurrency)
    const prevSel = prevExact
      ? { gmvCents: prevExact.grossCents, netCents: prevExact.netCents, nexezFeeCents: prevExact.feeCents, aovCents: prevExact.aovCents }
      : { gmvCents: 0, netCents: 0, nexezFeeCents: 0, aovCents: 0 }
    gmvDelta = pctDelta(sel.gmvCents, prevSel.gmvCents, periodLabel)
    netDelta = pctDelta(sel.netCents, prevSel.netCents, periodLabel)
    feeDelta = pctDelta(sel.nexezFeeCents, prevSel.nexezFeeCents, periodLabel)
    aovDelta = pctDelta(sel.aovCents, prevSel.aovCents, periodLabel)
  }

  // Trend window: a readable recent span keyed off the selected range.
  const seriesDays = range === '7d' || range === '1d' || range === 'today' ? 7 : 30
  const trend = report
    ? financeDailySeries(report, seriesDays, selectedCurrency)
    : getDailyRevenueSeries(ordersInWindow, seriesDays, selectedCurrency)
  const topOffers = report
    ? report.topOffers.filter((offer) => offer.currency === selectedCurrency).slice(0, 6).map((offer) => ({
        name: offer.offerName,
        pageSlug: offer.slug,
        offerKey: offer.offerKey,
        revenueCents: offer.grossCents,
        orders: offer.transactions,
      }))
    : getTopOffersByRevenueCents(ordersInWindow, selectedCurrency).slice(0, 6)
  const ledger = buildMarketplaceLedger(ordersInWindow, negInWindow, commissionPct, 25)
  const money = (cents: number) => formatCurrencyAmount(cents, selectedCurrency)

  const href = (next: { range?: string; currency?: string }) => {
    const params = new URLSearchParams()
    const r = next.range ?? range
    const c = next.currency ?? selectedCurrency
    if (r && r !== '30d') params.set('range', r)
    if (c && c !== 'usd') params.set('currency', c)
    const qs = params.toString()
    return `/dashboard/finance${qs ? `?${qs}` : ''}`
  }

  const hasRevenue = byCurrency.length > 0
  // Channel row = windowed flow comparison; escrow strip = all-time current balances.
  const hasNegWindow = negWindowSel.agreedCents > 0
  const hasEscrowActivity = negSel.heldCents > 0 || negSel.completeCents > 0 || negSel.reversedCents > 0
  // The two channels measure different money types - shown side by side, never summed.
  const selectedChannels = report?.channels.filter((row) => row.currency === selectedCurrency) ?? []
  const settlementChannels = [
    ...(selectedChannels.length
      ? selectedChannels
      : hasRevenue
        ? [{ currency: selectedCurrency, channel: 'settled_orders', transactions: sel.orders, grossCents: sel.gmvCents, netCents: sel.netCents }]
        : []),
    ...(exactNegotiatedWindow?.capturedCents
      ? [{
          currency: selectedCurrency,
          channel: 'negotiated',
          transactions: exactNegotiatedWindow.deals,
          grossCents: exactNegotiatedWindow.capturedCents,
          netCents: exactNegotiatedWindow.netCents,
        }]
      : []),
  ]
  const settlementChannelTotal = settlementChannels.reduce((sum, row) => sum + row.grossCents, 0)

  return (
    <main className="min-h-screen bg-[#090b10] text-white">
      <ErrorBoundary>
        <div className="mx-auto max-w-7xl px-6 py-10">
          {/* Header */}
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <p className="flex items-center gap-2 text-sm text-[var(--signal)]">
                <Wallet className="size-4" /> Finance
                <span className="inline-flex items-center gap-1 rounded-full border border-[var(--ready)]/25 bg-[var(--ready)]/10 px-2 py-0.5 text-[11px] text-[var(--ready)]">
                  <ShieldCheck className="size-3" /> Live mode only
                </span>
              </p>
              <h1 className="mt-2 text-4xl font-semibold tracking-tight">Money in &amp; out</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--fg-muted)]">
                Stripe-confirmed agent sales, refunds, platform fees, payouts to your bank, and funded escrow, kept separate
                from your own Nexez subscription.
              </p>
              <DataLoadNotice issues={dataIssues} />
            </div>
            <a
              href="/dashboard/billing"
              className="inline-flex h-10 shrink-0 items-center gap-2 self-start rounded-lg border border-[var(--bd-10)] px-4 text-sm text-zinc-200 hover:bg-white/10 sm:self-auto"
            >
              <Receipt className="size-4" /> Your plan &amp; invoices
            </a>
          </div>

          {/* Controls: time window + currency */}
          <div className="mt-7 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-1 text-xs uppercase tracking-[0.18em] text-zinc-500">Window</span>
              {RANGES.map((r) => {
                if (r.value === 'all' && !fullHistory) {
                  return (
                    <a
                      key={r.value}
                      href={appUrl('/dashboard/billing?plan=pro')}
                      title="All-time history is on the Pro plan"
                      className="inline-flex items-center gap-1 rounded-md border border-[var(--signal)]/30 bg-[var(--signal)]/[0.06] px-3 py-1.5 text-sm text-[var(--fg-muted)] hover:bg-[var(--signal)]/15"
                    >
                      <Lock className="size-3.5 text-[var(--signal)]" /> All
                    </a>
                  )
                }
                return (
                  <a
                    key={r.value}
                    href={href({ range: r.value })}
                    className={`rounded-md border px-3 py-1.5 text-sm transition ${
                      range === r.value ? 'border-white bg-white text-black' : 'border-[var(--bd-10)] text-zinc-300 hover:bg-white/10'
                    }`}
                  >
                    {r.label}
                  </a>
                )
              })}
              {!fullHistory && <ProBadge feature="analyticsHistory" />}
            </div>
            {currencyOptions.length > 1 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="mr-1 text-xs uppercase tracking-[0.18em] text-zinc-500">Currency</span>
                {currencyOptions.map((c) => (
                  <a
                    key={c}
                    href={href({ currency: c })}
                    className={`rounded-md border px-3 py-1.5 text-sm uppercase transition ${
                      selectedCurrency === c ? 'border-white bg-white text-black' : 'border-[var(--bd-10)] text-zinc-300 hover:bg-white/10'
                    }`}
                  >
                    {c}
                  </a>
                ))}
              </div>
            )}
          </div>

          {/* Insight line (only when there's a prior period to compare) */}
          {gmvDelta && (
            <p className="mt-5 flex items-start gap-2 rounded-lg border border-[var(--signal)]/20 bg-[var(--signal)]/[0.06] px-4 py-2.5 text-sm text-zinc-200">
              <Activity className="mt-0.5 size-4 shrink-0 text-[var(--signal)]" />
              <span>
                Versus {periodHuman}, GMV is {deltaPhrase(gmvDelta)}
                {netDelta && netDelta.dir !== 'flat' ? <> and net-to-you is {deltaPhrase(netDelta)}</> : null} ·{' '}
                {selectedCurrency.toUpperCase()}.
              </span>
            </p>
          )}

          {/* Hero KPIs (selected currency) */}
          <div className="nx-rise-stagger mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <KpiTile label="Gross sales" value={money(sel.gmvCents)} sub={`${sel.orders} settled order${sel.orders === 1 ? '' : 's'}`} delta={gmvDelta} icon={<TrendingUp className="size-4" />} />
            <KpiTile label="Net to you" value={money(sel.netCents)} sub="after refunds and platform fees" delta={netDelta} icon={<Coins className="size-4" />} tone="ready" />
            <KpiTile label="Nexez commission" value={money(sel.nexezFeeCents)} sub="retained after refunds" delta={feeDelta} icon={<Receipt className="size-4" />} />
            <KpiTile label="Avg order value" value={money(sel.aovCents)} sub={selectedCurrency.toUpperCase()} delta={aovDelta} icon={<ArrowUpRight className="size-4" />} />
            <KpiTile label="Escrow held" value={money(heldSel)} sub="pending settlement" icon={<Lock className="size-4" />} tone="amber" />
          </div>

          {report ? (
            <section className="mt-4 grid gap-3 rounded-2xl border border-[var(--bd-10)] bg-[var(--ov-02)] p-4 sm:grid-cols-2 lg:grid-cols-4">
              <OperationalStat label="Buyer requests" value={report.operations.openRequests} href="#buyer-requests" />
              <OperationalStat label="Open disputes" value={report.operations.disputedOrders + report.operations.disputedNegotiations} href="/dashboard/negotiations" tone="danger" />
              <OperationalStat label="Held over 48h" value={report.operations.staleHeldNegotiations} href="/dashboard/negotiations" tone="attention" />
              <OperationalStat label="Estimated economics" value={report.operations.estimatedEconomics} tone={report.operations.estimatedEconomics ? 'attention' : 'ready'} />
            </section>
          ) : null}

          {/* Where the money goes - GMV → commission + net (selected currency) */}
          {sel.gmvCents > 0 && (
            <GlassCard className="mt-6 p-6">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="flex items-center gap-2 text-lg font-semibold">
                  <ArrowLeftRight className="size-4 text-[var(--signal)]" /> Where the money goes
                </h2>
                <span className="text-sm text-[var(--fg-muted)]">
                  {money(sel.gmvCents)} GMV · {selectedCurrency.toUpperCase()}
                </span>
              </div>
              <MoneyFlowBar netCents={sel.netCents} feeCents={sel.nexezFeeCents} refundedCents={sel.refundedCents} gmvCents={sel.gmvCents} />
              <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                <FlowLegend swatch="var(--ready)" label="Net to you" value={money(sel.netCents)} pct={pct(sel.netCents, sel.gmvCents)} />
                <FlowLegend swatch="var(--signal)" label="Nexez commission" value={money(sel.nexezFeeCents)} pct={pct(sel.nexezFeeCents, sel.gmvCents)} />
                {sel.refundedCents > 0 ? (
                  <FlowLegend swatch="var(--amber)" label="Refunded or disputed" value={money(sel.refundedCents)} pct={pct(sel.refundedCents, sel.gmvCents)} />
                ) : null}
              </div>
              <p className="mt-3 text-[11px] text-zinc-500">
                Your Stripe processing fee is charged separately on your connected account and isn’t shown here.
              </p>
            </GlassCard>
          )}

          {/* Comparable captured sales by settlement channel. Uncaptured escrow stays below. */}
          {settlementChannels.length ? (
            <GlassCard className="mt-6 p-6">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h2 className="flex items-center gap-2 text-lg font-semibold"><Handshake className="size-4 text-[var(--signal)]" /> Settlement channels</h2>
                  <p className="mt-1 text-xs text-zinc-500">Captured transaction value by commerce rail · {selectedCurrency.toUpperCase()}</p>
                </div>
                <span className="text-xs text-zinc-500">Held escrow is excluded until capture</span>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {settlementChannels.map((row) => (
                  <div key={row.channel} className="rounded-xl border border-[var(--bd-10)] bg-black/20 p-4">
                    <div className="flex items-center justify-between gap-3"><span className="text-sm font-medium">{financeChannelLabel(row.channel)}</span><span className="text-xs text-zinc-500">{pct(row.grossCents, settlementChannelTotal)}%</span></div>
                    <p className="mt-2 text-2xl font-semibold">{money(row.grossCents)}</p>
                    <p className="mt-1 text-xs text-zinc-500">{row.transactions} transaction{row.transactions === 1 ? '' : 's'} · {money(row.netCents)} net</p>
                  </div>
                ))}
              </div>
            </GlassCard>
          ) : null}

          {/* Escrow lifecycle - where negotiated money sits right now (all-time balances) */}
          {hasEscrowActivity && (
            <GlassCard className="mt-6 p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-lg font-semibold">
                  <ShieldCheck className="size-4 text-[var(--ready)]" /> Escrow lifecycle
                  <span className="text-sm font-normal text-zinc-500">· {selectedCurrency.toUpperCase()} · to date</span>
                </h2>
                {reversalRate != null && (
                  <span className={`rounded-md px-2 py-1 text-xs ${reversalRate > 0.05 ? 'bg-[var(--amber)]/15 text-[var(--amber)]' : 'bg-[var(--ready)]/15 text-[var(--ready)]'}`}>
                    {(reversalRate * 100).toFixed(1)}% reversed
                  </span>
                )}
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <EscrowStat label="In escrow (held)" value={money(negSel.heldCents)} tone="amber" />
                <EscrowStat label="Captured (complete)" value={money(negSel.completeCents)} tone="ready" />
                <EscrowStat label="Reversed (refund/dispute)" value={money(negSel.reversedCents)} tone={negSel.reversedCents > 0 ? 'amber' : undefined} />
              </div>
              <p className="mt-3 text-[11px] text-zinc-500">
                Held funds release to you on capture; refunds and disputes are money out and exist only on this channel.
                These are Nexez records of agreed deals, reconciled with Stripe by our escrow job - distinct from your live
                Stripe balance below.
              </p>
            </GlassCard>
          )}

          {/* Revenue trend */}
          <GlassCard className="mt-6 p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <TrendingUp className="size-4 text-[var(--ready)]" /> Revenue over time
                <span className="text-sm font-normal text-zinc-500">· {selectedCurrency.toUpperCase()}</span>
              </h2>
              {gmvDelta && hasRevenue && (
                <span className="text-xs text-[var(--fg-muted)]">Trending {deltaPhrase(gmvDelta)} vs {periodHuman}</span>
              )}
            </div>
            {hasRevenue ? (
              <RevenueChart data={trend} currency={selectedCurrency} />
            ) : hasNegWindow || hasEscrowActivity ? (
              <p className="rounded-xl border border-dashed border-[var(--bd-10)] p-8 text-center text-sm text-zinc-500">
                No direct checkout sales in this window - your negotiated/escrow activity is shown above.
              </p>
            ) : (
              <EmptyFinance payoutsReady={payoutsReady} connectAccountId={connectAccountId} />
            )}
          </GlassCard>

          {/* Recent activity - unified ledger across both channels (centerpiece) */}
          {ledger.length > 0 && (
            <GlassCard className="mt-6 p-6">
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <Activity className="size-4 text-[var(--signal)]" /> Recent activity
                <span className="text-sm font-normal text-zinc-500">· last {ledger.length}</span>
              </h2>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[680px] text-left text-sm">
                  <thead className="text-xs uppercase tracking-wide text-zinc-500">
                    <tr className="border-b border-[var(--bd-10)]">
                      <th className="py-2 font-medium">When</th>
                      <th className="py-2 font-medium">Offer</th>
                      <th className="py-2 font-medium">Channel</th>
                      <th className="py-2 font-medium">Buyer</th>
                      <th className="py-2 text-right font-medium">Amount</th>
                      <th className="py-2 text-right font-medium">Est. fee</th>
                      <th className="py-2 text-right font-medium">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.map((e) => (
                      <LedgerRow key={e.id} entry={e} />
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-[11px] text-zinc-500">
                Direct rows are settled orders; negotiated rows are Stripe-funded escrow deals with their current status.
                Each row keeps its own currency and is never mixed into a cross-currency total.
              </p>
            </GlassCard>
          )}

          {/* Buyer-filed refund requests / problem reports from the order portal */}
          <BuyerRequestsPanel requests={buyerRequests} />

          {/* Direct-checkout orders with in-app refund */}
          <OrdersPanel orders={orders as OrderRow[]} />

          {/* Payouts + top offers */}
          <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1fr]">
            {/* Payouts */}
            <GlassCard className="p-6">
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <ArrowDownToLine className="size-4 text-[var(--signal)]" /> Payouts to your bank
              </h2>
              {!connectAccountId ? (
                <div className="mt-4 rounded-xl border border-[var(--signal)]/25 bg-[var(--signal)]/[0.06] p-4 text-sm text-zinc-300">
                  <p className="font-medium text-white">Connect Stripe to get paid</p>
                  <p className="mt-1 text-[var(--fg-muted)]">
                    Agents pay you directly. You need a connected account to accept card payments and receive payouts.
                  </p>
                  <a href="/dashboard/billing?tab=fees" className="btn-primary btn-sm mt-3 inline-flex">Set up payouts</a>
                </div>
              ) : !payouts ? (
                <p className="mt-4 text-sm text-[var(--fg-muted)]">
                  {payoutsReady ? 'Payout details are syncing from Stripe - refresh shortly.' : 'Finish Stripe verification to enable payouts.'}
                  <a href="/dashboard/billing?tab=fees" className="ml-2 text-[var(--signal)] hover:underline">Manage</a>
                </p>
              ) : (
                <div className="mt-4 space-y-4">
                  {nextPayout && (
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--ready)]/25 bg-[var(--ready)]/[0.06] px-3 py-2.5">
                      <span className="text-xs uppercase tracking-widest text-[var(--ready)]">Next expected payout</span>
                      <span className="text-sm font-semibold">
                        {formatCurrencyAmount(nextPayout.amountCents, nextPayout.currency)}
                        {nextPayout.arrivalDate ? (
                          <span className="ml-2 font-normal text-[var(--fg-muted)]">
                            ~{new Date(nextPayout.arrivalDate * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          </span>
                        ) : null}
                      </span>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <Balance label="Available" lines={payouts.available} />
                    <Balance label="Pending" lines={payouts.pending} />
                  </div>
                  <div className="border-t border-[var(--bd-10)] pt-3">
                    <p className="mb-2 text-xs uppercase tracking-widest text-zinc-500">Recent payouts</p>
                    {payouts.payouts.length ? (
                      <ul className="space-y-1.5 text-sm">
                        {payouts.payouts.slice(0, 5).map((p) => (
                          <li key={p.id} className="flex items-center justify-between gap-3">
                            <span className="text-zinc-300">{formatCurrencyAmount(p.amountCents, p.currency)}</span>
                            <span className="flex items-center gap-2 text-xs text-zinc-500">
                              {p.arrivalDate ? new Date(p.arrivalDate * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '-'}
                              <PayoutStatus status={p.status} />
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-zinc-500">No payouts yet - they’ll appear here once you make sales.</p>
                    )}
                  </div>
                </div>
              )}
            </GlassCard>

            {/* Top offers by revenue */}
            <GlassCard className="p-6">
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <ArrowUpRight className="size-4 text-[var(--signal)]" /> Top offers by revenue
                <span className="text-sm font-normal text-zinc-500">· {selectedCurrency.toUpperCase()}</span>
              </h2>
              {topOffers.length ? (
                <ul className="mt-4 space-y-2">
                  {topOffers.map((o, i) => (
                    <li key={`${o.pageSlug}-${o.offerKey}`} className="flex items-center justify-between gap-4 rounded-lg border border-[var(--bd-10)] bg-black/20 px-4 py-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="text-xs text-zinc-500">#{i + 1}</span>
                        <div className="min-w-0">
                          <p className="truncate font-medium">{o.name}</p>
                          <p className="truncate font-mono text-xs text-zinc-500">/{o.pageSlug}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold text-[var(--ready)]">{money(o.revenueCents)}</p>
                        <p className="text-xs text-zinc-500">{o.orders} order{o.orders === 1 ? '' : 's'}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 text-sm text-zinc-500">No offer revenue in this window yet.</p>
              )}
            </GlassCard>
          </div>

          {/* Per-currency breakdown (only when multi-currency) */}
          {byCurrency.length > 1 && (
            <GlassCard className="mt-6 p-6">
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <Coins className="size-4 text-[var(--ready)]" /> By currency
              </h2>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[420px] text-left text-sm">
                  <thead className="text-zinc-500">
                    <tr>
                      <th className="py-2 font-medium">Currency</th>
                      <th className="py-2 text-right font-medium">GMV</th>
                      <th className="py-2 text-right font-medium">Fee</th>
                      <th className="py-2 text-right font-medium">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byCurrency.map((r) => (
                      <tr key={r.currency} className={`border-t border-[var(--bd-10)] ${r.currency === selectedCurrency ? 'text-white' : 'text-zinc-300'}`}>
                        <td className="py-2.5 font-medium uppercase">{r.currency}</td>
                        <td className="py-2.5 text-right">{formatCurrencyAmount(r.gmvCents, r.currency)}</td>
                        <td className="py-2.5 text-right text-[var(--fg-muted)]">{formatCurrencyAmount(r.nexezFeeCents, r.currency)}</td>
                        <td className="py-2.5 text-right text-[var(--ready)]">{formatCurrencyAmount(r.netCents, r.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-3 text-[11px] text-zinc-500">Each currency is shown on its own - totals are never mixed across currencies.</p>
              </div>
            </GlassCard>
          )}

          {/* Your subscription (cost, separated from earnings) */}
          <GlassCard className="mt-6 p-6">
            <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-semibold">
                  <Receipt className="size-4 text-[var(--fg-muted)]" /> Your Nexez subscription
                </h2>
                <p className="mt-1 text-sm text-[var(--fg-muted)]">
                  What you pay Nexez (separate from your earnings above). You’re on{' '}
                  <span className="font-medium text-white">{activePlan?.name ?? 'Free'}</span>
                  {activePlan?.cadence ? ` · ${activePlan.price}/${activePlan.cadence}` : ''} ·{' '}
                  {commissionPct}% per-sale fee
                  {billing?.status ? ` · ${billingStatusCopy(billing.status).label}` : ''}.
                </p>
              </div>
              <a href="/dashboard/billing" className="btn-primary btn-sm inline-flex shrink-0">Manage plan</a>
            </div>
          </GlassCard>

          <p className="mt-6 text-center text-[11px] text-zinc-600">
            Financial totals include only transactions whose Stripe objects are verified as live mode. Gross sales come from
            durable paid orders, and net amounts account for recorded refunds and sale-time platform fees. Test and unverified
            historical records are excluded. Stripe balances remain the source of truth for available cash and payouts.
          </p>
        </div>
      </ErrorBoundary>
    </main>
  )
}

function financeDailySeries(report: FinanceRollup, days: number, currency: string) {
  const values = new Map(
    report.daily
      .filter((row) => row.currency === currency)
      .map((row) => [row.date, row]),
  )
  const now = new Date()
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - index - 1)))
    const dateKey = date.toISOString().slice(0, 10)
    const row = values.get(dateKey)
    return {
      label: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
      dateKey,
      revenueCents: row?.grossCents ?? 0,
      orders: row?.transactions ?? 0,
    }
  })
}

function financeChannelLabel(channel: string) {
  return ({
    direct: 'Direct checkout',
    agent_checkout: 'Direct checkout',
    acp: 'ACP checkout',
    ucp: 'UCP checkout',
    agent_protocol: 'ACP / UCP',
    recurring: 'Recurring service',
    recurring_service: 'Recurring service',
    staged: 'Staged settlement',
    staged_settlement: 'Staged settlement',
    reserved: 'Reserved resource',
    reservable_resource: 'Reserved resource',
    nexie: 'Nexie-assisted',
    negotiated: 'Negotiated capture',
    negotiated_order: 'Negotiated order',
    settled_orders: 'Settled orders',
  } as Record<string, string>)[channel] ?? channel.replace(/_/g, ' ')
}

function OperationalStat({
  label,
  value,
  href,
  tone = value ? 'attention' : 'ready',
}: {
  label: string
  value: number
  href?: string
  tone?: 'ready' | 'attention' | 'danger'
}) {
  const color = tone === 'ready' ? 'text-[var(--ready)]' : tone === 'danger' ? 'text-red-300' : 'text-[var(--amber)]'
  const content = <><span className={`text-xl font-semibold ${color}`}>{value}</span><span className="text-xs text-zinc-500">{label}</span></>
  return href
    ? <a href={href} className="flex min-h-[58px] items-center justify-between gap-3 rounded-xl border border-[var(--bd-10)] bg-black/20 px-4 transition hover:bg-[var(--ov-05)]">{content}</a>
    : <div className="flex min-h-[58px] items-center justify-between gap-3 rounded-xl border border-[var(--bd-10)] bg-black/20 px-4">{content}</div>
}

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0
}

function deltaPhrase(delta: KpiDelta): string {
  const num = delta.text.match(/-?\d+%/)?.[0]
  if (!num) return delta.text.startsWith('new') ? 'up from zero' : delta.text
  return `${delta.dir === 'down' ? 'down' : 'up'} ${num.replace('-', '')}`
}

function KpiTile({
  label,
  value,
  sub,
  delta,
  icon,
  tone,
}: {
  label: string
  value: string
  sub?: string
  delta?: KpiDelta | null
  icon: React.ReactNode
  tone?: 'ready' | 'amber'
}) {
  const valueClass = tone === 'ready' ? 'text-[var(--ready)]' : tone === 'amber' ? 'text-[var(--amber)]' : 'text-white'
  return (
    <GlassCard className="p-5">
      <p className="flex items-center gap-2 text-xs uppercase tracking-wide text-zinc-500">
        {icon}
        {label}
      </p>
      <p className={`mt-3 text-2xl font-semibold tracking-tight ${valueClass}`}>{value}</p>
      {delta ? (
        <p
          className={`mt-1.5 inline-flex items-center gap-1 text-xs ${
            delta.dir === 'up' ? 'text-[var(--ready)]' : delta.dir === 'down' ? 'text-red-300' : 'text-[var(--fg-muted)]'
          }`}
        >
          {delta.dir === 'up' ? <ArrowUpRight className="size-3.5" /> : delta.dir === 'down' ? <ArrowDownRight className="size-3.5" /> : <Minus className="size-3.5" />}
          {delta.text}
        </p>
      ) : null}
      {sub && <p className="mt-1 text-xs text-zinc-500">{sub}</p>}
    </GlassCard>
  )
}

function MoneyFlowBar({
  netCents,
  feeCents,
  refundedCents,
  gmvCents,
}: {
  netCents: number
  feeCents: number
  refundedCents: number
  gmvCents: number
}) {
  const netPct = pct(netCents, gmvCents)
  const refundPct = pct(refundedCents, gmvCents)
  const feePct = Math.max(0, 100 - netPct - refundPct)
  return (
    <div className="mt-4 flex h-9 overflow-hidden rounded-lg border border-[var(--bd-10)]">
      <div className="bg-[var(--ready)]/80" style={{ width: `${netPct}%` }} title={`Net to you · ${netPct}%`} />
      <div className="bg-[var(--signal)]/80" style={{ width: `${feePct}%` }} title={`Nexez commission · ${feePct}%`} />
      {refundPct > 0 ? <div className="bg-[var(--amber)]/80" style={{ width: `${refundPct}%` }} title={`Refunded or disputed · ${refundPct}%`} /> : null}
    </div>
  )
}

function FlowLegend({ swatch, label, value, pct: p }: { swatch: string; label: string; value: string; pct: number }) {
  return (
    <span className="inline-flex items-center gap-2 text-zinc-300">
      <span className="size-2.5 rounded-sm" style={{ backgroundColor: swatch }} />
      {label}: <span className="font-medium text-white">{value}</span> <span className="text-zinc-500">({p}%)</span>
    </span>
  )
}

function EscrowStat({ label, value, tone }: { label: string; value: string; tone?: 'ready' | 'amber' }) {
  const cls = tone === 'ready' ? 'text-[var(--ready)]' : tone === 'amber' ? 'text-[var(--amber)]' : 'text-white'
  return (
    <div className="rounded-lg border border-[var(--bd-10)] bg-black/20 p-3">
      <p className="text-xs uppercase tracking-widest text-zinc-500">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${cls}`}>{value}</p>
    </div>
  )
}

const LEDGER_TONE: Record<'open' | 'progress' | 'success' | 'muted', string> = {
  open: 'bg-[var(--amber)]/15 text-[var(--amber)]',
  progress: 'bg-[var(--signal)]/15 text-[var(--signal)]',
  success: 'bg-[var(--ready)]/15 text-[var(--ready)]',
  muted: 'bg-white/10 text-zinc-300',
}

function LedgerRow({ entry }: { entry: LedgerEntry }) {
  const when = entry.timestamp ? new Date(entry.timestamp) : null
  return (
    <tr className="border-b border-[var(--bd-05)] last:border-b-0 hover:bg-[var(--ov-03)]">
      <td className="py-2.5 pr-3 text-xs text-[var(--fg-muted)] whitespace-nowrap">
        {when ? when.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '-'}
        {when ? <span className="ml-1 text-zinc-600">{when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span> : null}
      </td>
      <td className="py-2.5 pr-3">
        <p className="max-w-[200px] truncate font-medium">{entry.offerName}</p>
        {entry.pageSlug ? <p className="max-w-[200px] truncate font-mono text-[11px] text-zinc-500">/{entry.pageSlug}</p> : null}
      </td>
      <td className="py-2.5 pr-3">
        {entry.channel === 'direct' ? (
          <span className={`rounded-full px-2 py-0.5 text-[11px] ${entry.status === 'paid' || entry.status === 'dispute_won' ? 'bg-[var(--ready)]/15 text-[var(--ready)]' : 'bg-[var(--amber)]/15 text-[var(--amber)]'}`}>
            {financeChannelLabel(entry.sourceChannel === 'agent_checkout' || !entry.sourceChannel ? 'direct' : entry.sourceChannel)}
            {entry.status === 'paid' ? '' : ` · ${entry.status?.replace('_', ' ') || ''}`}
          </span>
        ) : (
          <span className={`rounded-full px-2 py-0.5 text-[11px] ${entry.status === 'partial_refund' ? LEDGER_TONE.open : LEDGER_TONE[getNegotiationStatusTone((entry.status ?? 'negotiation') as NegotiationStatus)]}`}>
            {entry.status === 'partial_refund' ? 'Partial refund' : entry.status ? getNegotiationStatusLabel(entry.status as NegotiationStatus) : 'Negotiated'}
          </span>
        )}
      </td>
      <td className="py-2.5 pr-3 text-zinc-300">
        <span className="block max-w-[160px] truncate">{entry.buyerLabel}</span>
      </td>
      <td className="py-2.5 pl-3 text-right whitespace-nowrap">
        {formatCurrencyAmount(entry.amountCents, entry.currency)}
        <span className="ml-1 text-[10px] uppercase text-zinc-600">{entry.currency}</span>
      </td>
      <td className="py-2.5 pl-3 text-right text-zinc-500 whitespace-nowrap">{formatCurrencyAmount(entry.feeCents, entry.currency)}</td>
      <td className={`py-2.5 pl-3 text-right font-medium whitespace-nowrap ${entry.isReversal ? 'text-[var(--amber)]' : 'text-[var(--ready)]'}`}>
        {entry.isReversal && entry.channel === 'negotiated' ? '−' : ''}
        {formatCurrencyAmount(entry.netCents, entry.currency)}
      </td>
    </tr>
  )
}

function Balance({ label, lines }: { label: string; lines: { amountCents: number; currency: string }[] }) {
  return (
    <div className="rounded-lg border border-[var(--bd-10)] bg-black/20 p-3">
      <p className="text-xs uppercase tracking-widest text-zinc-500">{label}</p>
      {lines.length ? (
        lines.map((l) => (
          <p key={l.currency} className="mt-1 text-lg font-semibold">
            {formatCurrencyAmount(l.amountCents, l.currency)}
          </p>
        ))
      ) : (
        <p className="mt-1 text-lg font-semibold text-zinc-500">-</p>
      )}
    </div>
  )
}

function PayoutStatus({ status }: { status: string }) {
  const ok = status === 'paid'
  const warn = status === 'failed' || status === 'canceled'
  const cls = ok
    ? 'bg-[var(--ready)]/15 text-[var(--ready)]'
    : warn
      ? 'bg-[var(--amber)]/15 text-[var(--amber)]'
      : 'bg-white/10 text-zinc-300'
  return <span className={`rounded px-1.5 py-0.5 text-[10px] ${cls}`}>{status.replace('_', ' ')}</span>
}

function EmptyFinance({ payoutsReady, connectAccountId }: { payoutsReady: boolean; connectAccountId: string | null }) {
  const ctas: EmptyStateCta[] = []
  if (!connectAccountId) ctas.push({ label: 'Connect Stripe', href: '/dashboard/billing?tab=fees' })
  ctas.push({ label: 'View your listings', href: '/dashboard/listings', variant: 'secondary' })
  return (
    <EmptyState icon={Wallet} title="Your first sale lands here" ctas={ctas}>
      When an agent buys through one of your listings, the revenue, Nexez fee, net-to-you, and payouts all show up here -
      per currency.
      {!connectAccountId
        ? ' First, connect Stripe so you can accept payments.'
        : !payoutsReady
          ? ' Finish Stripe verification to enable payouts.'
          : ''}
    </EmptyState>
  )
}

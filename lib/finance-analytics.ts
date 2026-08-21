// Marketplace financial roll-ups for the Finance dashboard. Pure + client-safe
// so they're unit-testable and can run in either a server page or a client island.
// Direct GMV comes only from durable, paid checkout_orders that Stripe has proven
// are live-mode. Telemetry such as "checkout started" is never treated as revenue.
//
// HARD RULE: never sum amounts ACROSS currencies - amount_cents is the page's
// settlement-currency smallest unit (per lib/currency), so cross-currency sums are
// meaningless. Everything here buckets BY currency.
import { normalizeCurrency, minorToStripeAmount } from './currency'
import { calculateApplicationFeeCents } from './stripe-billing'

export type DirectFinanceRow = {
  id: string
  page_id?: string | null
  status: string
  channel?: string | null
  amount_cents: number
  refunded_cents?: number | null
  currency: string | null
  slug?: string | null
  offer_name?: string | null
  offer_key?: string | null
  buyer_agent?: string | null
  buyer_name?: string | null
  buyer_email?: string | null
  buyer_reference?: string | null
  commission_percent?: number | null
  application_fee_cents?: number | null
  stripe_livemode: boolean | null
  created_at: string
}

function isLiveOrder(order: DirectFinanceRow): boolean {
  return order.stripe_livemode === true && Number.isFinite(order.amount_cents) && order.amount_cents > 0
}

function orderCurrency(order: DirectFinanceRow): string {
  return normalizeCurrency(order.currency)
}

/** Amount still attributable to the seller after refunds or an open dispute. */
function orderRemainingCents(order: DirectFinanceRow): number {
  if (order.status === 'disputed') return 0
  const refunded = order.status === 'refunded' && !order.refunded_cents
    ? order.amount_cents
    : Math.max(0, Number(order.refunded_cents) || 0)
  return Math.max(0, order.amount_cents - Math.min(order.amount_cents, refunded))
}

/** Stripe proportionally returns an application fee on partial refunds. */
function retainedFeeCents(order: DirectFinanceRow, fallbackCommissionPct: number): number {
  const remaining = orderRemainingCents(order)
  if (remaining <= 0) return 0
  const snapshot = Number(order.application_fee_cents)
  if (order.application_fee_cents != null && Number.isFinite(snapshot) && snapshot >= 0) {
    return Math.round((snapshot * remaining) / order.amount_cents)
  }
  const commissionPct = order.commission_percent != null && Number.isFinite(Number(order.commission_percent))
    ? Number(order.commission_percent)
    : fallbackCommissionPct
  return calculateApplicationFeeCents(remaining, commissionPct)
}

function dateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export type CurrencyFinanceRow = {
  currency: string
  gmvCents: number
  orders: number
  refundedCents: number
  nexezFeeCents: number
  netCents: number
  aovCents: number
}

/**
 * Per-currency financial roll-up: GMV, order count, Nexez commission (derived
 * from the current plan rate), net-to-seller, and AOV. Sorted by GMV desc.
 *
 * SECURITY / AUDIT NOTE (red-team finding):
 * Commission was historically **derived from the owner's *current* plan** at read time.
 * Snapshots (commission_percent + application_fee_cents) are now persisted at charge
 * time (migration 20260627000000 + wiring in checkout/pay/webhook).
 * Rollups/ledgers prefer snapshot when present for historical accuracy. Fallback to
 * current plan derivation for legacy rows.
 */
export function rollupFinanceByCurrency(orders: DirectFinanceRow[], commissionPct: number): CurrencyFinanceRow[] {
  const map = new Map<string, { gmvCents: number; orders: number; refundedCents: number; feeCents: number; netCents: number }>()
  for (const order of orders) {
    if (!isLiveOrder(order)) continue
    const code = orderCurrency(order)
    const row = map.get(code) ?? { gmvCents: 0, orders: 0, refundedCents: 0, feeCents: 0, netCents: 0 }
    const remaining = orderRemainingCents(order)
    const fee = retainedFeeCents(order, commissionPct)
    row.gmvCents += order.amount_cents
    row.orders += 1
    row.refundedCents += order.amount_cents - remaining
    row.feeCents += fee
    row.netCents += Math.max(0, remaining - fee)
    map.set(code, row)
  }
  return [...map.entries()]
    .map(([currency, row]) => ({
      currency,
      gmvCents: row.gmvCents,
      orders: row.orders,
      refundedCents: row.refundedCents,
      nexezFeeCents: row.feeCents,
      netCents: row.netCents,
      aovCents: row.orders ? Math.round(row.gmvCents / row.orders) : 0,
    }))
    .sort((a, b) => b.gmvCents - a.gmvCents)
}

export type DailyRevenuePoint = { label: string; dateKey: string; revenueCents: number; orders: number }

/** Per-day GMV series for the trend chart; optionally scoped to one currency. */
export function getDailyRevenueSeries(orders: DirectFinanceRow[], days = 30, currency?: string): DailyRevenuePoint[] {
  const now = new Date()
  const points: DailyRevenuePoint[] = []
  for (let index = days - 1; index >= 0; index -= 1) {
    const date = new Date(now)
    date.setHours(0, 0, 0, 0)
    date.setDate(now.getDate() - index)
    points.push({
      label: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      dateKey: dateKey(date),
      revenueCents: 0,
      orders: 0,
    })
  }
  const byKey = new Map(points.map((point) => [point.dateKey, point]))
  const want = currency ? normalizeCurrency(currency) : null
  for (const order of orders) {
    if (!isLiveOrder(order)) continue
    if (want && orderCurrency(order) !== want) continue
    const point = byKey.get(dateKey(new Date(order.created_at)))
    if (point) {
      point.revenueCents += order.amount_cents
      point.orders += 1
    }
  }
  return points
}

export type OfferRevenue = { name: string; pageSlug: string; offerKey: string; revenueCents: number; orders: number }

/** Top offers ranked by GMV (not event count); optionally scoped to one currency. */
export function getTopOffersByRevenueCents(orders: DirectFinanceRow[], currency?: string): OfferRevenue[] {
  const map = new Map<string, OfferRevenue>()
  const want = currency ? normalizeCurrency(currency) : null
  for (const order of orders) {
    if (!isLiveOrder(order) || order.offer_key === 'page') continue
    if (want && orderCurrency(order) !== want) continue
    const key = `${order.slug ?? ''}:${order.offer_key ?? ''}`
    const row =
      map.get(key) ??
      ({
        name: order.offer_name || order.offer_key || 'Order',
        pageSlug: order.slug ?? '',
        offerKey: order.offer_key ?? 'offer',
        revenueCents: 0,
        orders: 0,
      } satisfies OfferRevenue)
    row.revenueCents += order.amount_cents
    row.orders += 1
    map.set(key, row)
  }
  return [...map.values()].sort((a, b) => b.revenueCents - a.revenueCents)
}

/** Distinct settlement currencies seen in revenue events, dominant (by GMV) first. */
export function getCurrencyOptions(orders: DirectFinanceRow[]): string[] {
  const gmv = new Map<string, number>()
  for (const order of orders) {
    if (!isLiveOrder(order)) continue
    const code = orderCurrency(order)
    gmv.set(code, (gmv.get(code) ?? 0) + order.amount_cents)
  }
  return [...gmv.entries()].sort((a, b) => b[1] - a[1]).map(([code]) => code)
}

// ── Negotiated / escrow channel ─────────────────────────────────────────────
// The second revenue rail (agent_negotiations). Distinct from direct checkout:
// these are AGREED escrow amounts with a real settlement lifecycle, NOT checkout
// intent - never sum the two channels into one number, and never across currencies.

/** The widened agent_negotiations row the finance page selects (status + money + provenance). */
export type NegotiationFinanceRow = {
  id?: string | null
  status: string
  amount_cents: number | null
  currency: string | null
  slug?: string | null
  offer_name?: string | null
  buyer_agent?: string | null
  created_at?: string | null
  updated_at?: string | null
  stripe_livemode: boolean | null
  refunded_cents?: number | null
  commission_percent?: number | null
  application_fee_cents?: number | null
}

export type NegotiationCurrencyRow = {
  currency: string
  agreedCents: number
  deals: number
  heldCents: number
  completeCents: number
  reversedCents: number
}

// A deal counts as funded once real live-mode money reaches escrow. Reversals
// remain in funded/captured history and are surfaced separately as money OUT.
const AGREED_STATUSES = new Set(['held', 'complete', 'refunded', 'disputed'])

/**
 * Per-currency roll-up of the negotiated/escrow channel: agreed value + deal
 * count, currently-held escrow, captured (complete), and reversed
 * (refunded + disputed). Mirrors rollupFinanceByCurrency's per-currency shape so
 * one component renders both channels. NEVER sums across currencies.
 */
export function rollupNegotiationsByCurrency(negs: NegotiationFinanceRow[]): NegotiationCurrencyRow[] {
  const map = new Map<string, NegotiationCurrencyRow>()
  for (const n of negs) {
    if (!n.amount_cents || n.stripe_livemode !== true || !AGREED_STATUSES.has(n.status)) continue
    const currency = normalizeCurrency(n.currency)
    const row =
      map.get(currency) ??
      { currency, agreedCents: 0, deals: 0, heldCents: 0, completeCents: 0, reversedCents: 0 }
    // negotiation amount_cents is stored major×100; convert to the Stripe smallest unit
    // the rest of finance (formatCurrencyAmount) displays, so zero-decimal (JPY/KRW)
    // deals aren't shown 100× too large.
    const cents = minorToStripeAmount(n.amount_cents, currency)
    row.agreedCents += cents
    row.deals += 1
    const refunded = n.status === 'disputed'
      ? cents
      : n.status === 'refunded' && !n.refunded_cents
        ? cents
        : Math.min(cents, Math.max(0, Number(n.refunded_cents) || 0))
    if (n.status === 'held') row.heldCents += cents
    else if (n.status === 'complete') row.completeCents += cents
    else if (n.status === 'refunded' || n.status === 'disputed') row.completeCents += cents
    row.reversedCents += refunded
    map.set(currency, row)
  }
  return [...map.values()].sort((a, b) => b.agreedCents - a.agreedCents)
}

/**
 * Share of captured escrow value that was later reversed (refunded/disputed) - a
 * marketplace trust signal. Returns null when there's no settled volume to judge
 * (mirrors pctDelta's "no signal → null" so the UI shows "-" not a fake 0%).
 */
export function getReversalRate(row: { completeCents: number; reversedCents: number }): number | null {
  const denom = row.completeCents
  if (denom <= 0) return null
  return row.reversedCents / denom
}

// ── Unified marketplace ledger ──────────────────────────────────────────────

export type LedgerEntry = {
  id: string
  channel: 'direct' | 'negotiated'
  sourceChannel?: string | null
  timestamp: string
  offerName: string
  pageSlug: string
  buyerLabel: string
  amountCents: number
  currency: string
  feeCents: number
  netCents: number
  status: string | null
  isReversal: boolean
}

// Negotiation statuses that represent a real money event worth a ledger row.
const LEDGER_NEG_STATUSES = new Set(['held', 'complete', 'refunded', 'disputed'])

/**
 * Interleave the DIRECT checkout channel (checkout_orders) and the NEGOTIATED
 * escrow channel (agent_negotiations) into one time-ordered ledger - the living
 * record of marketplace activity. Fee prefers charge-time snapshot if present on the
 * row (post 20260627 migration), else derives from passed current plan rate.
 * Each row carries its own currency;
 * callers must never total the amount/fee/net columns (mixed currencies coexist
 * as independent rows). Skips dry-run + amount-less rows.
 */
export function buildMarketplaceLedger(
  orders: DirectFinanceRow[],
  negs: NegotiationFinanceRow[],
  commissionPct: number,
  limit = 25,
): LedgerEntry[] {
  const entries: LedgerEntry[] = []
  for (const order of orders) {
    if (!isLiveOrder(order)) continue
    const amountCents = order.amount_cents
    const remainingCents = orderRemainingCents(order)
    const refundedCents = amountCents - remainingCents
    const feeCents = retainedFeeCents(order, commissionPct)
    const buyerLabel = order.buyer_agent || order.buyer_name || order.buyer_email || order.buyer_reference || 'Buyer'
    entries.push({
      id: order.id,
      channel: 'direct',
      sourceChannel: order.channel,
      timestamp: order.created_at,
      offerName: order.offer_name || order.offer_key || 'Order',
      pageSlug: order.slug ?? '',
      buyerLabel: buyerLabel.slice(0, 72),
      amountCents,
      currency: orderCurrency(order),
      feeCents,
      netCents: Math.max(0, remainingCents - feeCents),
      status: refundedCents > 0 && remainingCents > 0 ? 'partial_refund' : order.status,
      isReversal: remainingCents === 0,
    })
  }
  for (const n of negs) {
    if (!n.amount_cents || n.stripe_livemode !== true || !LEDGER_NEG_STATUSES.has(n.status)) continue
    // Convert the app's major×100 amount to the Stripe smallest unit so it lines up
    // with the (already smallest-unit) application_fee_cents snapshot + the display
    // formatter; otherwise zero-decimal currencies mis-state amount/fee/net.
    const amountCents = minorToStripeAmount(n.amount_cents, normalizeCurrency(n.currency))
    const refundedCents = n.status === 'disputed'
      ? amountCents
      : n.status === 'refunded' && !n.refunded_cents
        ? amountCents
        : Math.min(amountCents, Math.max(0, Number(n.refunded_cents) || 0))
    const isReversal = n.status === 'disputed' || refundedCents > 0
    const remainingCents = Math.max(0, amountCents - refundedCents)
    // Prefer snapshot at charge time if present (from migration 20260627000000),
    // then reduce retained fee proportionally for a partial or full refund.
    const snapshotFee = n.application_fee_cents
    const originalFeeCents = snapshotFee != null && Number.isFinite(Number(snapshotFee))
      ? Number(snapshotFee)
      : calculateApplicationFeeCents(amountCents, commissionPct)
    const feeCents = amountCents > 0 ? Math.round((originalFeeCents * remainingCents) / amountCents) : 0
    entries.push({
      id: n.id ? `neg-${n.id}` : `neg-${n.slug ?? ''}-${n.created_at ?? ''}`,
      channel: 'negotiated',
      sourceChannel: 'negotiation',
      timestamp: isReversal ? n.updated_at ?? n.created_at ?? '' : n.created_at ?? '',
      offerName: n.offer_name || 'Negotiated deal',
      pageSlug: n.slug ?? '',
      buyerLabel: (n.buyer_agent || 'Agent').slice(0, 72),
      amountCents,
      currency: normalizeCurrency(n.currency),
      feeCents,
      netCents: isReversal ? refundedCents : Math.max(0, remainingCents - feeCents),
      status: refundedCents > 0 && refundedCents < amountCents ? 'partial_refund' : n.status,
      isReversal,
    })
  }
  return entries
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0))
    .slice(0, limit)
}

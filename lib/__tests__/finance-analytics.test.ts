import { describe, it, expect } from 'vitest'
import {
  rollupFinanceByCurrency,
  getDailyRevenueSeries,
  getTopOffersByRevenueCents,
  getCurrencyOptions,
  rollupNegotiationsByCurrency,
  getReversalRate,
  buildMarketplaceLedger,
  type DirectFinanceRow,
  type NegotiationFinanceRow,
} from '../finance-analytics'

function order(over: Partial<DirectFinanceRow> = {}): DirectFinanceRow {
  return {
    id: 'o',
    page_id: 'p',
    slug: 'acme',
    offer_key: 'services-0',
    offer_name: 'Consult',
    status: 'paid',
    amount_cents: 1000,
    refunded_cents: 0,
    currency: 'usd',
    commission_percent: null,
    application_fee_cents: null,
    stripe_livemode: true,
    created_at: new Date().toISOString(),
    ...over,
  }
}

describe('rollupFinanceByCurrency', () => {
  it('buckets GMV / orders / commission / net / AOV by currency and never sums across them', () => {
    const events = [
      order({ amount_cents: 5000, currency: 'usd' }),
      order({ amount_cents: 3000, currency: 'usd' }),
      order({ amount_cents: 10000, currency: 'gbp' }),
    ]
    const rows = rollupFinanceByCurrency(events, 10) // 10% commission
    expect(rows.map((r) => r.currency)).toEqual(['gbp', 'usd']) // sorted by GMV desc (10000 > 8000)
    const usd = rows.find((r) => r.currency === 'usd')!
    expect(usd.gmvCents).toBe(8000)
    expect(usd.orders).toBe(2)
    expect(usd.nexezFeeCents).toBe(800) // 10% of 8000
    expect(usd.netCents).toBe(7200)
    expect(usd.aovCents).toBe(4000)
    const gbp = rows.find((r) => r.currency === 'gbp')!
    expect(gbp.gmvCents).toBe(10000)
    expect(gbp.nexezFeeCents).toBe(1000)
  })

  it('fails closed for test-mode and unverified historical orders', () => {
    const orders = [
      order({ amount_cents: 5000, currency: 'usd' }),
      order({ amount_cents: 9999, currency: 'usd', stripe_livemode: false }),
      order({ amount_cents: 9999, currency: 'usd', stripe_livemode: null }),
    ]
    const rows = rollupFinanceByCurrency(orders, 15)
    expect(rows).toHaveLength(1)
    expect(rows[0].gmvCents).toBe(5000)
  })

  it('reduces seller net and the retained application fee proportionally after a partial refund', () => {
    const [row] = rollupFinanceByCurrency([
      order({ amount_cents: 10000, refunded_cents: 2500, application_fee_cents: 1000 }),
    ], 15)
    expect(row.gmvCents).toBe(10000)
    expect(row.refundedCents).toBe(2500)
    expect(row.nexezFeeCents).toBe(750)
    expect(row.netCents).toBe(6750)
  })

  it('treats missing currency as usd and keeps zero-decimal units unchanged', () => {
    const rows = rollupFinanceByCurrency([order({ amount_cents: 1000, currency: 'jpy' }), order({ amount_cents: 5000, currency: null })], 6)
    expect(rows.find((r) => r.currency === 'jpy')!.gmvCents).toBe(1000)
    expect(rows.find((r) => r.currency === 'usd')!.gmvCents).toBe(5000)
  })
})

describe('getTopOffersByRevenueCents', () => {
  it('ranks offers by GMV, optionally scoped to one currency, skipping the page key', () => {
    const events = [
      order({ amount_cents: 5000, currency: 'usd', offer_key: 'services-0', offer_name: 'Consult' }),
      order({ amount_cents: 9000, currency: 'usd', offer_key: 'products-0', offer_name: 'Kit' }),
      order({ amount_cents: 9999, currency: 'usd', offer_key: 'page' }),
      order({ amount_cents: 7000, currency: 'gbp', offer_key: 'services-0', offer_name: 'Consult' }),
    ]
    const usd = getTopOffersByRevenueCents(events, 'usd')
    expect(usd.map((o) => o.offerKey)).toEqual(['products-0', 'services-0'])
    expect(usd[0].revenueCents).toBe(9000)
    expect(usd.some((o) => o.offerKey === 'page')).toBe(false)
  })
})

function neg(over: Partial<NegotiationFinanceRow>): NegotiationFinanceRow {
  return { status: 'complete', amount_cents: 1000, currency: 'usd', slug: 'acme', offer_name: 'Consult', buyer_agent: 'Acme', created_at: '2026-06-10T00:00:00Z', stripe_livemode: true, ...over }
}

describe('rollupNegotiationsByCurrency', () => {
  it('buckets agreed/held/complete/reversed by currency and never across them', () => {
    const rows = rollupNegotiationsByCurrency([
      neg({ status: 'held', amount_cents: 5000, currency: 'usd' }),
      neg({ status: 'complete', amount_cents: 3000, currency: 'usd' }),
      neg({ status: 'refunded', amount_cents: 1000, currency: 'usd' }),
      neg({ status: 'disputed', amount_cents: 500, currency: 'usd' }),
      neg({ status: 'agreement_proposed', amount_cents: 2000, currency: 'gbp' }),
      neg({ status: 'negotiation', amount_cents: 9999, currency: 'usd' }), // not yet agreed → excluded
      neg({ status: 'complete', amount_cents: null, currency: 'usd' }), // amount-less → skipped
    ])
    const usd = rows.find((r) => r.currency === 'usd')!
    expect(usd.agreedCents).toBe(9500) // every live funded lifecycle, including reversals
    expect(usd.deals).toBe(4)
    expect(usd.heldCents).toBe(5000)
    expect(usd.completeCents).toBe(4500)
    expect(usd.reversedCents).toBe(1500) // refunded 1000 + disputed 500
    expect(rows.find((r) => r.currency === 'gbp')).toBeUndefined()
  })

  it('excludes test-mode and unverified funded negotiations', () => {
    const rows = rollupNegotiationsByCurrency([
      neg({ amount_cents: 1000, stripe_livemode: true }),
      neg({ amount_cents: 9000, stripe_livemode: false }),
      neg({ amount_cents: 9000, stripe_livemode: null }),
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].completeCents).toBe(1000)
  })

  it('converts the app major×100 amount to the smallest unit for zero-decimal currencies (JPY)', () => {
    // ¥1,000 / ¥500 deals are stored as 100000 / 50000 (major×100) but must roll up as
    // 1000 / 500 (Stripe smallest unit) so the dashboard doesn't show them 100× too large.
    const rows = rollupNegotiationsByCurrency([
      neg({ status: 'complete', amount_cents: 100000, currency: 'jpy' }),
      neg({ status: 'held', amount_cents: 50000, currency: 'jpy' }),
    ])
    const jpy = rows.find((r) => r.currency === 'jpy')!
    expect(jpy.completeCents).toBe(1000)
    expect(jpy.heldCents).toBe(500)
    expect(jpy.agreedCents).toBe(1500)
  })
})

describe('getReversalRate', () => {
  it('is reversed / (complete + reversed), or null when there is no settled volume', () => {
    expect(getReversalRate({ completeCents: 10000, reversedCents: 1000 })).toBeCloseTo(0.1)
    expect(getReversalRate({ completeCents: 0, reversedCents: 0 })).toBeNull()
  })
})

describe('buildMarketplaceLedger', () => {
  it('interleaves direct + negotiated rows time-desc with derived fee/net and flags reversals', () => {
    const orders = [
      order({ amount_cents: 10000, currency: 'usd', offer_name: 'Kit', created_at: '2026-06-12T00:00:00Z', id: 'd1' }),
      order({ amount_cents: 9999, currency: 'usd', stripe_livemode: false, id: 'd2' }),
    ]
    const negs = [
      neg({ id: 'n1', status: 'complete', amount_cents: 4000, currency: 'usd', created_at: '2026-06-13T00:00:00Z', offer_name: 'Deal', buyer_agent: 'Claude' }),
      neg({ id: 'n2', status: 'refunded', amount_cents: 2000, currency: 'usd', created_at: '2026-06-11T00:00:00Z', buyer_agent: null }),
      neg({ id: 'n3', status: 'negotiation', amount_cents: 5000, currency: 'usd' }), // not a money event → excluded
    ]
    const ledger = buildMarketplaceLedger(orders, negs, 10) // 10% commission
    expect(ledger.map((e) => e.id)).toEqual(['neg-n1', 'd1', 'neg-n2']) // time desc
    const direct = ledger.find((e) => e.id === 'd1')!
    expect(direct.channel).toBe('direct')
    expect(direct.feeCents).toBe(1000)
    expect(direct.netCents).toBe(9000)
    const reversal = ledger.find((e) => e.id === 'neg-n2')!
    expect(reversal.isReversal).toBe(true)
    expect(reversal.channel).toBe('negotiated')
    expect(reversal.buyerLabel).toBe('Agent') // fallback when buyer_agent unset
    expect(reversal.feeCents).toBe(0) // full refund - no fee reduction
    expect(reversal.netCents).toBe(2000) // whole amount is the outflow
  })

  it('keeps amount/fee/net consistent in the smallest unit for zero-decimal currencies', () => {
    // ¥1,000 deal (amount_cents 100000, major×100) with a ¥60 Stripe fee snapshot (60,
    // smallest unit). Amount must convert to 1000 so it lines up with the snapshot fee.
    const negs = [
      { ...neg({ id: 'jn1', status: 'complete', amount_cents: 100000, currency: 'jpy' }), application_fee_cents: 60 } as NegotiationFinanceRow,
    ]
    const [row] = buildMarketplaceLedger([], negs, 6)
    expect(row.currency).toBe('jpy')
    expect(row.amountCents).toBe(1000) // ¥1,000 smallest unit, not 100000
    expect(row.feeCents).toBe(60) // snapshot fee, already smallest unit
    expect(row.netCents).toBe(940) // 1000 − 60, both smallest unit
  })

  it('records a partial negotiated refund as its actual outflow and retained proportional fee', () => {
    const [row] = buildMarketplaceLedger([], [
      neg({
        id: 'partial',
        status: 'refunded',
        amount_cents: 10000,
        refunded_cents: 2500,
        application_fee_cents: 1000,
        updated_at: '2026-06-14T00:00:00Z',
      }),
    ], 15)
    expect(row.amountCents).toBe(10000)
    expect(row.feeCents).toBe(750)
    expect(row.netCents).toBe(2500)
    expect(row.isReversal).toBe(true)
    expect(row.status).toBe('partial_refund')
    expect(row.timestamp).toBe('2026-06-14T00:00:00Z')
  })

  it('respects the limit (most recent first)', () => {
    const orders = Array.from({ length: 30 }, (_, i) =>
      order({ amount_cents: 100, currency: 'usd', id: `e${i}`, created_at: `2026-06-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z` }),
    )
    expect(buildMarketplaceLedger(orders, [], 10, 25)).toHaveLength(25)
  })
})

describe('getDailyRevenueSeries + getCurrencyOptions', () => {
  it('produces a dated GMV series with the requested number of points', () => {
    const series = getDailyRevenueSeries([order({ amount_cents: 5000, currency: 'usd' })], 7)
    expect(series).toHaveLength(7)
    expect(series[series.length - 1].revenueCents).toBe(5000) // today's bucket
  })

  it('lists currencies dominant-first', () => {
    const orders = [order({ amount_cents: 1000, currency: 'usd' }), order({ amount_cents: 9000, currency: 'gbp' })]
    expect(getCurrencyOptions(orders)).toEqual(['gbp', 'usd'])
  })
})

import { describe, expect, it, vi } from 'vitest'
import { loadFinanceRollup, parseFinanceRollup } from '../finance-report'

const payload = {
  schemaVersion: 1,
  currencies: [{ currency: 'USD', transactions: 3, grossCents: 10000, retainedGrossCents: 7000, refundCents: 2000, disputeCents: 1000, outflowCents: 3000, feeCents: 700, netCents: 6300, aovCents: 3333, partialRefunds: 1, snapshotTransactions: 2, estimatedTransactions: 1 }],
  channels: [{ currency: 'usd', channel: 'agent_protocol', transactions: 2, grossCents: 7000, netCents: 6200 }],
  daily: [{ currency: 'usd', date: '2026-08-21', transactions: 1, grossCents: 1000, outflowCents: 0, netCents: 900 }],
  topOffers: [{ currency: 'usd', pageId: null, slug: 'demo', offerKey: 'services-0', offerName: 'Consult', transactions: 1, grossCents: 1000, netCents: 900 }],
  escrow: [{ currency: 'usd', deals: 2, fundedCents: 5000, heldCents: 1000, capturedCents: 4000, refundCents: 500, disputeCents: 0, outflowCents: 500, feeCents: 350, netCents: 3150, partialRefunds: 1, snapshotDeals: 2, estimatedDeals: 0 }],
  negotiatedWindow: [{ currency: 'usd', deals: 1, fundedCents: 4000, heldCents: 0, capturedCents: 4000, outflowCents: 500, netCents: 3150 }],
  operations: { openRequests: 2, disputedOrders: 1, disputedNegotiations: 0, heldNegotiations: 1, staleHeldNegotiations: 1, estimatedEconomics: 1 },
}

describe('parseFinanceRollup', () => {
  it('normalizes the complete finance contract', () => {
    const report = parseFinanceRollup(payload)
    expect(report?.currencies[0]).toMatchObject({ currency: 'usd', grossCents: 10000, outflowCents: 3000, netCents: 6300 })
    expect(report?.escrow[0]).toMatchObject({ partialRefunds: 1, refundedCents: 500 })
    expect(report?.operations).toEqual(payload.operations)
  })

  it('fails closed on an unsupported contract version', () => {
    expect(parseFinanceRollup({ ...payload, schemaVersion: 2 })).toBeNull()
  })

  it('coerces invalid numeric values to safe non-negative integers', () => {
    const report = parseFinanceRollup({ ...payload, currencies: [{ currency: '', grossCents: -5, transactions: '2.4' }] })
    expect(report?.currencies[0]).toMatchObject({ currency: 'usd', grossCents: 0, transactions: 2 })
  })
})

describe('loadFinanceRollup', () => {
  it('bounds the fallback rate and sends explicit nullable range arguments', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: payload, error: null })
    const result = await loadFinanceRollup({ rpc }, { fallbackCommissionBps: 5000 })
    expect(result.data?.schemaVersion).toBe(1)
    expect(rpc).toHaveBeenCalledWith('nz_owner_finance_rollup', {
      p_from: null,
      p_to: null,
      p_fallback_commission_bps: 1000,
    })
  })

  it('preserves database errors', async () => {
    const error = new Error('missing migration')
    await expect(loadFinanceRollup({ rpc: vi.fn().mockResolvedValue({ data: null, error }) })).resolves.toEqual({ data: null, error })
  })
})

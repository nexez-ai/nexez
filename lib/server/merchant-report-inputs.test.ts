import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getReadinessCriteria, getReadinessScore, type AgentPage } from '@/lib/agent-page'
import { organizationReportSchema } from '@/lib/organization-reports'
import { readMerchantReportInputs } from './merchant-report-inputs'

const ownerId = '9a000000-0000-4000-8000-000000000001'
const listingId = '9b000000-0000-4000-8000-000000000001'
const month = '2026-08'
const coverage = { state: 'complete', from: '2026-08-01T00:00:00+00:00', toExclusive: '2026-09-01T00:00:00+00:00' }
function fixture() {
  return {
    ownerId, listingId, month, observedAt: '2026-09-11T04:00:00+00:00',
    listing: { state: 'available', name: 'Merchant', description: 'Useful description', isPublished: false,
      standardVersion: '2026.1', readinessSignals: [true, true, true, false, false, false, false, false, false, false, false] },
    traffic: { state: 'available', evidenceId: '9c000000-0000-4000-8000-000000000001', evidenceSha256: `sha256:${'a'.repeat(64)}`, coverage,
      value: { totalVisits: 6, detectedAiVisits: 2, verifiedServerVisits: 3, unverifiedClientVisits: 2, legacyUnverifiedVisits: 1 } },
    orders: { state: 'available', evidenceId: '9c000000-0000-4000-8000-000000000002', evidenceSha256: `sha256:${'b'.repeat(64)}`, coverage,
      value: { eligibleLiveOrders: 4, byPaymentStatus: { paid: 1, refunded: 1, disputed: 1, dispute_won: 1 },
        excludedTestOrders: 1, excludedUnknownModeOrders: 2, excludedUnsupportedStatusOrders: 3 } },
  }
}
let raw = fixture()
const abortSignal = vi.fn()
const rpc = vi.fn(() => ({ abortSignal }))
const client = { rpc } as unknown as SupabaseClient
const read = () => readMerchantReportInputs(client, ownerId, { listingId, month })
beforeEach(() => {
  vi.clearAllMocks()
  raw = fixture()
  abortSignal.mockImplementation(async () => ({ data: raw, error: null }))
})

describe('owner report input boundary', () => {
  it('reads one session RPC without passing an owner, org or coverage claim', async () => {
    const report = await read()
    expect(rpc).toHaveBeenCalledExactlyOnceWith('read_merchant_report_inputs', { p_listing_id: listingId, p_month: '2026-08-01' })
    expect(abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal))
    expect(report.dataBasis).toBe('merchant_sources')
    expect(report.traffic).toMatchObject({ state: 'available', value: raw.traffic.value })
    expect(report.orders).toMatchObject({ state: 'available', value: raw.orders.value })
    expect(report.website).toEqual({ state: 'not_collected' })
    expect(report.financialSummary).toEqual({ state: 'no_permission', reason: 'financial_disclosure_not_enabled' })
    expect(report.attribution).toEqual({ state: 'no_coverage', reason: 'attribution_not_implemented' })
    expect(JSON.stringify(report)).not.toMatch(/evidenceId|evidenceSha256|readinessSignals|buyer_email|amount_cents|products|draft_content/)
    expect(organizationReportSchema.safeParse(report).success).toBe(true)
  })

  it('derives stable digests from scope, definitions, coverage evidence and values', async () => {
    const first = await read()
    raw.observedAt = '2026-09-12T04:00:00+00:00'
    expect((await read()).traffic).toMatchObject({ sourceVersion: first.traffic.state === 'available' && first.traffic.sourceVersion })
    raw.traffic.evidenceSha256 = `sha256:${'c'.repeat(64)}`
    expect((await read()).traffic).not.toEqual(expect.objectContaining({ sourceVersion: first.traffic.state === 'available' && first.traffic.sourceVersion }))
    const before = await read()
    raw.orders.value.byPaymentStatus.paid = 0
    raw.orders.value.byPaymentStatus.refunded = 2
    expect((await read()).orders).not.toEqual(expect.objectContaining({ sourceVersion: before.orders.state === 'available' && before.orders.sourceVersion }))
  })

  it('preserves measured zero and distinguishes missing coverage or capped calculations', async () => {
    Object.keys(raw.traffic.value).forEach(key => { raw.traffic.value[key as keyof typeof raw.traffic.value] = 0 })
    expect((await read()).traffic).toMatchObject({ state: 'available', value: { totalVisits: 0 } })
    for (const state of ['no_coverage', 'calculation_failed']) {
      abortSignal.mockResolvedValue({ data: { ...raw, traffic: { state }, orders: { state }, listing: { state: 'calculation_failed' } }, error: null })
      const report = await read()
      expect(report.traffic).toEqual({ state })
      expect(report.orders).toEqual({ state })
      expect(report.listing).toEqual({ state: 'calculation_failed' })
    }
  })

  it('retains a truthful partial interval without expanding it to a whole month', async () => {
    raw.traffic.coverage = { ...coverage, state: 'partial', from: '2026-08-12T00:00:00+00:00' }
    expect((await read()).traffic).toMatchObject({ coverage: { state: 'partial', from: '2026-08-12T00:00:00.000Z' } })
  })

  it('matches canonical readiness for all 2,048 combinations', async () => {
    for (let mask = 0; mask < 2 ** 11; mask++) {
      const met = (bit: number) => Boolean(mask & (1 << bit))
      const page: Partial<AgentPage> = {
        name: met(0) ? 'Merchant' : '', slug: met(1) ? 'merchant' : '', description: met(2) ? 'Description' : '',
        website_url: met(3) ? 'https://example.com' : '', cta_url: met(4) ? 'https://example.com/book' : '',
        audience: met(5) ? 'Buyers' : '', industry: met(6) ? 'Services' : '', location: met(7) ? 'Chicago' : '',
        products: met(8) ? [{ name: 'Private offer', description: '', price: '', url: '' }] : [], faqs: met(9) ? [{ question: 'Q', answer: 'A' }] : [], is_published: met(10),
      }
      raw.listing = { ...raw.listing, name: page.name!, description: page.description!, isPublished: met(10),
        readinessSignals: Array.from({ length: 11 }, (_, index) => met(index)) }
      const result = await read()
      expect(result.listing).toMatchObject({ value: { readiness: { score: getReadinessScore(page),
        criteria: getReadinessCriteria(page).map(({ id, met }) => ({ id, met })) } } })
    }
  })

  it.each([
    { listingId: 'invalid', month }, { listingId, month: '2026-13' }, { listingId, month: '2026-08-01' },
    { listingId, month, ownerId }, { listingId, month, coverage },
  ])('rejects extra or malformed query inputs before SQL', async query => {
    await expect(readMerchantReportInputs(client, ownerId, query)).rejects.toMatchObject({ status: 400 })
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each([
    ['ownerId', '9a000000-0000-4000-8000-000000000002'],
    ['listingId', '9b000000-0000-4000-8000-000000000002'], ['month', '2026-07'],
    ['observedAt', 'invalid'], ['observedAt', '2026-08-31T23:59:59Z'], ['observedAt', '2027-10-01T00:00:00Z'],
  ])('refuses mismatched database context %s', async (key, value) => {
    abortSignal.mockResolvedValue({ data: { ...raw, [key]: value }, error: null })
    await expect(read()).rejects.toMatchObject({ status: 503 })
  })

  it.each([
    (value: ReturnType<typeof fixture>) => ({ ...value, amount_cents: 100 }),
    (value: ReturnType<typeof fixture>) => ({ ...value, listing: { ...value.listing, products: [{ price: 123 }] } }),
    (value: ReturnType<typeof fixture>) => ({ ...value, listing: { ...value.listing, draft: { description: 'Private staged text' } } }),
    (value: ReturnType<typeof fixture>) => ({ ...value, traffic: { state: 'no_coverage', value: value.traffic.value } }),
    (value: ReturnType<typeof fixture>) => ({ ...value, orders: { ...value.orders, value: { ...value.orders.value, orderIds: ['private'] } } }),
    (value: ReturnType<typeof fixture>) => ({ ...value, listing: { ...value.listing, readinessSignals: [true] } }),
    (value: ReturnType<typeof fixture>) => ({ ...value, listing: { ...value.listing, isPublished: true } }),
    (value: ReturnType<typeof fixture>) => ({ ...value, listing: { ...value.listing, standardVersion: '2027.1' } }),
    (value: ReturnType<typeof fixture>) => ({ ...value, traffic: { ...value.traffic, coverage: { ...coverage, from: '2026-08-02T00:00:00Z' } } }),
    (value: ReturnType<typeof fixture>) => ({ ...value, traffic: { ...value.traffic, evidenceSha256: 'client-assertion' } }),
    (value: ReturnType<typeof fixture>) => ({ ...value, traffic: { ...value.traffic, value: { ...value.traffic.value, detectedAiVisits: 7 } } }),
    (value: ReturnType<typeof fixture>) => ({ ...value, traffic: { ...value.traffic, value: { ...value.traffic.value, totalVisits: 5 } } }),
    (value: ReturnType<typeof fixture>) => ({ ...value, traffic: { ...value.traffic, value: { ...value.traffic.value, totalVisits: 100001 } } }),
    (value: ReturnType<typeof fixture>) => ({ ...value, orders: { ...value.orders, value: { ...value.orders.value, eligibleLiveOrders: 5 } } }),
    (value: ReturnType<typeof fixture>) => ({ ...value, orders: { ...value.orders, value: { ...value.orders.value, excludedTestOrders: -1 } } }),
    (value: ReturnType<typeof fixture>) => ({ ...value, orders: { ...value.orders, value: { ...value.orders.value, excludedTestOrders: 100000 } } }),
  ])('fails closed on invalid, non-reconciling or private source output', async mutate => {
    abortSignal.mockResolvedValue({ data: mutate(raw), error: null })
    await expect(read()).rejects.toMatchObject({ status: 503, message: 'Report inputs are temporarily unavailable.' })
  })

  it('rechecks after a successful read and respects subsequent ownership denial', async () => {
    await read()
    abortSignal.mockResolvedValue({ data: null, error: null })
    await expect(read()).rejects.toMatchObject({ status: 404, message: 'Listing not found.' })
    expect(rpc).toHaveBeenCalledTimes(2)
  })

  it('maps only the recognized period error and redacts every other SQL failure', async () => {
    abortSignal.mockResolvedValue({ data: null, error: { code: 'PT400', message: 'invalid_report_month' } })
    await expect(read()).rejects.toMatchObject({ status: 400 })
    for (const code of ['PT400', 'PT503', '42501', '57014']) {
      abortSignal.mockResolvedValue({ data: null, error: { code, message: 'private row and secret details' } })
      await expect(read()).rejects.toMatchObject({ status: 503, message: 'Report inputs are temporarily unavailable.' })
    }
    abortSignal.mockRejectedValue(new Error('secret transport detail'))
    await expect(read()).rejects.toMatchObject({ status: 503, message: 'Report inputs are temporarily unavailable.' })
  })
})

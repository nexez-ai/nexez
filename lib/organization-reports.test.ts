import { describe, expect, it } from 'vitest'
import { getReadinessCriteria, getReadinessScore, type AgentPage } from './agent-page'
import { organizationReportSchema, projectReportListing, REPORT_MISSING_STATES, reportPriorityAction } from './organization-reports'
import { representativeOrganizationReport, sparseOrganizationReport, zeroActivityOrganizationReport } from './organization-report-examples'

const observedAt = '2026-09-01T12:00:00.000Z'
const version = `sha256:${'a'.repeat(64)}`
const example = () => structuredClone(representativeOrganizationReport)

describe('organization report contract', () => {
  it('accepts the illustrative, sparse and true-zero reports', () => {
    for (const report of [representativeOrganizationReport, sparseOrganizationReport, zeroActivityOrganizationReport]) {
      expect(organizationReportSchema.safeParse(report).success).toBe(true)
      expect(report.dataBasis).toBe('synthetic_example')
    }
    expect(zeroActivityOrganizationReport.traffic).toMatchObject({ state: 'available', value: { totalVisits: 0 } })
    expect(sparseOrganizationReport.traffic).toEqual({ state: 'not_collected' })
  })

  it.each(REPORT_MISSING_STATES)('keeps %s distinct and forbids hidden values in it', state => {
    const report = { ...example(), traffic: { state } }
    expect(organizationReportSchema.parse(report).traffic).toEqual({ state })
    expect(organizationReportSchema.safeParse({ ...report, traffic: { state, value: { totalVisits: 7 } } }).success).toBe(false)
    expect(organizationReportSchema.safeParse({ ...report, traffic: { state, error: 'private source error' } }).success).toBe(false)
  })

  it.each(['draft', 'agent_memory', 'credentials', 'integration_config', 'buyer_email', 'order_ids', 'referrers', 'search_terms', 'commission', 'payouts'])('rejects a broad owner-rollup field: %s', key => {
    expect(organizationReportSchema.safeParse({ ...example(), [key]: 'must not escape' }).success).toBe(false)
  })

  it.each(['draft', 'agent_memory', 'services', 'products', 'verification_token'])('rejects private or unnecessary listing content: %s', key => {
    const report = example()
    if (report.listing.state !== 'available') throw new Error('Missing listing fixture')
    const listing = { ...report.listing, value: { ...report.listing.value, [key]: 'private value' } }
    expect(organizationReportSchema.safeParse({ ...report, listing }).success).toBe(false)
  })

  it.each(['grossAmountMinor', 'refundedCents', 'netCents', 'currency', 'orderIds', 'buyerEmail'])('rejects money or individual-order fields in counts: %s', key => {
    const report = example()
    if (report.orders.state !== 'available') throw new Error('Missing orders fixture')
    const orders = { ...report.orders, value: { ...report.orders.value, [key]: 1000 } }
    expect(organizationReportSchema.safeParse({ ...report, orders }).success).toBe(false)
  })

  it('cannot turn on financial disclosure or attribution through a report payload', () => {
    expect(organizationReportSchema.safeParse({ ...example(), financialSummary: { state: 'available', grossAmountMinor: 1000 } }).success).toBe(false)
    expect(organizationReportSchema.safeParse({ ...example(), financialSummary: { state: 'no_permission', reason: 'financial_disclosure_not_enabled', amount: 1000 } }).success).toBe(false)
    expect(organizationReportSchema.safeParse({ ...example(), attribution: { state: 'available', attributedOrders: 1 } }).success).toBe(false)
  })

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 1_000_000_001, '12'])('rejects invalid aggregate counts: %s', totalVisits => {
    const report = example()
    if (report.traffic.state !== 'available') throw new Error('Missing traffic fixture')
    expect(organizationReportSchema.safeParse({ ...report, traffic: { ...report.traffic, value: { ...report.traffic.value, totalVisits } } }).success).toBe(false)
  })

  it('rejects non-reconciling traffic, trust and order-status totals', () => {
    const report = example()
    if (report.traffic.state !== 'available' || report.orders.state !== 'available') throw new Error('Missing fixture')
    for (const value of [{ ...report.traffic.value, detectedAiVisits: 125 }, { ...report.traffic.value, verifiedServerVisits: 91 }]) {
      expect(organizationReportSchema.safeParse({ ...report, traffic: { ...report.traffic, value } }).success).toBe(false)
    }
    expect(organizationReportSchema.safeParse({ ...report, orders: { ...report.orders, value: { ...report.orders.value, eligibleLiveOrders: 9 } } }).success).toBe(false)
    expect(organizationReportSchema.safeParse({ ...report, orders: { ...report.orders, value: { ...report.orders.value, byPaymentStatus: { paid: 8, fulfilled: 0 } } } }).success).toBe(false)
  })

  it.each([
    { from: '2026-08-02T00:00:00.000Z', toExclusive: '2026-09-01T00:00:00.000Z', timezone: 'UTC' },
    { from: '2026-08-01T00:00:00.000Z', toExclusive: '2026-10-01T00:00:00.000Z', timezone: 'UTC' },
    { from: '2026-08-01T00:00:00.000Z', toExclusive: '2026-09-01T00:00:00.000Z', timezone: 'America/Chicago' },
    { from: '2026-09-01T00:00:00.000Z', toExclusive: '2026-10-01T00:00:00.000Z', timezone: 'UTC' },
    { from: '2026-08-01T00:00:00-05:00', toExclusive: '2026-09-01T00:00:00-05:00', timezone: 'UTC' },
  ])('rejects noncanonical or unfinished reporting periods: %j', period => {
    expect(organizationReportSchema.safeParse({ ...example(), period }).success).toBe(false)
  })

  it('validates February and year boundaries without local timezone arithmetic', () => {
    for (const [from, toExclusive] of [['2024-02-01T00:00:00.000Z', '2024-03-01T00:00:00.000Z'], ['2025-12-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z']]) {
      expect(organizationReportSchema.safeParse({ ...sparseOrganizationReport, period: { from, toExclusive, timezone: 'UTC' } }).success).toBe(true)
    }
  })

  it('rejects malformed timestamps without throwing from calendar validation', () => {
    const report = example()
    if (report.traffic.state !== 'available') throw new Error('Missing traffic fixture')
    for (const value of ['', 'not-a-date', '2026-02-30T00:00:00.000Z', '999999-01-01T00:00:00.000Z', '+275760-09-13T00:00:00.000Z', null]) {
      for (const input of [
        { ...report, generatedAt: value },
        { ...report, period: { ...report.period, from: value } },
        { ...report, period: { ...report.period, toExclusive: value } },
        { ...report, traffic: { ...report.traffic, observedAt: value } },
        { ...report, traffic: { ...report.traffic, coverage: { ...report.traffic.coverage, from: value } } },
        { ...report, traffic: { ...report.traffic, coverage: { ...report.traffic.coverage, toExclusive: value } } },
      ]) expect(organizationReportSchema.safeParse(input).success).toBe(false)
    }
  })

  it('labels partial collection and rejects false completeness, overreach and future observations', () => {
    const report = example()
    if (report.traffic.state !== 'available') throw new Error('Missing traffic fixture')
    const traffic = { ...report.traffic, coverage: { ...report.traffic.coverage, state: 'partial', from: '2026-08-12T00:00:00.000Z' } }
    expect(organizationReportSchema.safeParse({ ...report, traffic }).success).toBe(true)
    for (const coverage of [
      { ...traffic.coverage, state: 'complete' },
      { ...traffic.coverage, from: '2026-07-01T00:00:00.000Z' },
      { ...traffic.coverage, toExclusive: '2026-10-01T00:00:00.000Z' },
      { ...traffic.coverage, from: traffic.coverage.toExclusive },
    ]) expect(organizationReportSchema.safeParse({ ...report, traffic: { ...traffic, coverage } }).success).toBe(false)
    for (const stamp of ['2026-08-15T00:00:00.000Z', '2026-09-02T00:00:00.000Z']) {
      expect(organizationReportSchema.safeParse({ ...report, traffic: { ...traffic, observedAt: stamp } }).success).toBe(false)
    }
  })

  it('rejects prospect provenance, arbitrary scanner content and unsafe origins', () => {
    const report = example()
    if (report.website.state !== 'available') throw new Error('Missing website fixture')
    for (const extra of [
      { provenance: 'organization_prospect_scan' }, { html: '<script>private</script>' },
      { origin: 'https://example.com/private?token=secret' }, { origin: 'http://127.0.0.1' },
      { origin: 'https://user:password@example.com' },
      { result: { ...report.website.value.result, version: 1 } },
    ]) {
      expect(organizationReportSchema.safeParse({ ...report, website: { ...report.website, value: { ...report.website.value, ...extra } } }).success).toBe(false)
    }
    expect(organizationReportSchema.safeParse({ ...report, website: { state: 'calculation_failed', value: { score: 0 } } }).success).toBe(false)
  })

  it('rejects contradictory readiness scores, duplicate criteria and publication status', () => {
    const report = example()
    if (report.listing.state !== 'available') throw new Error('Missing listing fixture')
    const value = report.listing.value
    for (const changed of [
      { ...value, isPublished: false },
      { ...value, name: '' },
      { ...value, description: null },
      { ...value, readiness: { ...value.readiness, score: 100 } },
      { ...value, readiness: { ...value.readiness, criteria: value.readiness.criteria.map(() => value.readiness.criteria[0]) } },
    ]) expect(organizationReportSchema.safeParse({ ...report, listing: { ...report.listing, value: changed } }).success).toBe(false)
  })

  it('produces canonical listing readiness for all 2,048 criterion combinations', () => {
    for (let mask = 0; mask < 2 ** 11; mask += 1) {
      const has = (bit: number) => Boolean(mask & (1 << bit))
      const page: Partial<AgentPage> = {
        name: has(0) ? 'Name' : '', slug: has(1) ? 'name' : '', description: has(2) ? 'Description' : null,
        website_url: has(3) ? 'https://example.com' : '', cta_url: has(4) ? 'https://example.com/contact' : '',
        audience: has(5) ? 'Buyer' : null, industry: has(6) ? 'Repair' : null, location: has(7) ? 'Local' : null,
        services: has(8) ? [{ name: 'Service', description: '', price: '', url: '' }] : [],
        faqs: has(9) ? [{ question: 'Question?', answer: 'Answer.' }] : [], is_published: has(10),
      }
      const projection = projectReportListing(page, observedAt, version)
      if (projection.state !== 'available') throw new Error('Missing projection')
      expect(projection.value.readiness.score).toBe(getReadinessScore(page))
      expect(projection.value.readiness.criteria).toEqual(getReadinessCriteria(page).map(({ id, met }) => ({ id, met })))
    }
  })

  it('does not serialize private page fields or offer configuration', () => {
    const projection = projectReportListing({
      name: 'Merchant', description: 'Approved public description', is_published: true,
      agent_memory: { notes: 'private-memory-marker' }, draft: { description: 'private-draft-marker' },
      google_calendar_id: 'private-integration-marker',
      services: [{ name: 'Public offer', description: '', price: '', url: '', rules: { minPrice: 'private-price-marker' } }],
    }, observedAt, version)
    const serialized = JSON.stringify(projection)
    expect(serialized).not.toContain('private-')
    expect(serialized).not.toContain('Public offer')
    expect(serialized).toContain('Approved public description')
  })

  it('chooses one concrete action from available evidence', () => {
    expect(reportPriorityAction(example()).code).toBe('listing_faqs')
    expect(reportPriorityAction({ ...sparseOrganizationReport, listing: { state: 'no_permission' } }).code).toBe('website_baseline')
    const report = example()
    report.listing = projectReportListing({ name: 'Merchant', faqs: [{ question: 'Q', answer: 'A' }] }, observedAt, version)
    expect(reportPriorityAction(report).code).toBe('listing_description')
  })
})

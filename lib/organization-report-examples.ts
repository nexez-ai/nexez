// Deliberately synthetic fixtures for Stage 0 review. No merchant, source query,
// website fetch, payment, or permission grant is represented by these examples.
import { SCAN_CHECK_COPY } from './organization-scans'
import { organizationReportSchema, projectReportListing, type OrganizationReport } from './organization-reports'

const observedAt = '2026-09-01T12:00:00.000Z'
const version = `sha256:${'1'.repeat(64)}`
const period = { from: '2026-08-01T00:00:00.000Z', toExclusive: '2026-09-01T00:00:00.000Z', timezone: 'UTC' as const }
const coverage = { state: 'complete' as const, from: period.from, toExclusive: period.toExclusive }

export const representativeOrganizationReport = organizationReportSchema.parse({
  schemaVersion: 1, dataBasis: 'synthetic_example', generatedAt: observedAt,
  scope: { ownerId: '11111111-1111-4111-8111-111111111111', listingId: '22222222-2222-4222-8222-222222222222', merchantName: 'Harbor Repair Studio (example)' },
  period,
  listing: projectReportListing({
    name: 'Harbor Repair Studio', slug: 'harbor-repair-example',
    description: 'Furniture restoration and repairs, with clear estimates before work begins.',
    website_url: 'https://example.com', cta_url: 'https://example.com/contact', industry: 'Furniture repair',
    location: 'Example service area', products: [], services: [{ name: 'Furniture repair', description: '', price: '', url: '' }],
    faqs: [], is_published: true,
  }, observedAt, version),
  website: {
    state: 'available', observedAt, sourceVersion: version,
    value: {
      provenance: 'merchant_website_snapshot', snapshotId: '33333333-3333-4333-8333-333333333333',
      associationId: '44444444-4444-4444-8444-444444444444', origin: 'https://example.com',
      associationMethod: 'merchant_approved', scannerVersion: 'public-scanner-v1',
      rubricId: 'nexez.website-agent-readiness',
      result: { version: 2, score: 61, checks: Object.keys(SCAN_CHECK_COPY).map((id, index) => ({ id, status: index < 11 ? 'pass' : 'warn' })) },
    },
  },
  traffic: { state: 'available', observedAt, sourceVersion: version, coverage,
    value: { totalVisits: 124, detectedAiVisits: 32, verifiedServerVisits: 90, unverifiedClientVisits: 20, legacyUnverifiedVisits: 14 } },
  orders: { state: 'available', observedAt, sourceVersion: version, coverage,
    value: { eligibleLiveOrders: 8, byPaymentStatus: { paid: 5, refunded: 1, disputed: 1, dispute_won: 1 }, excludedTestOrders: 2, excludedUnknownModeOrders: 1, excludedUnsupportedStatusOrders: 0 } },
  financialSummary: { state: 'no_permission', reason: 'financial_disclosure_not_enabled' },
  attribution: { state: 'no_coverage', reason: 'attribution_not_implemented' },
})

export const sparseOrganizationReport: OrganizationReport = organizationReportSchema.parse({
  ...representativeOrganizationReport,
  website: { state: 'calculation_failed' }, traffic: { state: 'not_collected' }, orders: { state: 'no_permission' },
})

export const zeroActivityOrganizationReport: OrganizationReport = organizationReportSchema.parse({
  ...representativeOrganizationReport,
  traffic: { state: 'available', observedAt, sourceVersion: version, coverage,
    value: { totalVisits: 0, detectedAiVisits: 0, verifiedServerVisits: 0, unverifiedClientVisits: 0, legacyUnverifiedVisits: 0 } },
  orders: { state: 'available', observedAt, sourceVersion: version, coverage,
    value: { eligibleLiveOrders: 0, byPaymentStatus: { paid: 0, refunded: 0, disputed: 0, dispute_won: 0 }, excludedTestOrders: 0, excludedUnknownModeOrders: 0, excludedUnsupportedStatusOrders: 0 } },
})

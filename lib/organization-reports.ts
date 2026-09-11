// Report data contract only. Parsing does not authorize a reader or establish
// source provenance. Future producers must check current consent before reading
// sources, constructing this projection, or returning it to an organization.
import { z } from 'zod'
import { AGENT_READY_STANDARD, getReadinessCriteria, getReadinessScore, type AgentPage } from './agent-page'
import { normalizeOrganizationScanOrigin, scanResultSchema } from './organization-scans'

export const ORGANIZATION_REPORT_VERSION = 1
export const REPORT_MISSING_STATES = ['no_permission', 'no_coverage', 'suppressed', 'not_collected', 'calculation_failed'] as const
export type ReportMissingState = typeof REPORT_MISSING_STATES[number]

export const REPORT_MISSING_COPY: Record<ReportMissingState, { label: string; detail: string }> = {
  no_permission: { label: 'Not shared', detail: 'The current report does not have permission for this source.' },
  no_coverage: { label: 'No source coverage', detail: 'The available source does not cover this metric.' },
  suppressed: { label: 'Withheld', detail: 'The disclosure policy withholds this result.' },
  not_collected: { label: 'Collection not started', detail: 'No collection baseline is available yet.' },
  calculation_failed: { label: 'Calculation unavailable', detail: 'This result could not be calculated. It is not a zero.' },
}

export const REPORT_METRIC_DEFINITIONS = {
  listing: { source: 'pages', scope: 'selected_listing', period: 'current', unit: 'percent_and_criteria', privacy: 'approved_listing_projection', version: AGENT_READY_STANDARD.version },
  website: { source: 'merchant_website_snapshot', scope: 'approved_website_association', period: 'observation', unit: 'percent_and_checks', privacy: 'merchant_website_history', version: 'website-rubric-2' },
  traffic: { source: 'agent_visits', scope: 'selected_listing', period: 'calendar_month', unit: 'recorded_visits', privacy: 'traffic_aggregate', version: 'recorded-traffic-v1' },
  orders: { source: 'checkout_orders', scope: 'owner_account', period: 'created_in_calendar_month', unit: 'orders', privacy: 'order_count_aggregate', version: 'live-order-counts-v1' },
} as const

const timestamp = z.iso.datetime({ offset: false }).refine(value => Number.isFinite(Date.parse(value)))
const sourceVersion = z.string().regex(/^sha256:[a-f0-9]{64}$/)
const count = z.number().int().min(0).max(1_000_000_000)
const missing = z.object({ state: z.enum(REPORT_MISSING_STATES) }).strict()
const observation = { observedAt: timestamp, sourceVersion }
const readinessIds = ['name', 'slug', 'description', 'website_url', 'cta_url', 'audience', 'industry', 'location_or_contact', 'offers', 'faqs', 'publish'] as const

const readinessSchema = z.object({
  standardId: z.literal(AGENT_READY_STANDARD.id), standardVersion: z.literal(AGENT_READY_STANDARD.version),
  score: z.number().int().min(0).max(100),
  criteria: z.array(z.object({ id: z.enum(readinessIds), met: z.boolean() }).strict()).length(readinessIds.length),
}).strict().superRefine((value, ctx) => {
  if (value.criteria.some((criterion, index) => criterion.id !== readinessIds[index])) {
    ctx.addIssue({ code: 'custom', message: 'Readiness criteria must match the canonical standard.' })
  }
  if (value.score !== Math.round(value.criteria.filter(item => item.met).length / readinessIds.length * 100)) {
    ctx.addIssue({ code: 'custom', message: 'Readiness score does not reconcile with its criteria.' })
  }
})

const listingMetric = z.union([
  missing,
  z.object({
    state: z.literal('available'), ...observation,
    value: z.object({
      name: z.string().max(500), description: z.string().max(20_000).nullable(),
      isPublished: z.boolean(), readiness: readinessSchema,
    }).strict(),
  }).strict().refine(metric => {
    const criteria = metric.value.readiness.criteria
    return metric.value.isPublished === criteria.find(item => item.id === 'publish')?.met
      && Boolean(metric.value.name) === criteria.find(item => item.id === 'name')?.met
      && Boolean(metric.value.description) === criteria.find(item => item.id === 'description')?.met
  }, 'Visible listing values must match their readiness criteria.'),
])

const websiteMetric = z.union([
  missing,
  z.object({
    state: z.literal('available'), ...observation,
    value: z.object({
      provenance: z.literal('merchant_website_snapshot'), snapshotId: z.uuid(), associationId: z.uuid(),
      origin: z.string().max(263).refine(value => normalizeOrganizationScanOrigin(value) === value),
      associationMethod: z.enum(['merchant_approved', 'domain_verified']),
      scannerVersion: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/),
      rubricId: z.literal('nexez.website-agent-readiness'), result: scanResultSchema,
    }).strict(),
  }).strict(),
])

const collectionCoverage = z.object({
  state: z.enum(['complete', 'partial']), from: timestamp, toExclusive: timestamp,
}).strict()

const trafficMetric = z.union([
  missing,
  z.object({
    state: z.literal('available'), ...observation, coverage: collectionCoverage,
    value: z.object({
      totalVisits: count, detectedAiVisits: count,
      verifiedServerVisits: count, unverifiedClientVisits: count, legacyUnverifiedVisits: count,
    }).strict().refine(value => value.detectedAiVisits <= value.totalVisits
      && value.verifiedServerVisits + value.unverifiedClientVisits + value.legacyUnverifiedVisits === value.totalVisits,
    'Traffic counts do not reconcile.'),
  }).strict(),
])

const ordersMetric = z.union([
  missing,
  z.object({
    state: z.literal('available'), ...observation, coverage: collectionCoverage,
    value: z.object({
      eligibleLiveOrders: count,
      byPaymentStatus: z.object({ paid: count, refunded: count, disputed: count, dispute_won: count }).strict(),
      excludedTestOrders: count, excludedUnknownModeOrders: count, excludedUnsupportedStatusOrders: count,
    }).strict().refine(value => Object.values(value.byPaymentStatus).reduce((sum, amount) => sum + amount, 0) === value.eligibleLiveOrders,
    'Order status counts do not reconcile.'),
  }).strict(),
])

export const organizationReportSchema = z.object({
  schemaVersion: z.literal(ORGANIZATION_REPORT_VERSION),
  dataBasis: z.enum(['synthetic_example', 'merchant_sources']),
  generatedAt: timestamp,
  scope: z.object({ ownerId: z.uuid(), listingId: z.uuid(), merchantName: z.string().min(1).max(200) }).strict(),
  period: z.object({ from: timestamp, toExclusive: timestamp, timezone: z.literal('UTC') }).strict(),
  listing: listingMetric, website: websiteMetric, traffic: trafficMetric, orders: ordersMetric,
  financialSummary: z.object({ state: z.literal('no_permission'), reason: z.literal('financial_disclosure_not_enabled') }).strict(),
  attribution: z.object({ state: z.literal('no_coverage'), reason: z.literal('attribution_not_implemented') }).strict(),
}).strict().superRefine((report, ctx) => {
  const start = new Date(report.period.from)
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1))
  const canonicalStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1))
  // Refinements can run after a timestamp format failure. Never serialize an
  // invalid date: safeParse and the renderer must reject it without throwing.
  if (![start, canonicalStart, end].every(value => Number.isFinite(value.getTime()))) {
    ctx.addIssue({ code: 'custom', path: ['period'], message: 'Use valid UTC calendar boundaries.' })
    return
  }
  if (report.period.from !== canonicalStart.toISOString() || report.period.toExclusive !== end.toISOString()
    || Date.parse(report.generatedAt) < end.getTime()) {
    ctx.addIssue({ code: 'custom', path: ['period'], message: 'Use one completed UTC calendar month with canonical boundaries.' })
  }
  for (const key of ['listing', 'website', 'traffic', 'orders'] as const) {
    const metric = report[key]
    if (metric.state !== 'available') continue
    if (Date.parse(metric.observedAt) > Date.parse(report.generatedAt)) {
      ctx.addIssue({ code: 'custom', path: [key], message: 'A source observation cannot follow report generation.' })
    }
    if ('coverage' in metric) {
      const from = Date.parse(metric.coverage.from)
      const to = Date.parse(metric.coverage.toExclusive)
      if (from < start.getTime() || to > end.getTime() || from >= to
        || Date.parse(metric.observedAt) < end.getTime()
        || (metric.coverage.state === 'complete' && (from !== start.getTime() || to !== end.getTime()))) {
        ctx.addIssue({ code: 'custom', path: [key, 'coverage'], message: 'Collection coverage must match the reported month and observation time.' })
      }
    }
  }
})

export type OrganizationReport = z.infer<typeof organizationReportSchema>
export type OrganizationReportMetric = OrganizationReport['listing'] | OrganizationReport['website'] | OrganizationReport['traffic'] | OrganizationReport['orders']

/** Pick a minimal projection from a page already authorized by a future producer.
 * Private fields, offers, draft JSON and integration configuration never leave
 * this helper. The source digest is produced by that server, not the caller. */
export function projectReportListing(page: Partial<AgentPage>, observedAt: string, version: string): OrganizationReport['listing'] {
  return listingMetric.parse({
    state: 'available', observedAt, sourceVersion: version,
    value: {
      name: page.name ?? '', description: page.description ?? null, isPublished: page.is_published === true,
      readiness: {
        standardId: AGENT_READY_STANDARD.id, standardVersion: AGENT_READY_STANDARD.version,
        score: getReadinessScore(page), criteria: getReadinessCriteria(page).map(({ id, met }) => ({ id, met })),
      },
    },
  })
}

export function reportPriorityAction(report: OrganizationReport) {
  if (report.listing.state === 'available') {
    const missingIds = report.listing.value.readiness.criteria.filter(item => !item.met).map(item => item.id)
    if (missingIds.includes('description')) return { code: 'listing_description', title: 'Describe the offer clearly', detail: 'Draft a concise business description, then ask the merchant to review it before publication.' }
    if (missingIds.includes('faqs')) return { code: 'listing_faqs', title: 'Answer the first buyer questions', detail: 'Draft a small set of factual FAQs for merchant review. Keep unsupported claims out of the draft.' }
  }
  if (report.website.state !== 'available') return { code: 'website_baseline', title: 'Establish a website baseline', detail: 'Confirm the merchant-approved website and obtain a successful baseline before drawing conclusions about it.' }
  if (report.traffic.state !== 'available' || report.traffic.coverage.state === 'partial') return { code: 'traffic_coverage', title: 'Check traffic coverage', detail: 'Confirm when collection started and which visits it captures before using these counts to judge performance.' }
  return { code: 'review_observations', title: 'Choose one change to verify', detail: 'Review the observed gaps with the merchant, agree one change, and verify its actual public result afterward.' }
}

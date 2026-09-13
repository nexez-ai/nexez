import 'server-only'
import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { AGENT_READY_STANDARD, getReadinessCriteria } from '@/lib/agent-page'
import { organizationReportSchema, REPORT_METRIC_DEFINITIONS, type OrganizationReport } from '@/lib/organization-reports'
import { websiteSnapshotSchema, websiteMetricFromSnapshot } from '@/lib/merchant-website-baselines'

export const MERCHANT_REPORT_HEADERS = { 'Cache-Control': 'private, no-store', Vary: 'Cookie, Authorization' }
export const merchantReportQuerySchema = z.object({
  listingId: z.uuid().transform(value => value.toLowerCase()),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
}).strict()

const timestamp = z.iso.datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value)))
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/)
const count = z.number().int().min(0).max(100_000)
const missing = z.object({ state: z.enum(['no_coverage', 'calculation_failed']) }).strict()
const covered = {
  state: z.literal('available'), evidenceId: z.uuid(), evidenceSha256: digest,
  coverage: z.object({ state: z.enum(['complete', 'partial']), from: timestamp, toExclusive: timestamp }).strict(),
}
const inputSchema = z.object({
  ownerId: z.uuid(), listingId: z.uuid(), month: merchantReportQuerySchema.shape.month, observedAt: timestamp,
  websiteSnapshot: websiteSnapshotSchema.nullable(),
  listing: z.union([
    z.object({ state: z.literal('calculation_failed') }).strict(),
    z.object({
      state: z.literal('available'), name: z.string().max(500), description: z.string().max(20_000).nullable(),
      isPublished: z.boolean(), standardVersion: z.literal(AGENT_READY_STANDARD.version),
      readinessSignals: z.array(z.boolean()).length(getReadinessCriteria({}).length),
    }).strict(),
  ]),
  traffic: z.union([missing, z.object({
    ...covered,
    value: z.object({ totalVisits: count, detectedAiVisits: count,
      verifiedServerVisits: count, unverifiedClientVisits: count, legacyUnverifiedVisits: count }).strict(),
  }).strict()]),
  orders: z.union([missing, z.object({
    ...covered,
    value: z.object({ eligibleLiveOrders: count,
      byPaymentStatus: z.object({ paid: count, refunded: count, disputed: count, dispute_won: count }).strict(),
      excludedTestOrders: count, excludedUnknownModeOrders: count, excludedUnsupportedStatusOrders: count }).strict()
      .refine(value => value.eligibleLiveOrders + value.excludedTestOrders
        + value.excludedUnknownModeOrders + value.excludedUnsupportedStatusOrders <= 100_000),
  }).strict()]),
}).strict()

export class MerchantReportError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

const unavailable = () => new MerchantReportError(503, 'Report inputs are temporarily unavailable.')
const invalidMonth = () => new MerchantReportError(400, 'Choose one of the previous twelve completed UTC calendar months.')

function sourceVersion(kind: 'listing' | 'traffic' | 'orders', ownerId: string, listingId: string, month: string, input: unknown) {
  // A reproducible input fingerprint, not an authorization token or a claim
  // that a report is frozen forever. Reads never reuse authority from a digest.
  const scope = kind === 'orders' ? { ownerId } : { ownerId, listingId }
  return `sha256:${createHash('sha256').update(JSON.stringify({
    definition: REPORT_METRIC_DEFINITIONS[kind], scope, month: kind === 'listing' ? null : month, input,
  })).digest('hex')}`
}

/** The caller must pass its session client and freshly authenticated user ID.
 * SQL independently derives auth.uid(), checks the real user and current owner,
 * and returns one bounded snapshot. There is no service-role fallback or cache.
 * Organization membership is irrelevant here; agency reads need Stage 3 consent.
 */
export async function readMerchantReportInputs(
  client: SupabaseClient, authenticatedUserId: string, query: { listingId: string; month: string },
): Promise<OrganizationReport> {
  const parsed = merchantReportQuerySchema.safeParse(query)
  if (!parsed.success || !z.uuid().safeParse(authenticatedUserId).success) {
    throw new MerchantReportError(400, 'Choose a listing and a completed UTC month.')
  }
  const { listingId, month } = parsed.data
  try {
    const { data, error } = await client.rpc('read_merchant_report_with_website', {
      p_listing_id: listingId, p_month: `${month}-01`,
    }).abortSignal(AbortSignal.timeout(5_000))
    if (error) {
      if (error.code === 'PT400' && error.message === 'invalid_report_month') throw invalidMonth()
      throw unavailable()
    }
    if (data === null) throw new MerchantReportError(404, 'Listing not found.')
    const input = inputSchema.safeParse(data)
    if (!input.success || input.data.ownerId !== authenticatedUserId.toLowerCase()
      || input.data.listingId !== listingId || input.data.month !== month) throw unavailable()
    const raw = input.data
    const observedAt = new Date(raw.observedAt).toISOString()
    // The database is the time authority. Validate its bounded period again
    // against its observation, without relying on the application host's clock.
    const year = Number(month.slice(0, 4))
    const monthIndex = Number(month.slice(5)) - 1
    const from = new Date(Date.UTC(year, monthIndex, 1))
    const to = new Date(Date.UTC(year, monthIndex + 1, 1))
    const observed = new Date(observedAt)
    const oldest = new Date(Date.UTC(observed.getUTCFullYear(), observed.getUTCMonth() - 12, 1))
    if (from < oldest || to > observed || from.toISOString().slice(0, 7) !== month) throw unavailable()

    let listing: OrganizationReport['listing'] = { state: 'calculation_failed' }
    if (raw.listing.state === 'available') {
      const signals = raw.listing.readinessSignals
      listing = organizationReportSchema.shape.listing.parse({
        state: 'available', observedAt,
        sourceVersion: sourceVersion('listing', raw.ownerId, listingId, month, raw.listing),
        value: {
          name: raw.listing.name, description: raw.listing.description, isPublished: raw.listing.isPublished,
          readiness: {
            standardId: AGENT_READY_STANDARD.id, standardVersion: AGENT_READY_STANDARD.version,
            score: Math.round(signals.filter(Boolean).length / signals.length * 100),
            criteria: getReadinessCriteria({}).map(({ id }, index) => ({ id, met: signals[index] })),
          },
        },
      })
    }
    function counts<K extends 'traffic' | 'orders'>(kind: K): OrganizationReport[K] {
      const metric = raw[kind]
      if (metric.state !== 'available') return metric as OrganizationReport[K]
      return {
        state: 'available', observedAt,
        sourceVersion: sourceVersion(kind, raw.ownerId, listingId, month, metric),
        coverage: { state: metric.coverage.state,
          from: new Date(metric.coverage.from).toISOString(), toExclusive: new Date(metric.coverage.toExclusive).toISOString() },
        value: metric.value,
      } as OrganizationReport[K]
    }
    return organizationReportSchema.parse({
      schemaVersion: 1, dataBasis: 'merchant_sources', generatedAt: observedAt,
      scope: { ownerId: raw.ownerId, listingId, merchantName: raw.listing.state === 'available' ? raw.listing.name.slice(0, 200) || 'Merchant listing' : 'Merchant listing' },
      period: { from: from.toISOString(), toExclusive: to.toISOString(), timezone: 'UTC' },
      listing, website: websiteMetricFromSnapshot(raw.websiteSnapshot), traffic: counts('traffic'), orders: counts('orders'),
      financialSummary: { state: 'no_permission', reason: 'financial_disclosure_not_enabled' },
      attribution: { state: 'no_coverage', reason: 'attribution_not_implemented' },
    })
  } catch (error) {
    if (error instanceof MerchantReportError) throw error
    // Neither source rows nor database error text may reach a response or log.
    throw unavailable()
  }
}

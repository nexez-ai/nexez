import { z } from 'zod'
import { normalizeOrganizationScanOrigin, scanResultSchema } from './organization-scans'

export const WEBSITE_SCANNER_VERSION = 'site-scan-2.1'
export const WEBSITE_APPROVAL_VERSION = 'merchant-website-v1'
export const WEBSITE_BASELINE_HEADERS = { 'Cache-Control': 'private, no-store', Vary: 'Cookie, Authorization' }
const uuid = z.uuid().transform(value => value.toLowerCase())
const timestamp = z.iso.datetime({ offset: true }).transform(value => new Date(value).toISOString())
const origin = z.string().max(263).refine(value => normalizeOrganizationScanOrigin(value) === value)
export const websiteBaselineQuery = z.object({ listingId: uuid }).strict()
export const websiteBaselineCommand = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve'), listingId: uuid, origin,
    approvalVersion: z.literal(WEBSITE_APPROVAL_VERSION), attested: z.literal(true), idempotencyKey: uuid }).strict(),
  z.object({ action: z.literal('revoke'), listingId: uuid, associationId: uuid }).strict(),
  z.object({ action: z.literal('collect'), listingId: uuid, associationId: uuid, idempotencyKey: uuid }).strict(),
])
export type WebsiteBaselineCommand = z.infer<typeof websiteBaselineCommand>

export const websiteFailureSchema = z.enum(['unsafe_target', 'robots_denied', 'target_unavailable', 'network_error', 'pressure_deferred'])
export const websiteSnapshotSchema = z.object({
  id: uuid, associationId: uuid, origin, associationMethod: z.literal('merchant_approved'),
  scannerVersion: z.literal(WEBSITE_SCANNER_VERSION), rubricId: z.literal('nexez.website-agent-readiness'),
  provenance: z.literal('merchant_website_snapshot'), evaluatedAt: timestamp, createdAt: timestamp,
  sourceVersion: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  result: scanResultSchema.nullable(), failure: websiteFailureSchema.nullable(),
}).strict().refine(value => (value.result !== null && value.failure === null) || (value.result === null && value.failure !== null))

export const websiteBaselineViewSchema = z.object({
  ownerId: uuid, listingId: uuid, collectionEnabled: z.boolean(), suggestedOrigin: origin.nullable(),
  association: z.object({ id: uuid, origin, method: z.literal('merchant_approved'), confirmedAt: timestamp, expiresAt: timestamp }).strict().nullable(),
  latest: websiteSnapshotSchema.nullable(),
  attempt: z.object({ id: uuid, state: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled', 'expired']) }).strict().nullable(),
}).strict().superRefine((value, ctx) => {
  if (value.latest && (!value.association || value.latest.associationId !== value.association.id || value.latest.origin !== value.association.origin)) {
    ctx.addIssue({ code: 'custom', message: 'Snapshot association does not match.' })
  }
})
export type WebsiteBaselineView = z.infer<typeof websiteBaselineViewSchema>

export function websiteMetricFromSnapshot(snapshot: WebsiteBaselineView['latest']) {
  if (!snapshot) return { state: 'not_collected' as const }
  if (!snapshot.result) return { state: 'calculation_failed' as const }
  return { state: 'available' as const, observedAt: snapshot.evaluatedAt, sourceVersion: snapshot.sourceVersion,
    value: { provenance: snapshot.provenance, snapshotId: snapshot.id, associationId: snapshot.associationId,
      origin: snapshot.origin, associationMethod: snapshot.associationMethod, scannerVersion: snapshot.scannerVersion,
      rubricId: snapshot.rubricId, result: snapshot.result } }
}

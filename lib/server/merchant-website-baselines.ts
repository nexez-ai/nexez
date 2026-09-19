import 'server-only'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { evaluateCrawlability } from '@/lib/crawlability'
import { normalizeOrganizationScanOrigin, scanResultSchema } from '@/lib/organization-scans'
import { WEBSITE_SCANNER_VERSION, websiteBaselineViewSchema, websiteBaselineCommand, type WebsiteBaselineCommand } from '@/lib/merchant-website-baselines'
import { createAdminClient } from '@/utils/supabase/admin'
import { gatherSiteSignals } from './site-scan'
import { createScanNetworkContext, ScanNetworkError } from './scan-network'

export class WebsiteBaselineError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}
const unavailable = () => new WebsiteBaselineError(503, 'Website baselines are temporarily unavailable.')
const messages: Record<string, string> = {
  listing_not_found: 'Listing not found.', association_not_found: 'Website association not found.',
  collection_disabled: 'Website baseline collection is not enabled for this listing.',
  invalid_approval: 'Approve the current listing website and confirm the collection terms.',
  invalid_command: 'Check the website request.', association_changed: 'The website approval changed. Refresh before collecting.',
  association_exists: 'Revoke the current website approval before approving another.',
  idempotency_conflict: 'This request key was already used for a different request.',
  daily_limit: 'The daily allowance of three website collections has been reached.',
  collection_busy: 'A website collection is already in progress. Refresh shortly.',
  approval_limit: 'The website approval limit has been reached.',
}
export async function websiteRpc(client: SupabaseClient, name: string, args: Record<string, unknown> = {}) {
  try {
    const { data, error } = await client.rpc(name, args).abortSignal(AbortSignal.timeout(5_000))
    if (error) {
      if (['PT400', 'PT404', 'PT409', 'PT429', 'PT503'].includes(error.code) && messages[error.message]) {
        throw new WebsiteBaselineError(Number(error.code.slice(2)), messages[error.message])
      }
      throw unavailable()
    }
    return data as unknown
  } catch (error) {
    if (error instanceof WebsiteBaselineError) throw error
    throw unavailable()
  }
}

export async function readWebsiteBaseline(client: SupabaseClient, ownerId: string, listingId: string) {
  const raw = await websiteRpc(client, 'read_merchant_website_baseline', { p_listing: listingId })
  if (raw === null) throw new WebsiteBaselineError(404, 'Listing not found.')
  const parsed = websiteBaselineViewSchema.safeParse(raw)
  if (!parsed.success || parsed.data.ownerId !== ownerId.toLowerCase() || parsed.data.listingId !== listingId) throw unavailable()
  return parsed.data
}

const receiptSchema = z.object({ id: z.uuid(), ownerId: z.uuid(), listingId: z.uuid() }).strict()
export async function commandWebsiteBaseline(client: SupabaseClient, ownerId: string, input: WebsiteBaselineCommand) {
  const command = websiteBaselineCommand.parse(input)
  const receipt = receiptSchema.safeParse(await websiteRpc(client, 'command_merchant_website', {
    p_listing: command.listingId, p_action: command.action,
    p_origin: command.action === 'approve' ? command.origin : null,
    p_association: command.action === 'approve' ? null : command.associationId,
    p_request: command.action === 'revoke' ? null : command.idempotencyKey,
    p_attested: command.action === 'approve' ? command.attested : null,
    p_approval_version: command.action === 'approve' ? command.approvalVersion : null,
  }))
  if (!receipt.success || receipt.data.ownerId !== ownerId.toLowerCase() || receipt.data.listingId !== command.listingId) throw unavailable()
  return receipt.data.id
}

const claimSchema = receiptSchema.extend({ associationId: z.uuid(), origin: z.string().max(263), leaseToken: z.uuid() }).strict()

/** One synchronous, bounded claim/fetch/commit. Receipts survive timeouts, so a
 * replay never duplicates a fetch or a snapshot. There are no background retries.
 * A killed request expires visibly and the merchant may request a new collection.
 */
export async function collectWebsiteBaseline(collectionId: string, ownerId: string, listingId: string, associationId: string) {
  const admin = createAdminClient()
  const raw = await websiteRpc(admin, 'claim_merchant_website_collection', { p_collection: collectionId })
  if (raw === null) return
  const parsed = claimSchema.safeParse(raw)
  if (!parsed.success || parsed.data.id !== collectionId || parsed.data.ownerId !== ownerId.toLowerCase()
    || parsed.data.listingId !== listingId || parsed.data.associationId !== associationId) throw unavailable()
  const claim = parsed.data
  let result: z.infer<typeof scanResultSchema> | null = null
  let failure: ScanNetworkError['code'] | null = null
  const network = createScanNetworkContext(claim.leaseToken, null, admin, claim.origin)
  try {
    try {
      if (normalizeOrganizationScanOrigin(claim.origin) !== claim.origin) throw new ScanNetworkError('unsafe_target')
      const gathered = await gatherSiteSignals(claim.origin, network.options)
      network.assertFinished()
      if ('error' in gathered) throw new ScanNetworkError('unsafe_target')
      if (gathered.origin !== claim.origin) throw new ScanNetworkError('unsafe_target')
      if (gathered.signals.status < 200 || gathered.signals.status >= 300) throw new ScanNetworkError('network_error')
      const report = evaluateCrawlability(gathered.signals)
      result = scanResultSchema.parse({ version: report.version, score: report.score,
        checks: report.checks.map(({ id, status }) => ({ id, status })) })
    } catch (error) {
      failure = error instanceof ScanNetworkError ? error.code : 'network_error'
    }
    // SQL rechecks the owner, current website, approval, pilot and one-use lease.
    // Loss of authority discards this result instead of creating merchant history.
    const committed = await websiteRpc(admin, 'complete_merchant_website_collection', {
      p_collection: collectionId, p_token: claim.leaseToken, p_result: result, p_failure: failure,
      p_scanner_version: WEBSITE_SCANNER_VERSION,
    })
    if (typeof committed !== 'boolean') throw unavailable()
  } finally { await network.close() }
}

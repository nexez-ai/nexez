import 'server-only'
import { z } from 'zod'
import { createAdminClient, hasSupabaseAdminEnv } from '@/utils/supabase/admin'
import { hasInngestEnv } from '@/lib/inngest/client'
import { evaluateCrawlability } from '@/lib/crawlability'
import { normalizeOrganizationScanOrigin, scanResultSchema } from '@/lib/organization-scans'
import { gatherSiteSignals } from './site-scan'
import { createScanNetworkContext, ScanNetworkError } from './scan-network'
import { scanRpc } from './organization-scans'

export const organizationScanEventSchema = z.object({ orgId: z.uuid(), batchId: z.uuid() }).strict()
const claimSchema = z.object({ target_id: z.uuid(), origin: z.string().max(263), lease_token: z.uuid(), attempt: z.number().int().min(1).max(3) })
export function hasOrganizationScanRunner() {
  return hasSupabaseAdminEnv() && hasInngestEnv() && (process.env.NODE_ENV !== 'production' || Boolean(process.env.INNGEST_SIGNING_KEY))
}

/** Claim, fetch and completion MUST stay in one step. Returning an origin or an
 * authorization decision from a memoized step would retain confidential input
 * and let a later step reuse stale authority. Only a progress boolean leaves it.
 */
export async function processNextOrganizationScan(orgId: string, batchId: string): Promise<boolean> {
  const admin = createAdminClient()
  const raw = await scanRpc(admin, 'claim_organization_scan_target', { p_org_id: orgId, p_batch_id: batchId })
  if (raw === null) return false
  const parsed = claimSchema.safeParse(raw)
  if (!parsed.success) throw new Error('Invalid scan claim response')
  const claim = parsed.data
  const started = Date.now()
  const network = createScanNetworkContext(claim.lease_token, orgId, admin)
  let result: z.infer<typeof scanResultSchema> | null = null
  let failure: ScanNetworkError['code'] | null = null
  try {
    try {
      if (normalizeOrganizationScanOrigin(claim.origin) !== claim.origin) throw new ScanNetworkError('unsafe_target')
      const gathered = await gatherSiteSignals(claim.origin, network.options)
      network.assertFinished()
      if ('error' in gathered) throw new ScanNetworkError('unsafe_target')
      if (gathered.signals.status < 200 || gathered.signals.status >= 400) throw new ScanNetworkError('network_error')
      const report = evaluateCrawlability(gathered.signals)
      result = scanResultSchema.parse({ version: report.version, score: report.score, checks: report.checks.map(({ id, status }) => ({ id, status })) })
    } catch (error) {
      failure = error instanceof ScanNetworkError ? error.code : 'network_error'
    }
    // Fresh authorization, lease token and deletion checks occur in this command.
    const committed = await scanRpc(admin, 'complete_organization_scan_target', {
      p_org_id: orgId, p_target_id: claim.target_id, p_lease_token: claim.lease_token,
      p_result: result, p_failure: failure, p_elapsed_ms: Math.min(60000, Date.now() - started),
      p_bytes_read: Math.min(3145728, network.metrics.bytesRead), p_probe_count: Math.min(40, network.metrics.probeCount),
    })
    if (typeof committed !== 'boolean') throw new Error('Invalid scan completion response')
    return true
  } finally { await network.close() }
}

export async function pendingOrganizationScans() {
  const admin = createAdminClient()
  await scanRpc(admin, 'cleanup_organization_scans')
  const data = await scanRpc(admin, 'dispatch_organization_scan_batches')
  const rows = z.array(z.object({ org_id: z.uuid(), batch_id: z.uuid() })).max(20).safeParse(data)
  if (!rows.success) throw new Error('Invalid scan dispatch response')
  return rows.data.map((row) => ({ orgId: row.org_id, batchId: row.batch_id }))
}

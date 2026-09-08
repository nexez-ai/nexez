import { NextResponse } from 'next/server'
import { inngest } from '@/lib/inngest/client'
import { ORGANIZATION_SCAN_BATCH } from '@/lib/inngest/events'
import { parseOrganizationScanInput } from '@/lib/organization-scans'
import { getResolvedImportUrlError } from '@/lib/importer'
import { enforceRateLimit } from '@/lib/rate-limit'
import { organizationScanRoute } from '@/lib/server/organization-scan-route'
import { ORGANIZATION_SCAN_HEADERS as headers, OrganizationScanError, readScanWorkspace, scanRequestBody, scanRpc, scanSubmissionSchema, scanReceiptSchema } from '@/lib/server/organization-scans'
import { hasOrganizationScanRunner } from '@/lib/server/organization-scan-worker'
import { captureEvent } from '@/lib/observability'

export const dynamic = 'force-dynamic'
export const maxDuration = 30
type Context = { params: Promise<{ orgId: string }> }

export function GET(request: Request, context: Context) {
  return organizationScanRoute(request, context.params, async (client, orgId) => {
    const workspace = await readScanWorkspace(client, orgId)
    return NextResponse.json({ ...workspace, can_submit: workspace.can_submit && hasOrganizationScanRunner() }, { headers })
  })
}

export function POST(request: Request, context: Context) {
  return organizationScanRoute(request, context.params, async (client, orgId, userId) => {
    const limited = await enforceRateLimit(request, 'organization-scan-submit', 6, 60000, { subject: userId, failClosed: true })
    if (limited) {
      captureEvent('organization-scan.quota_denied', { orgId, kind: 'submission_rate' })
      for (const [key, value] of Object.entries(headers)) limited.headers.set(key, value)
      return limited
    }
    const parsed = scanSubmissionSchema.safeParse(await scanRequestBody(request))
    if (!parsed.success) throw new OrganizationScanError(400, 'Check the target list and acceptable-use confirmation.')
    const input = parseOrganizationScanInput(parsed.data.input)
    if (input.issues.length) return NextResponse.json({ error: 'Check the target list.', issues: input.issues }, { status: 400, headers })
    const workspace = await readScanWorkspace(client, orgId)
    const existing = await scanRpc(client, 'find_organization_scan_receipt', { p_org_id: orgId, p_idempotency_key: parsed.data.idempotencyKey, p_targets: input.targets })
    if (existing !== null) return NextResponse.json(scanReceiptSchema.parse(existing), { headers })
    if (!workspace.can_submit) throw new OrganizationScanError(409, 'Scanning is not available in this workspace right now.')
    if (!hasOrganizationScanRunner()) throw new OrganizationScanError(503, 'Scanning is temporarily unavailable.')
    // Resolve before reservation, with bounded groups to avoid saturating DNS.
    for (let index = 0; index < input.targets.length; index += 5) {
      const errors = await Promise.all(input.targets.slice(index, index + 5).map((url) => getResolvedImportUrlError(url, { useCache: false, failClosed: true })))
      if (errors.some(Boolean)) throw new OrganizationScanError(400, 'One or more websites did not pass the public network checks.')
    }
    const receipt = scanReceiptSchema.parse(await scanRpc(client, 'submit_organization_scan_batch', {
      p_org_id: orgId, p_idempotency_key: parsed.data.idempotencyKey, p_targets: input.targets, p_attested: true,
    }).catch((error: unknown) => {
      if (error instanceof OrganizationScanError && error.status === 429) captureEvent('organization-scan.quota_denied', { orgId, kind: 'daily_allowance' })
      throw error
    }))
    try { await inngest.send({ name: ORGANIZATION_SCAN_BATCH, data: { orgId, batchId: receipt.batch_id } }) }
    catch { /* The durable database outbox retries dispatch without charging again. */ }
    return NextResponse.json(receipt, { status: receipt.replayed ? 200 : 202, headers })
  })
}

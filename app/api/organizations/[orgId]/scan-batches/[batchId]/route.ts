import { NextResponse } from 'next/server'
import { z } from 'zod'
import { organizationScanRoute } from '@/lib/server/organization-scan-route'
import { ORGANIZATION_SCAN_HEADERS as headers, OrganizationScanError, readScanWorkspace, scanRequestBody, scanRpc } from '@/lib/server/organization-scans'

export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ orgId: string; batchId: string }> }

export function GET(request: Request, context: Context) {
  return organizationScanRoute(request, context.params, async (client, orgId, _userId, batchId) => {
    return NextResponse.json(await readScanWorkspace(client, orgId, batchId), { headers })
  })
}
export function PATCH(request: Request, context: Context) {
  return organizationScanRoute(request, context.params, async (client, orgId, _userId, batchId) => {
    const body = z.discriminatedUnion('action', [
      z.object({ action: z.literal('cancel') }).strict(),
      z.object({ action: z.literal('follow_up'), targetId: z.uuid(), selected: z.boolean() }).strict(),
    ]).safeParse(await scanRequestBody(request))
    if (!body.success) throw new OrganizationScanError(400, 'Invalid batch action.')
    await scanRpc(client, 'change_organization_scan_batch', {
      p_org_id: orgId, p_batch_id: batchId, p_action: body.data.action,
      p_target_id: body.data.action === 'follow_up' ? body.data.targetId : null,
      p_follow_up: body.data.action === 'follow_up' && body.data.selected,
    })
    return NextResponse.json({ ok: true }, { headers })
  })
}
export function DELETE(request: Request, context: Context) {
  return organizationScanRoute(request, context.params, async (client, orgId, _userId, batchId) => {
    if (!z.object({}).strict().safeParse(await scanRequestBody(request)).success) throw new OrganizationScanError(400, 'Invalid batch action.')
    await scanRpc(client, 'change_organization_scan_batch', { p_org_id: orgId, p_batch_id: batchId, p_action: 'delete' })
    return NextResponse.json({ ok: true }, { headers })
  })
}

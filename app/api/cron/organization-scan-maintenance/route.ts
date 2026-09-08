import { NextResponse } from 'next/server'
import { verifyBearerToken } from '@/lib/commerce/inbound-auth'
import { captureEvent, captureSignal } from '@/lib/observability'
import { runOrganizationScanMaintenance } from '@/lib/server/organization-scan-operations'
import { ORGANIZATION_SCAN_HEADERS } from '@/lib/server/organization-scans'
import { hasSupabaseAdminEnv } from '@/utils/supabase/admin'

export const maxDuration = 30

/** Independent of pilot and runner switches, including the anonymous scanner's shared records. */
export async function GET(request: Request) {
  const headers = ORGANIZATION_SCAN_HEADERS
  const secret = process.env.CRON_SECRET
  if (!secret?.trim() || !verifyBearerToken(request.headers.get('authorization'), `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })
  }
  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({ ok: false, error: 'not_configured' }, { status: 503, headers })
  }
  try {
    const removedBatches = await runOrganizationScanMaintenance()
    captureEvent('scanner.maintenance', { removedBatches })
    return NextResponse.json({ ok: true, removedBatches }, { headers })
  } catch {
    captureSignal('scanner.maintenance_failed', { reason: 'database_unavailable' })
    return NextResponse.json({ ok: false, error: 'maintenance_failed' }, { status: 503, headers })
  }
}

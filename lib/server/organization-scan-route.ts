import 'server-only'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveRequestAuth } from './request-auth'
import { ORGANIZATION_SCAN_HEADERS, OrganizationScanError } from './organization-scans'

export async function organizationScanRoute(
  request: Request,
  params: Promise<{ orgId: string; batchId?: string }>,
  handler: (client: SupabaseClient, orgId: string, userId: string, batchId: string | null) => Promise<NextResponse>,
) {
  try {
    const { supabase, user } = await resolveRequestAuth(request)
    if (!user) throw new OrganizationScanError(401, 'Sign in to view your workspaces.')
    const ids = await params
    if (!z.uuid().safeParse(ids.orgId).success || (ids.batchId !== undefined && !z.uuid().safeParse(ids.batchId).success)) throw new OrganizationScanError(404, 'Workspace or batch not found.')
    return await handler(supabase, ids.orgId.toLowerCase(), user.id, ids.batchId?.toLowerCase() ?? null)
  } catch (error) {
    const known = error instanceof OrganizationScanError
    return NextResponse.json({ error: known ? error.message : 'Scans are temporarily unavailable. Please try again.' }, {
      status: known ? error.status : 503, headers: ORGANIZATION_SCAN_HEADERS,
    })
  }
}

import { NextResponse } from 'next/server'
import { resolveRequestAuth } from '@/lib/server/request-auth'
import { getOrganizationWorkspace } from '@/lib/server/organization-context'

export const dynamic = 'force-dynamic'

const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie, Authorization' }

export async function GET(request: Request, context: { params: Promise<{ orgId: string }> }) {
  try {
    const { supabase, user } = await resolveRequestAuth(request)
    if (!user) return NextResponse.json({ error: 'Sign in to view your workspaces.' }, { status: 401, headers })
    const { orgId } = await context.params
    const organization = await getOrganizationWorkspace(supabase, { id: orgId })
    if (!organization) return NextResponse.json({ error: 'Workspace not found.' }, { status: 404, headers })
    return NextResponse.json({ organization }, { headers })
  } catch {
    return NextResponse.json({ error: 'Workspaces are temporarily unavailable. Please try again.' }, { status: 503, headers })
  }
}

import { NextResponse } from 'next/server'
import { resolveRequestAuth } from '@/lib/server/request-auth'
import { listOrganizationWorkspaces, organizationSlugSchema } from '@/lib/server/organization-context'

export const dynamic = 'force-dynamic'

const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie, Authorization' }

export async function GET(request: Request) {
  try {
    const { supabase, user } = await resolveRequestAuth(request)
    if (!user) return NextResponse.json({ error: 'Sign in to view your workspaces.' }, { status: 401, headers })
    const cursor = new URL(request.url).searchParams.get('cursor')
    if (cursor !== null && !organizationSlugSchema.safeParse(cursor).success) {
      return NextResponse.json({ error: 'Invalid workspace cursor.' }, { status: 400, headers })
    }
    return NextResponse.json(await listOrganizationWorkspaces(supabase, cursor), { headers })
  } catch {
    return NextResponse.json({ error: 'Workspaces are temporarily unavailable. Please try again.' }, { status: 503, headers })
  }
}

import { NextResponse } from 'next/server'
import { resolveRequestAuth } from '@/lib/server/request-auth'
import { enforceRateLimit } from '@/lib/rate-limit'
import { hasSupabaseAdminEnv } from '@/utils/supabase/admin'
import { WEBSITE_BASELINE_HEADERS as headers, websiteBaselineCommand, websiteBaselineQuery } from '@/lib/merchant-website-baselines'
import { WebsiteBaselineError, collectWebsiteBaseline, commandWebsiteBaseline, readWebsiteBaseline } from '@/lib/server/merchant-website-baselines'
import { OrganizationScanError, scanRequestBody } from '@/lib/server/organization-scans'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function handle(request: Request, mutate: boolean) {
  try {
    const { supabase, user } = await resolveRequestAuth(request)
    if (!user || user.is_anonymous) throw new WebsiteBaselineError(401, 'Sign in to manage your website baseline.')
    const params = new URL(request.url).searchParams
    const limited = await enforceRateLimit(request, mutate ? 'merchant-website-write' : 'merchant-website-read', mutate ? 6 : 30, 60_000, { subject: user.id, failClosed: true })
    if (limited) {
      for (const [key, value] of Object.entries(headers)) limited.headers.set(key, value)
      return limited
    }
    if (!mutate) {
      const query = websiteBaselineQuery.safeParse(Object.fromEntries(params))
      if (!query.success || [...params.keys()].length !== 1) throw new WebsiteBaselineError(400, 'Choose one listing.')
      return NextResponse.json(await readWebsiteBaseline(supabase, user.id, query.data.listingId), { headers })
    }
    if ([...params.keys()].length) throw new WebsiteBaselineError(400, 'Use the request body for website changes.')
    const parsed = websiteBaselineCommand.safeParse(await scanRequestBody(request))
    if (!parsed.success) throw new WebsiteBaselineError(400, 'Check the website request and approval.')
    const command = parsed.data
    if (command.action === 'collect' && !hasSupabaseAdminEnv()) throw new WebsiteBaselineError(503, 'Website collection is temporarily unavailable.')
    const id = await commandWebsiteBaseline(supabase, user.id, command)
    if (command.action === 'collect') await collectWebsiteBaseline(id, user.id, command.listingId, command.associationId)
    return NextResponse.json(await readWebsiteBaseline(supabase, user.id, command.listingId), { headers })
  } catch (error) {
    const known = error instanceof WebsiteBaselineError || error instanceof OrganizationScanError
    return NextResponse.json({ error: known ? error.message : 'Website baselines are temporarily unavailable.' }, { status: known ? error.status : 503, headers })
  }
}
export function GET(request: Request) { return handle(request, false) }
export function POST(request: Request) { return handle(request, true) }

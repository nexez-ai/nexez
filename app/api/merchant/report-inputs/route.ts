import { NextResponse } from 'next/server'
import { enforceRateLimit } from '@/lib/rate-limit'
import { resolveRequestAuth } from '@/lib/server/request-auth'
import { MERCHANT_REPORT_HEADERS as headers, MerchantReportError, merchantReportQuerySchema, readMerchantReportInputs } from '@/lib/server/merchant-report-inputs'

export const dynamic = 'force-dynamic'
export const maxDuration = 15

export async function GET(request: Request) {
  try {
    const { supabase, user } = await resolveRequestAuth(request)
    if (!user || user.is_anonymous) throw new MerchantReportError(401, 'Sign in to view your report inputs.')
    const params = new URL(request.url).searchParams
    const query = merchantReportQuerySchema.safeParse(Object.fromEntries(params))
    if (!query.success || [...params.keys()].length !== 2) {
      throw new MerchantReportError(400, 'Choose a listing and a completed UTC month.')
    }
    const limited = await enforceRateLimit(request, 'merchant-report-inputs', 6, 60_000, { subject: user.id, failClosed: true })
    if (limited) {
      for (const [key, value] of Object.entries(headers)) limited.headers.set(key, value)
      return limited
    }
    return NextResponse.json(await readMerchantReportInputs(supabase, user.id, query.data), { headers })
  } catch (error) {
    const known = error instanceof MerchantReportError
    return NextResponse.json({ error: known ? error.message : 'Report inputs are temporarily unavailable.' }, {
      status: known ? error.status : 503, headers,
    })
  }
}

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { enforceRateLimit } from '@/lib/rate-limit'
import { authorizeStudyRequest } from '@/lib/server/agent-readiness-study'
import { readResearchStatus, runResearchBatch } from '@/lib/server/large-readiness-study'

export const maxDuration = 60
const headers = { 'Cache-Control': 'private, no-store' }
const requestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('status'), cohort: z.string().regex(/^[a-z0-9-]{3,80}$/) }).strict(),
  z.object({ action: z.literal('tick'), cohort: z.string().regex(/^[a-z0-9-]{3,80}$/), dispatchId: z.uuid() }).strict(),
])

export async function POST(request: Request) {
  if (!(await authorizeStudyRequest(request, 'research'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })
  }
  const limited = await enforceRateLimit(request, 'readiness-research', 6, 60_000)
  if (limited) return limited
  let body: z.infer<typeof requestSchema>
  try {
    // Bound actual streamed bytes, not just the caller's Content-Length header.
    const reader = request.body?.getReader()
    if (!reader) throw new Error('Missing body')
    const chunks: Uint8Array[] = []
    let size = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Body timeout')), 5_000) })
    try {
      while (true) {
        const { done, value } = await Promise.race([reader.read(), deadline])
        if (done) break
        size += value.byteLength
        if (size > 1024) throw new Error('Body too large')
        chunks.push(value)
      }
    } finally { clearTimeout(timer); void reader.cancel().catch(() => undefined) }
    body = requestSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
  } catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400, headers }) }
  try {
    if (body.action === 'status') {
      const status = await readResearchStatus(body.cohort)
      return NextResponse.json(status ?? { error: 'Unknown cohort' }, { status: status ? 200 : 404, headers })
    }
    const result = await runResearchBatch(body.cohort, body.dispatchId)
    return NextResponse.json(result, { status: result.ok ? 200 : 503, headers })
  } catch {
    return NextResponse.json({ error: 'Research runner unavailable' }, { status: 503, headers })
  }
}

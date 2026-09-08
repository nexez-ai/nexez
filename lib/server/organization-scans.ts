import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { scanWorkspaceSchema, SCAN_INPUT_LIMIT } from '@/lib/organization-scans'
export { scanReceiptSchema } from '@/lib/organization-scans'

export const ORGANIZATION_SCAN_HEADERS = { 'Cache-Control': 'private, no-store', Vary: 'Cookie, Authorization' }
const messages: Record<string, string> = {
  idempotency_conflict: 'This request key was already used for a different batch.',
  batch_deleted: 'This batch has been deleted or expired. Submit a new request to scan again.',
  scanning_unavailable: 'Scanning is not available in this workspace right now.',
  daily_limit: 'The daily scan allowance has been reached.',
  batch_limit: 'This batch exceeds the workspace limit.',
  invalid_targets: 'Check the target list and acceptable-use confirmation.',
}
export class OrganizationScanError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

export async function scanRpc(client: SupabaseClient, name: string, args: Record<string, unknown> = {}) {
  try {
    const { data, error } = await client.rpc(name, args).abortSignal(AbortSignal.timeout(5_000))
    if (error) {
      if (error.code === 'PT404') throw new OrganizationScanError(404, 'Workspace or batch not found.')
      if (['PT400', 'PT409', 'PT410', 'PT429'].includes(error.code) && messages[error.message]) {
        throw new OrganizationScanError(Number(error.code.slice(2)), messages[error.message])
      }
      throw new Error('RPC unavailable')
    }
    return data as unknown
  } catch (error) {
    if (error instanceof OrganizationScanError) throw error
    throw new OrganizationScanError(503, 'Scans are temporarily unavailable. Please try again.')
  }
}

export async function readScanWorkspace(client: SupabaseClient, orgId: string, batchId: string | null = null) {
  const data = await scanRpc(client, 'read_organization_scan_batches', { p_org_id: orgId, p_batch_id: batchId })
  if (data === null) throw new OrganizationScanError(404, 'Workspace or batch not found.')
  const parsed = scanWorkspaceSchema.safeParse(data)
  if (!parsed.success || parsed.data.batches.some((b) => b.org_id !== orgId || (batchId && b.id !== batchId))) {
    throw new OrganizationScanError(503, 'Scans are temporarily unavailable. Please try again.')
  }
  if (batchId && !parsed.data.batches.length) throw new OrganizationScanError(404, 'Workspace or batch not found.')
  return parsed.data
}

export const scanSubmissionSchema = z.object({
  idempotencyKey: z.uuid(), input: z.string().max(SCAN_INPUT_LIMIT), attested: z.literal(true),
}).strict()

/** Bounded JSON and same-origin browser mutations. Bearer clients may omit Origin. */
export async function scanRequestBody(request: Request): Promise<unknown> {
  const origin = request.headers.get('origin')
  // Next may reconstruct a loopback URL using localhost even when the browser
  // requested 127.0.0.1. Host is browser-controlled and cannot be set by page JS;
  // do not trust a caller-supplied X-Forwarded-Host for this comparison.
  const destination = new URL(request.url)
  const host = request.headers.get('host')
  if (host) destination.host = host
  if (origin && origin !== destination.origin) throw new OrganizationScanError(403, 'Request origin is not allowed.')
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new OrganizationScanError(415, 'Send JSON.')
  const reader = request.body?.getReader()
  if (!reader) throw new OrganizationScanError(400, 'Send a request body.')
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new OrganizationScanError(408, 'Request timed out.')), 5_000) })
  let size = 0
  const chunks: Uint8Array[] = []
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), deadline])
      if (done) break
      size += value.byteLength
      if (size > SCAN_INPUT_LIMIT + 4096) throw new OrganizationScanError(413, 'Use a smaller target list.')
      chunks.push(value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch (error) {
    if (error instanceof OrganizationScanError) throw error
    throw new OrganizationScanError(400, 'Invalid JSON.')
  } finally {
    clearTimeout(timer)
    void reader.cancel().catch(() => undefined)
  }
}

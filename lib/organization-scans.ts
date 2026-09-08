import { z } from 'zod'
import { getDomain } from 'tldts'

export const SCAN_INPUT_LIMIT = 32 * 1024
export const SCAN_TARGET_LIMIT = 50
export const SCAN_POLICY_VERSION = 'public-scanner-v1'

export const SCAN_CHECK_COPY: Record<string, { label: string; action: string }> = {
  reachable: { label: 'Page access', action: 'Make the homepage publicly reachable.' },
  speed: { label: 'Response time', action: 'Reduce the time needed to load the page.' },
  robots: { label: 'Assistant access', action: 'Review which assistants your crawl rules allow.' },
  agent_docs: { label: 'Agent documentation', action: 'Publish a guide to your offers and available actions.' },
  llms_txt: { label: 'Plain text summary', action: 'Add an llms.txt summary of the business and offers.' },
  semantics: { label: 'Page basics', action: 'Add a descriptive title, summary and main heading.' },
  jsonld: { label: 'Structured data', action: 'Publish valid JSON-LD describing the business and offers.' },
  business_identity: { label: 'Business identity', action: 'Make the business name and contact details machine readable.' },
  offer_schema: { label: 'Offer descriptions', action: 'Describe products or services with structured offer data.' },
  pricing: { label: 'Prices', action: 'State prices clearly in visible and structured offer information.' },
  action_path: { label: 'Buy or book', action: 'Provide a working purchase, booking or quote path.' },
  availability: { label: 'Availability', action: 'State availability and delivery or appointment timing.' },
  offer_details: { label: 'Offer details', action: 'Explain what each offer includes.' },
  structured_action: { label: 'Next step', action: 'Provide a machine-readable link to the next step.' },
  https: { label: 'Secure connection', action: 'Serve the site over HTTPS.' },
  contact: { label: 'Contact', action: 'Provide a clear contact or support path.' },
  policies: { label: 'Buyer policies', action: 'Make terms, privacy and refund policies easy to find.' },
  freshness: { label: 'Freshness', action: 'Show when material business information was updated.' },
}

export function normalizeOrganizationScanOrigin(input: string): string | null {
  const raw = input.trim()
  if (!raw || /[\u0000-\u0020\u007f\\%?#]/.test(raw)) return null
  const value = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  // Inspect the original shape too: URL parsing otherwise normalizes /a/.. to /.
  if (!/^https?:\/\/[^/]+\/?$/i.test(value)) return null
  try {
    const url = new URL(value)
    if (url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) return null
    const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
    if (!/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/.test(hostname)) return null
    if (/(?:^|\.)(localhost|local|internal|test|invalid|example|onion|home|lan)$/.test(hostname)) return null
    if (!getDomain(hostname, { allowPrivateDomains: true })) return null
    const origin = `${url.protocol}//${hostname}`
    return origin.length <= 263 ? origin : null
  } catch { return null }
}

/** One-column CSV or pasted origins. Files stay in the browser and are never stored. */
export function parseOrganizationScanInput(text: string) {
  const targets = new Set<string>()
  const issues: Array<{ line: number; message: string }> = []
  let duplicateCount = 0
  if (new TextEncoder().encode(text).byteLength > SCAN_INPUT_LIMIT) {
    return { targets: [], duplicateCount, issues: [{ line: 0, message: 'Use a file or paste smaller than 32 KB.' }] }
  }
  const rows = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  if (rows.length > 201) return { targets: [], duplicateCount, issues: [{ line: 0, message: 'Use at most 200 input rows.' }] }
  for (const [index, row] of rows.entries()) {
    let value = row.trim()
    if (!value) continue
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1).replace(/""/g, '"')
    if (index === 0 && /^(url|origin|website)$/i.test(value)) continue
    const origin = normalizeOrganizationScanOrigin(value)
    if (!origin) issues.push({ line: index + 1, message: 'Use one public website origin, without a path, credentials, query or custom port.' })
    else if (targets.has(origin)) duplicateCount += 1
    else targets.add(origin)
  }
  if (targets.size > SCAN_TARGET_LIMIT) issues.push({ line: 0, message: 'A batch can contain at most 50 unique websites.' })
  if (!targets.size && !issues.length) issues.push({ line: 0, message: 'Add at least one website.' })
  return { targets: [...targets].sort(), duplicateCount, issues }
}

export const scanResultSchema = z.object({
  version: z.literal(2), score: z.number().min(0).max(100),
  checks: z.array(z.object({
    id: z.enum(Object.keys(SCAN_CHECK_COPY) as [string, ...string[]]), status: z.enum(['pass', 'warn', 'fail']),
  }).strict()).length(18).refine((checks) => new Set(checks.map((c) => c.id)).size === 18),
}).strict()
export const scanTargetSchema = z.object({
  // Stored failed targets must remain readable when public-suffix rules change.
  // Enforce a safe link shape here; execution performs the current full policy.
  id: z.uuid(), origin: z.string().max(263).regex(/^https?:\/\/([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/),
  state: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']), attempts: z.number().int().min(0).max(3),
  failure_code: z.enum(['unsafe_target', 'robots_denied', 'target_unavailable', 'network_error', 'expired', 'access_revoked', 'cancelled', 'attempts_exhausted']).nullable(),
  result: scanResultSchema.nullable(), elapsed_ms: z.number().int().min(0).max(60000),
  follow_up: z.boolean(), finished_at: z.string().nullable(),
})
const count = z.number().int().min(0).max(50)
export const scanBatchSchema = z.object({
  id: z.uuid(), org_id: z.uuid(), created_at: z.string(), expires_at: z.string(), cancelled: z.boolean(),
  total: count, queued: count, running: count, succeeded: count, failed: count, cancelled_targets: count,
  targets: z.array(scanTargetSchema).max(50),
})
export const scanWorkspaceSchema = z.object({
  batches: z.array(scanBatchSchema).max(20), used_today: z.number().int().min(0).max(250), can_submit: z.boolean(),
})
export const scanReceiptSchema = z.object({ batch_id: z.uuid(), replayed: z.boolean(), reserved: z.number().int().min(1).max(50) })
export type ScanBatch = z.infer<typeof scanBatchSchema>
export type ScanWorkspace = z.infer<typeof scanWorkspaceSchema>

export const SCAN_FAILURE_COPY: Record<string, string> = {
  unsafe_target: 'This target did not pass the public website safety checks.',
  robots_denied: 'The site’s crawl rules do not allow this scan.',
  target_unavailable: 'This target is unavailable under the current scan policy. Try again later.',
  network_error: 'The site could not be reached within the scan budget.',
  expired: 'The batch reached its execution time limit.',
  access_revoked: 'Scanning stopped because workspace access changed.',
  cancelled: 'Cancelled.', attempts_exhausted: 'The worker could not complete this target after three attempts.',
}

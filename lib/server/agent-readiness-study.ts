import 'server-only'
import { createHash, timingSafeEqual } from 'crypto'
import { safeFetch } from '../importer'
import { gatherSiteSignals, readBodyCapped } from './site-scan'
import { evaluateCrawlability } from '../crawlability'
import { buildScanResultRow } from './log-scan-result'
import { createAdminClient, hasSupabaseAdminEnv } from '../../utils/supabase/admin'
import { readBearerToken } from '../commerce/inbound-auth'
import { captureError, captureEvent } from '../observability'

/**
 * Agent-readiness study harness (Part 2 of the scan-persistence workstream).
 *
 * Sampling: OpenStreetMap via the public Overpass API. OSM is a neutral public
 * commons directory (not a marketing-selected list), the exact queries live in
 * this file so the sample is reproducible, and the metro set below is fixed in
 * advance. Chains are excluded via the presence of a brand tag; platform-hosted
 * links (Facebook pages, ordering platforms, link hubs) are excluded because
 * the study measures businesses' OWN websites. Both rules are stated in the
 * article's methodology and limitations.
 *
 * Politeness: before any page fetch, the harness fetches robots.txt and skips
 * the site entirely (status robots_excluded) if our user agent or the wildcard
 * group disallows '/'. The scan itself then runs through the same SSRF-guarded
 * gatherer as the public /scan with its honest scanner UA.
 *
 * Auth: the internal runner route authenticates a bearer token against a
 * sha256 stored in the service-role-only study_control table, so no deploy or
 * env change is needed to rotate or revoke it (update/delete the row).
 */

export const HARNESS_UA = 'NexezStudyBot/1.0 (+https://nexez.ai/scan; agent-readiness research)'

/** The robots token our politeness pre-check answers for (plus '*' groups). */
export const HARNESS_ROBOTS_TOKEN = 'nexez'

const SAFE_FETCH_OPTIONS = { timeoutMs: 6500, pinnedDns: true, standardPortsOnly: true } as const
const OVERPASS_FETCH_OPTIONS = { timeoutMs: 28000, pinnedDns: true, standardPortsOnly: true } as const
const ROBOTS_BYTE_CAP = 64 * 1024
const OVERPASS_BYTE_CAP = 4 * 1024 * 1024

export type StudyVertical = 'restaurants' | 'health' | 'home_trades' | 'personal_care' | 'retail'

/** OSM tag filters per vertical (Overpass QL selector fragments). */
export const STUDY_VERTICAL_FILTERS: Record<StudyVertical, string> = {
  restaurants: '["amenity"~"^(restaurant|cafe|fast_food)$"]',
  health: '["amenity"~"^(clinic|dentist|doctors)$"]',
  home_trades: '["craft"~"^(plumber|electrician|hvac|carpenter|painter|roofer)$"]',
  personal_care: '["shop"~"^(hairdresser|beauty|massage)$"]',
  retail: '["shop"~"^(clothes|shoes|jewelry|gift|books|furniture|florist|pet)$"]',
}

/** Fixed, region-diverse mid-size US metros (bbox: south, west, north, east). */
export const STUDY_METROS: Record<string, [number, number, number, number]> = {
  'columbus-oh': [39.83, -83.2, 40.15, -82.75],
  'raleigh-nc': [35.68, -78.8, 35.95, -78.45],
  'tucson-az': [32.06, -111.1, 32.35, -110.75],
  'spokane-wa': [47.6, -117.55, 47.75, -117.25],
  'grand-rapids-mi': [42.85, -85.8, 43.05, -85.5],
  'chattanooga-tn': [34.95, -85.4, 35.15, -85.15],
  'boise-id': [43.52, -116.35, 43.7, -116.1],
  'worcester-ma': [42.2, -71.9, 42.35, -71.7],
  'baton-rouge-la': [30.35, -91.25, 30.55, -91.0],
  'reno-nv': [39.45, -119.9, 39.6, -119.7],
  'des-moines-ia': [41.5, -93.75, 41.68, -93.5],
  'richmond-va': [37.45, -77.6, 37.62, -77.35],
}

/**
 * Hosts that indicate the tagged "website" is a platform page, not the
 * business's own site. The study measures own-site readiness, so these are
 * excluded (stated in the article's limitations).
 */
const PLATFORM_HOSTS = [
  'facebook.com',
  'm.facebook.com',
  'instagram.com',
  'linktr.ee',
  'yelp.com',
  'google.com',
  'goo.gl',
  'maps.app.goo.gl',
  'doordash.com',
  'ubereats.com',
  'grubhub.com',
  'opentable.com',
  'toasttab.com',
  'squareup.com',
  'order.online',
  'wa.me',
  'twitter.com',
  'x.com',
  'tiktok.com',
  'youtube.com',
  'linkedin.com',
]

/** Normalize an OSM website tag to a scannable origin + dedupe domain, or null. */
export function normalizeTargetWebsite(raw: string | null | undefined): { url: string; domain: string } | null {
  let value = (raw || '').trim()
  if (!value) return null
  // Reject foreign schemes BEFORE prefixing: 'mailto:x@y.com' would otherwise
  // become https://mailto:x@y.com and parse with the scheme as userinfo.
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^https?:\/\//i.test(value)) return null
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
  if (parsed.username || parsed.password) return null
  const host = parsed.hostname.toLowerCase()
  if (!host.includes('.')) return null
  const domain = host.replace(/^www\./, '')
  if (PLATFORM_HOSTS.some((platform) => domain === platform || domain.endsWith(`.${platform}`))) return null
  return { url: `${parsed.protocol}//${host}`, domain }
}

type RobotsRule = { allow: boolean; pattern: string }
type RobotsGroup = { agents: string[]; rules: RobotsRule[] }

function patternMatchLength(pattern: string, path: string): number {
  if (!pattern) return -1
  const anchored = pattern.endsWith('$')
  const source = (anchored ? pattern.slice(0, -1) : pattern)
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  try {
    return new RegExp(`^${source}${anchored ? '$' : ''}`).test(path)
      ? pattern.replace(/[*$]/g, '').length
      : -1
  } catch {
    return -1
  }
}

/**
 * Generic single-token robots evaluation for the harness's OWN fetching, with
 * the same group/specificity/longest-rule semantics as
 * lib/crawlability.parseRobotsForAgentBots (which is fixed to the AGENT_BOTS
 * list and scores the target site rather than gating our behavior).
 */
export function isPathAllowedByRobots(robotsTxt: string | null, userAgentToken: string, path = '/'): boolean {
  if (!robotsTxt || !robotsTxt.trim()) return true

  const groups: RobotsGroup[] = []
  let group: RobotsGroup | null = null
  let sawRule = false

  for (const rawLine of robotsTxt.split(/\r?\n/)) {
    const line = rawLine.split('#')[0]!.trim()
    if (!line) continue
    const separator = line.indexOf(':')
    if (separator === -1) continue
    const key = line.slice(0, separator).trim().toLowerCase()
    const value = line.slice(separator + 1).trim()

    if (key === 'user-agent') {
      if (!group || sawRule) {
        group = { agents: [], rules: [] }
        groups.push(group)
        sawRule = false
      }
      if (value) group.agents.push(value.toLowerCase())
      continue
    }

    if ((key === 'allow' || key === 'disallow') && group?.agents.length) {
      sawRule = true
      if (value) group.rules.push({ allow: key === 'allow', pattern: value })
    }
  }

  const token = userAgentToken.toLowerCase()
  const matching = groups
    .map((candidate) => ({
      candidate,
      specificity: Math.max(
        ...candidate.agents.map((agent) =>
          agent === '*' ? 0 : token === agent || token.startsWith(agent) ? agent.length : -1,
        ),
      ),
    }))
    .filter((entry) => entry.specificity >= 0)
  const mostSpecific = matching.length ? Math.max(...matching.map((entry) => entry.specificity)) : -1
  const rules = matching
    .filter((entry) => entry.specificity === mostSpecific)
    .flatMap((entry) => entry.candidate.rules)

  let winner: { allow: boolean; length: number } | null = null
  for (const rule of rules) {
    const length = patternMatchLength(rule.pattern, path)
    if (length < 0) continue
    if (!winner || length > winner.length || (length === winner.length && rule.allow)) {
      winner = { allow: rule.allow, length }
    }
  }
  return winner?.allow ?? true
}

type OverpassElement = { tags?: Record<string, string> }

/**
 * Extract eligible candidate sites from Overpass elements: must carry a
 * website (or contact:website) tag, must NOT be brand-tagged (chain exclusion),
 * and must normalize to a non-platform origin. Deduped by domain.
 */
export function extractOverpassCandidates(elements: OverpassElement[]): Array<{ url: string; domain: string }> {
  const byDomain = new Map<string, { url: string; domain: string }>()
  for (const element of elements) {
    const tags = element.tags || {}
    if (tags.brand || tags['brand:wikidata']) continue
    const normalized = normalizeTargetWebsite(tags.website || tags['contact:website'])
    if (!normalized) continue
    if (!byDomain.has(normalized.domain)) byDomain.set(normalized.domain, normalized)
  }
  return Array.from(byDomain.values())
}

/** Deterministic, seed-stable sample: order by sha256(cohort:domain), take cap. */
export function deterministicSample<T extends { domain: string }>(candidates: T[], cohort: string, cap: number): T[] {
  return [...candidates]
    .sort((a, b) => {
      const ha = createHash('sha256').update(`${cohort}:${a.domain}`).digest('hex')
      const hb = createHash('sha256').update(`${cohort}:${b.domain}`).digest('hex')
      return ha < hb ? -1 : ha > hb ? 1 : 0
    })
    .slice(0, Math.max(0, cap))
}

export function buildOverpassQuery(vertical: StudyVertical, bbox: [number, number, number, number]): string {
  const filter = STUDY_VERTICAL_FILTERS[vertical]
  const box = bbox.join(',')
  return [
    '[out:json][timeout:25];',
    '(',
    `nwr${filter}["website"](${box});`,
    `nwr${filter}["contact:website"](${box});`,
    ');',
    'out tags 600;',
  ].join('\n')
}

export type SeedResult = {
  ok: boolean
  metro: string
  vertical: StudyVertical
  elements: number
  eligible: number
  sampled: number
  inserted: number
  error?: string
}

/** Query Overpass for one metro x vertical cell and enqueue sampled targets. */
export async function seedStudyTargets(opts: {
  cohort: string
  metroKey: string
  vertical: StudyVertical
  cap?: number
}): Promise<SeedResult> {
  const { cohort, metroKey, vertical } = opts
  const cap = opts.cap ?? 14
  const base: SeedResult = { ok: false, metro: metroKey, vertical, elements: 0, eligible: 0, sampled: 0, inserted: 0 }
  const bbox = STUDY_METROS[metroKey]
  if (!bbox) return { ...base, error: `Unknown metro: ${metroKey}` }
  if (!hasSupabaseAdminEnv()) return { ...base, error: 'Admin env not configured' }

  try {
    const query = buildOverpassQuery(vertical, bbox)
    const res = await safeFetch(
      `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`,
      { headers: { 'User-Agent': HARNESS_UA, Accept: 'application/json' } },
      OVERPASS_FETCH_OPTIONS,
    )
    if (!res || !res.ok) return { ...base, error: `Overpass HTTP ${res?.status ?? 0}` }
    const text = await readBodyCapped(res, OVERPASS_BYTE_CAP)
    if (!text) return { ...base, error: 'Empty Overpass response' }
    const parsed = JSON.parse(text) as { elements?: OverpassElement[] }
    const elements = Array.isArray(parsed.elements) ? parsed.elements : []
    const eligible = extractOverpassCandidates(elements)
    const sampled = deterministicSample(eligible, cohort, cap)

    let inserted = 0
    if (sampled.length > 0) {
      const rows = sampled.map((candidate) => ({
        cohort,
        vertical,
        url: candidate.url,
        domain: candidate.domain,
        sample_source: `osm-overpass:${metroKey}`,
      }))
      const { data, error } = await createAdminClient()
        .from('study_targets')
        .upsert(rows, { onConflict: 'cohort,domain', ignoreDuplicates: true })
        .select('id')
      if (error) return { ...base, elements: elements.length, eligible: eligible.length, sampled: sampled.length, error: error.message }
      inserted = data?.length ?? 0
    }

    captureEvent('study.seed', { metro: metroKey, vertical, elements: elements.length, eligible: eligible.length, inserted })
    return { ok: true, metro: metroKey, vertical, elements: elements.length, eligible: eligible.length, sampled: sampled.length, inserted }
  } catch (error) {
    captureError(error, { route: 'agent-readiness-study', op: 'seed', metro: metroKey, vertical })
    return { ...base, error: error instanceof Error ? error.message : String(error) }
  }
}

type StudyTargetRow = {
  id: string
  cohort: string
  vertical: string
  url: string
  domain: string
  attempts: number
}

export type ScanBatchResult = {
  ok: boolean
  claimed: number
  done: number
  errors: number
  robotsExcluded: number
  error?: string
}

async function markTarget(
  targetId: string,
  status: 'done' | 'error' | 'robots_excluded',
  lastError: string | null,
): Promise<void> {
  const { error } = await createAdminClient()
    .from('study_targets')
    .update({ status, last_error: lastError, scanned_at: new Date().toISOString() })
    .eq('id', targetId)
  if (error) captureError(error, { route: 'agent-readiness-study', op: 'mark', targetId, status })
}

async function scanOneTarget(target: StudyTargetRow): Promise<'done' | 'error' | 'robots_excluded'> {
  try {
    // Politeness pre-check: honor the site's robots for OUR fetching before
    // touching the page. Unreachable/missing robots.txt implies allowed.
    let origin = target.url
    try {
      origin = new URL(target.url).origin
    } catch {
      await markTarget(target.id, 'error', 'Invalid target URL')
      return 'error'
    }
    const robotsRes = await safeFetch(
      `${origin}/robots.txt`,
      { headers: { 'User-Agent': HARNESS_UA } },
      SAFE_FETCH_OPTIONS,
    )
    if (robotsRes && robotsRes.ok) {
      const robotsTxt = await readBodyCapped(robotsRes, ROBOTS_BYTE_CAP)
      if (robotsTxt && !isPathAllowedByRobots(robotsTxt, HARNESS_ROBOTS_TOKEN)) {
        await markTarget(target.id, 'robots_excluded', null)
        return 'robots_excluded'
      }
    }

    const result = await gatherSiteSignals(target.url)
    if ('error' in result) {
      await markTarget(target.id, 'error', result.error)
      return 'error'
    }

    const report = evaluateCrawlability(result.signals)
    const row = buildScanResultRow({
      origin: result.origin,
      elapsedMs: result.elapsedMs,
      signals: result.signals,
      report,
      source: 'study',
      studyCohort: target.cohort,
      vertical: target.vertical,
    })
    if (!row) {
      await markTarget(target.id, 'error', 'Could not build result row')
      return 'error'
    }
    // Direct insert (not the fire-and-forget path): the target is only marked
    // done once its result row is confirmed persisted.
    const { error } = await createAdminClient().from('scan_results').insert(row)
    if (error) {
      await markTarget(target.id, 'error', `Persist failed: ${error.message}`)
      return 'error'
    }
    await markTarget(target.id, 'done', null)
    return 'done'
  } catch (error) {
    await markTarget(target.id, 'error', error instanceof Error ? error.message : String(error))
    return 'error'
  }
}

/** Claim and scan one polite batch. Concurrency 3 inside the invocation. */
export async function runStudyScanBatch(opts: { cohort: string; batchSize?: number }): Promise<ScanBatchResult> {
  const batchSize = Math.min(Math.max(opts.batchSize ?? 6, 1), 10)
  if (!hasSupabaseAdminEnv()) {
    return { ok: false, claimed: 0, done: 0, errors: 0, robotsExcluded: 0, error: 'Admin env not configured' }
  }

  const { data, error } = await createAdminClient().rpc('claim_study_targets', {
    batch_size: batchSize,
    cohort_filter: opts.cohort,
  })
  if (error) {
    captureError(error, { route: 'agent-readiness-study', op: 'claim' })
    return { ok: false, claimed: 0, done: 0, errors: 0, robotsExcluded: 0, error: error.message }
  }

  const targets = (data ?? []) as StudyTargetRow[]
  const outcomes: Array<'done' | 'error' | 'robots_excluded'> = []
  const queue = [...targets]
  const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
    for (let target = queue.shift(); target; target = queue.shift()) {
      outcomes.push(await scanOneTarget(target))
    }
  })
  await Promise.all(workers)

  const summary = {
    ok: true,
    claimed: targets.length,
    done: outcomes.filter((o) => o === 'done').length,
    errors: outcomes.filter((o) => o === 'error').length,
    robotsExcluded: outcomes.filter((o) => o === 'robots_excluded').length,
  }
  captureEvent('study.scan_batch', { cohort: opts.cohort, ...summary })
  return summary
}

/**
 * Authorize a study-runner request: bearer token sha256 must match the enabled
 * study_control row. Fail closed on any missing piece (no env, no row, no
 * token). Constant-time digest comparison.
 */
export async function authorizeStudyRequest(request: Request, controlKey = 'runner'): Promise<boolean> {
  const token = readBearerToken(request)
  if (!token || !hasSupabaseAdminEnv()) return false
  try {
    const { data } = await createAdminClient()
      .from('study_control')
      .select('token_sha256, enabled')
      .eq('key', controlKey)
      .maybeSingle<{ token_sha256: string | null; enabled: boolean }>()
    if (!data?.enabled || !data.token_sha256) return false
    const provided = createHash('sha256').update(token).digest()
    let expected: Buffer
    try {
      expected = Buffer.from(data.token_sha256, 'hex')
    } catch {
      return false
    }
    return provided.length === expected.length && timingSafeEqual(provided, expected)
  } catch (error) {
    captureError(error, { route: 'agent-readiness-study', op: 'auth' })
    return false
  }
}

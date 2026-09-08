import 'server-only'
import { getImportUrlError, getResolvedImportUrlError, safeFetch } from '../importer'
import { parseRobotsForAgentBots, type AgentBot, type CrawlabilitySignals } from '../crawlability'
import { readBodyCapped } from './read-body-capped'

export { readBodyCapped } from './read-body-capped'

export const SCAN_UA = 'NexezBot/1.0 (+https://nexez.ai/scan)'

export const HTML_BYTE_CAP = 512 * 1024
export const ROBOTS_BYTE_CAP = 64 * 1024
export const JSON_BYTE_CAP = 256 * 1024

export function stripHtmlToText(html: string, maxChars = 8000): string {
  const text = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(?:39|x27);/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > maxChars ? text.slice(0, maxChars) : text
}

export function normalizeScanUrl(input: string): string | null {
  let value = (input || '').trim()
  if (!value) return null
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`
  try {
    return new URL(value).toString()
  } catch {
    return null
  }
}

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function collectJsonNodes(value: unknown, output: JsonRecord[], depth = 0) {
  if (depth > 12 || output.length >= 1000) return
  if (Array.isArray(value)) {
    for (const item of value) collectJsonNodes(item, output, depth + 1)
    return
  }
  if (!isRecord(value)) return
  output.push(value)
  for (const child of Object.values(value)) collectJsonNodes(child, output, depth + 1)
}

function schemaTypes(node: JsonRecord): string[] {
  const raw = node['@type']
  const values = Array.isArray(raw) ? raw : raw ? [raw] : []
  return values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.split(/[\/#:]/).filter(Boolean).at(-1) || value)
}

const BUSINESS_TYPES = new Set([
  'Organization', 'Corporation', 'LocalBusiness', 'ProfessionalService', 'Store',
  'OnlineBusiness', 'FinancialService', 'HomeAndConstructionBusiness', 'MedicalBusiness',
  'LegalService', 'FoodEstablishment', 'TravelAgency', 'RealEstateAgent', 'EducationalOrganization',
])
const OFFER_TYPES = new Set(['Offer', 'AggregateOffer', 'Product', 'Service'])

export type StructuredEvidence = {
  hasJsonLd: boolean
  validJsonLd: boolean
  schemaTypes: string[]
  hasBusinessIdentity: boolean
  hasOfferSchema: boolean
  hasStructuredPrice: boolean
  hasStructuredAction: boolean
  hasStructuredAvailability: boolean
  hasOfferDetails: boolean
  hasStructuredContact: boolean
  hasStructuredPolicies: boolean
  dates: string[]
}

/** Parse bounded JSON-LD scripts and derive concrete schema evidence. */
export function extractStructuredEvidence(html: string): StructuredEvidence {
  const parsedRoots: unknown[] = []
  let scriptCount = 0
  const scripts = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi
  let match: RegExpExecArray | null
  while ((match = scripts.exec(html)) && scriptCount < 100) {
    const attributes = match[1] || ''
    if (!/\btype\s*=\s*(?:["']application\/ld\+json[^"']*["']|application\/ld\+json)/i.test(attributes)) continue
    scriptCount += 1
    const raw = (match[2] || '')
      .trim()
      .replace(/^<!--/, '')
      .replace(/-->$/, '')
      .replace(/^\/\*<!\[CDATA\[\*\//, '')
      .replace(/\/\*\]\]>\*\/$/, '')
      .trim()
    try {
      parsedRoots.push(JSON.parse(raw))
    } catch {
      // Presence and validity are reported separately.
    }
  }

  const nodes: JsonRecord[] = []
  for (const root of parsedRoots) collectJsonNodes(root, nodes)
  const types = Array.from(new Set(nodes.flatMap(schemaTypes)))
  const offerNodes = nodes.filter((node) => schemaTypes(node).some((type) => OFFER_TYPES.has(type)))
  const hasValue = (value: unknown) => value !== null && value !== undefined && String(value).trim() !== ''
  const hasAny = (node: JsonRecord, keys: string[]) => keys.some((key) => hasValue(node[key]))

  return {
    hasJsonLd: scriptCount > 0,
    validJsonLd: parsedRoots.length > 0,
    schemaTypes: types,
    hasBusinessIdentity: nodes.some((node) =>
      schemaTypes(node).some((type) => BUSINESS_TYPES.has(type) || type.endsWith('Business')) && hasValue(node.name),
    ),
    hasOfferSchema: offerNodes.length > 0,
    hasStructuredPrice: offerNodes.length > 0 && nodes.some((node) =>
      hasAny(node, ['price', 'lowPrice', 'highPrice', 'minPrice', 'maxPrice', 'priceRange']),
    ),
    hasStructuredAction: nodes.some((node) => {
      const isAction = schemaTypes(node).some((type) => type.endsWith('Action'))
      const isOffer = schemaTypes(node).some((type) => OFFER_TYPES.has(type))
      return (isAction && hasAny(node, ['target', 'url'])) || (isOffer && hasAny(node, ['url', 'potentialAction']))
    }),
    hasStructuredAvailability: nodes.some((node) =>
      hasAny(node, ['availability', 'availabilityStarts', 'availabilityEnds', 'openingHours', 'openingHoursSpecification', 'deliveryLeadTime']),
    ),
    hasOfferDetails: offerNodes.some((node) =>
      hasValue(node.name) && hasAny(node, ['description', 'serviceType', 'category', 'sku', 'itemOffered']),
    ),
    hasStructuredContact: nodes.some((node) =>
      hasAny(node, ['contactPoint', 'email', 'telephone', 'address', 'customerService']),
    ),
    hasStructuredPolicies: nodes.some((node) =>
      hasAny(node, ['hasMerchantReturnPolicy', 'merchantReturnPolicy', 'termsOfService', 'publishingPrinciples', 'refundType']),
    ),
    dates: nodes
      .flatMap((node) => ['dateModified', 'datePublished', 'uploadDate'].map((key) => node[key]))
      .filter((value): value is string => typeof value === 'string'),
  }
}

function hasRecentDate(values: Array<string | null | undefined>): boolean {
  const now = Date.now()
  const maxAge = 400 * 24 * 60 * 60 * 1000
  return values.some((value) => {
    if (!value) return false
    const time = Date.parse(value)
    return Number.isFinite(time) && time <= now + 24 * 60 * 60 * 1000 && now - time <= maxAge
  })
}

function hasActionLink(html: string): boolean {
  const anchors = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi
  let match: RegExpExecArray | null
  while ((match = anchors.exec(html))) {
    const href = match[1]?.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1]?.trim() || ''
    const label = stripHtmlToText(match[2] || '', 180)
    if (!href || href === '#' || /^javascript:/i.test(href)) continue
    if (/\b(buy|book|schedule|checkout|order|subscribe|request (?:a )?quote|get started|hire|apply|reserve|sign up|launch|deploy (?:your )?listing|list (?:your )?offers)\b/i.test(label)) return true
  }
  return /<form\b[^>]*\baction\s*=\s*["'][^"'#]+["']/i.test(html)
}

function recordLooksMeaningful(value: unknown, kind: 'agent' | 'agent-card' | 'mcp' | 'openapi'): boolean {
  if (!isRecord(value)) return false
  if (kind === 'openapi') return typeof value.openapi === 'string' && isRecord(value.paths)
  if (kind === 'agent-card') {
    return typeof value.name === 'string' && ['skills', 'capabilities', 'url'].some((key) => key in value)
  }
  if (kind === 'mcp') return ['servers', 'tools', 'resources', 'capabilities', 'pages', 'mcp'].some((key) => key in value)
  return typeof value.name === 'string' && ['offers', 'skills', 'capabilities', 'url', 'endpoints'].some((key) => key in value)
}

// maxRedirects is capped at 2 (so 3 hops) to keep the scan inside the route's
// 30s maxDuration. safeFetch gives EVERY hop its own fresh timeoutMs budget, so
// the library default of 4 allows 5 x 6500ms = 32.5s on the main page fetch
// alone, before the per-hop DNS safety checks. That overruns the function and
// the caller gets a platform timeout instead of the graceful error below.
// 3 hops is 19.5s, which still covers the usual http -> https -> www chain.
const SAFE_FETCH_OPTIONS = { timeoutMs: 6500, pinnedDns: true, standardPortsOnly: true, maxRedirects: 2 } as const

export type SiteScanOptions = {
  signal?: AbortSignal
  beforeRequest?: (url: string) => Promise<boolean>
  onBodyBytes?: (bytes: number) => void
}

function scanFetch(url: string, init: RequestInit, options: SiteScanOptions) {
  return safeFetch(url, { ...init, signal: options.signal }, { ...SAFE_FETCH_OPTIONS, beforeRequest: options.beforeRequest })
}

async function probeJson(url: string, kind: 'agent' | 'agent-card' | 'mcp' | 'openapi', options: SiteScanOptions): Promise<boolean> {
  const res = await scanFetch(
    url,
    { headers: { 'User-Agent': SCAN_UA, Accept: 'application/json' } },
    options,
  )
  if (!res || !res.ok) return false
  const text = await readBodyCapped(res, JSON_BYTE_CAP, options.onBodyBytes)
  if (!text) return false
  try {
    return recordLooksMeaningful(JSON.parse(text), kind)
  } catch {
    return false
  }
}

async function fetchCapped(url: string, maxBytes: number, options: SiteScanOptions): Promise<string | null> {
  const res = await scanFetch(url, { headers: { 'User-Agent': SCAN_UA } }, options)
  if (!res || !res.ok) return null
  const text = await readBodyCapped(res, maxBytes, options.onBodyBytes)
  return text && text.trim().length >= 20 ? text : null
}

async function fetchPage(url: string, options: SiteScanOptions): Promise<{ status: number; ms: number; html: string; lastModified: string | null; finalUrl: string }> {
  const started = Date.now()
  const res = await scanFetch(
    url,
    { headers: { 'User-Agent': SCAN_UA, Accept: 'text/html,application/xhtml+xml' } },
    options,
  )
  const ms = Date.now() - started
  if (!res) return { status: 0, ms, html: '', lastModified: null, finalUrl: url }
  const html = res.ok ? (await readBodyCapped(res, HTML_BYTE_CAP, options.onBodyBytes)) || '' : ''
  return { status: res.status, ms, html, lastModified: res.headers.get('last-modified'), finalUrl: res.url || url }
}

export type SiteSignalsResult = {
  url: string
  origin: string
  elapsedMs: number
  signals: CrawlabilitySignals
  robots: Record<AgentBot, boolean>
  /** Capped public page text for the gated LLM pass. Never returned by anonymous routes. */
  pageText: string
}

export async function gatherSiteSignals(rawUrl: string, options?: SiteScanOptions): Promise<SiteSignalsResult | { error: string }> {
  if (options) return gatherSiteSignalsWithOptions(rawUrl, options)
  const normalized = normalizeScanUrl(rawUrl)
  const invalid = normalized ? getImportUrlError(normalized) : 'A valid URL is required'
  if (invalid) return { error: invalid }
  // Every default caller (including deep scan, subscribe and owner checks)
  // shares the durable target limiter. Bulk workers supply their own lease.
  const { createScanNetworkContext } = await import('./scan-network')
  const network = createScanNetworkContext(crypto.randomUUID())
  try {
    const result = await gatherSiteSignalsWithOptions(rawUrl, network.options)
    network.assertFinished()
    return result
  } finally { await network.close() }
}

async function gatherSiteSignalsWithOptions(rawUrl: string, options: SiteScanOptions): Promise<SiteSignalsResult | { error: string }> {
  const url = normalizeScanUrl(rawUrl)
  if (!url) return { error: 'A valid URL is required' }

  const urlError = getImportUrlError(url) || await getResolvedImportUrlError(url, { useCache: false, failClosed: true })
  if (urlError) return { error: urlError }

  const parsedUrl = new URL(url)
  if (parsedUrl.port && !((parsedUrl.protocol === 'https:' && parsedUrl.port === '443') || (parsedUrl.protocol === 'http:' && parsedUrl.port === '80'))) {
    return { error: 'The scanner supports standard HTTP and HTTPS ports only.' }
  }

  const started = Date.now()
  // Resolve the canonical page first. Artifact probes must use the final origin,
  // otherwise a common apex-to-www redirect produces false missing-file results.
  const page = await fetchPage(url, options)
  const finalUrl = page.finalUrl
  const finalParsedUrl = new URL(finalUrl)
  const origin = finalParsedUrl.origin
  const [agentJsonOk, wellKnownAgentJsonOk, wellKnownAgentCardOk, mcpJsonOk, openApiJsonOk, llmsTxt, robotsTxt] = await Promise.all([
    probeJson(`${origin}/agent.json`, 'agent', options),
    probeJson(`${origin}/.well-known/agent.json`, 'agent', options),
    probeJson(`${origin}/.well-known/agent-card.json`, 'agent-card', options),
    probeJson(`${origin}/.well-known/mcp.json`, 'mcp', options),
    probeJson(`${origin}/openapi.json`, 'openapi', options),
    fetchCapped(`${origin}/llms.txt`, JSON_BYTE_CAP, options),
    fetchCapped(`${origin}/robots.txt`, ROBOTS_BYTE_CAP, options),
  ])

  const html = page.html
  const lower = html.toLowerCase()
  const visibleText = stripHtmlToText(html, 50_000)
  const structured = extractStructuredEvidence(html)
  const robots = parseRobotsForAgentBots(robotsTxt)
  const metaDate = html.match(/<meta[^>]+(?:property|name)=["'](?:article:modified_time|date|last-modified)["'][^>]+content=["']([^"']+)["']/i)?.[1]

  const signals: CrawlabilitySignals = {
    status: page.status,
    responseMs: page.ms,
    https: finalParsedUrl.protocol === 'https:',
    hasJsonLd: structured.hasJsonLd,
    validJsonLd: structured.validJsonLd,
    schemaTypes: structured.schemaTypes,
    hasTitle: /<title[\s>]/i.test(html),
    hasMetaDescription: /<meta[^>]+name=["']description["']/i.test(html),
    hasH1: /<h1[\s>]/i.test(html),
    hasBusinessIdentity: structured.hasBusinessIdentity,
    hasOfferSchema: structured.hasOfferSchema,
    hasStructuredPrice: structured.hasStructuredPrice,
    hasVisiblePrice: /(?:[$€£¥]\s?\d[\d,.]*|\b(?:USD|EUR|GBP|CAD|AUD|NGN|JPY)\s?\d[\d,.]*|\d[\d,.]*\s?(?:USD|EUR|GBP|CAD|AUD|NGN|JPY)\b)/i.test(visibleText),
    hasActionPath: hasActionLink(html),
    hasStructuredAction: structured.hasStructuredAction,
    hasStructuredAvailability: structured.hasStructuredAvailability,
    hasVisibleAvailability: /\b(book now|schedule|availability|available|in stock|shipping|delivery|appointment|opening hours|reserve)\b/i.test(visibleText),
    hasOfferDetails: structured.hasOfferDetails,
    hasContact: structured.hasStructuredContact || /(?:href=["'](?:mailto:|tel:)|href=["'][^"']*\/(?:contact|support)(?:[\/?#"']))/i.test(lower),
    hasPolicies: structured.hasStructuredPolicies || /href=["'][^"']*\/(?:privacy|terms|refund|returns?|cancellation)(?:[\/?#"'])/i.test(lower),
    hasFreshnessSignal: hasRecentDate([...structured.dates, metaDate, page.lastModified]),
    agentJsonOk,
    wellKnownAgentJsonOk,
    wellKnownAgentCardOk,
    mcpJsonOk,
    openApiJsonOk,
    llmsTxtOk: Boolean(llmsTxt),
    robots,
  }

  return {
    url: finalUrl,
    origin,
    elapsedMs: Date.now() - started,
    signals,
    robots,
    pageText: stripHtmlToText(html),
  }
}

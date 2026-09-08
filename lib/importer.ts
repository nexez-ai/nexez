/**
 * Nexez Site Importer (Phase 1 A - Production Grade)
 *
 * Robust, industry-aware, multi-page website analyzer.
 * Returns rich OfferItem[] ready for direct population of VisualOfferBuilder cards.
 *
 * Goals from ROADMAP:
 * - Multi-path parallel crawling (primary + common service/pricing paths)
 * - Strong schema.org + heuristic extraction with consumer fields (duration, mobile, area, travelFee)
 * - Industry-aware seeding + confidence scoring
 * - No data loss handoff to builder
 * - Abort/timeout safe, conservative to avoid rate limits
 */

import dns from 'node:dns/promises'
import { createHash } from 'node:crypto'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { Readable } from 'node:stream'
import { getReadinessScore, normalizeSlug, type FaqItem, type OfferItem } from './agent-page'
import { getIndustryBoostKeywords, industrySeeds } from './industry-catalog'
import { isLlmConfigured, llmCompleteDetailed, llmModel, llmProviderName, type LlmCompletionResult } from './llm'
import { readBodyCapped } from './server/read-body-capped'

/**
 * Phase 6: optional LLM fallback for ambiguous pages. Strips the page to text
 * and asks the model to extract offers as JSON. Dormant unless LLM_API_KEY is
 * set; always best-effort (returns [] on any failure).
 */
export type ImportGuidance = {
  industry?: string | null
  targetBuyer?: string | null
  desiredAction?: string | null
  offerFocus?: string | null
  notes?: string | null
  location?: string | null
  clarifyingAnswers?: ImportClarifyingAnswer[] | null
}

export type ImportClarifyingAnswer = {
  id?: string | null
  field?: string | null
  question: string
  answer: string
}

export type ImportSourceKind =
  | 'input_url'
  | 'common_path'
  | 'internal_link'
  | 'sitemap'
  | 'llms_txt'
  | 'agent_json'
  | 'schema_org'
  | 'heuristic'
  | 'shopify'
  | 'llm'
  | 'template'
  | 'guidance'

export type ImportSource = {
  url: string
  label: string
  type: ImportSourceKind
  method: string
}

export type ImportClarifyingQuestion = {
  id: string
  field: 'audience' | 'offers' | 'pricing' | 'action' | 'location' | 'contact'
  question: string
  why: string
}

export type ImportReadiness = {
  score: number
  strengths: string[]
  gaps: string[]
}

export type ImportEvidenceStatus = 'detected' | 'inferred' | 'suggested' | 'owner_confirmed'

export type ImportEvidence = {
  id: string
  field: string
  value: string
  sourceUrl: string
  sourceLabel: string
  sourceText: string
  method: string
  observedAt: string
  confidence: number
  status: ImportEvidenceStatus
}

export type ImportBusinessDetails = {
  name?: string | null
  description?: string | null
  email?: string | null
  phone?: string | null
  address?: string | null
  openingHours?: string[]
  actionLinks?: Array<{ label: string; url: string; kind: 'book' | 'buy' | 'quote' | 'contact' | 'other' }>
}

export type ImportTelemetry = {
  importerVersion: string
  cacheHit: boolean
  durationMs: number
  pagesConsidered: number
  pagesUsed: number
  sourceFingerprint: string
  extractionMethods: Record<string, number>
  skippedPages: Array<{ url: string; reason: 'robots' | 'fetch_failed' | 'duplicate' }>
}

export type ImportAiStatus = {
  configured: boolean
  attempted: boolean
  used: boolean
  status: 'deterministic' | 'structured_ai' | 'offer_ai' | 'fallback' | 'failed'
  provider: string
  model: string
  reason: string
  latencyMs?: number
  httpStatus?: number
}

type CrawledDoc = {
  url: string
  label: string
  type: 'html' | 'llms_txt' | 'agent_json'
  text: string
  html?: string
  sourceKind?: ImportSourceKind
}

type StructuredAiDraft = {
  title?: string
  description?: string
  audience?: string
  industry?: string
  location?: string
  cta_label?: string
  cta_url?: string
  offers?: OfferItem[]
  faqs?: FaqItem[]
  clarifyingQuestions?: ImportClarifyingQuestion[]
  reviewNotes?: string[]
}

type AiDraftAttempt = {
  draft: StructuredAiDraft | null
  completion?: LlmCompletionResult
  skippedReason?: string
  parseStatus?: 'parsed' | 'invalid_json' | 'no_usable_fields' | 'no_completion'
}

type AiOfferAttempt = {
  offers: OfferItem[]
  completion?: LlmCompletionResult
  skippedReason?: string
  parseStatus?: 'parsed' | 'invalid_json' | 'not_array' | 'no_completion'
}

function normalizeGuidance(input?: string | ImportGuidance | null): ImportGuidance {
  if (!input) return {}
  if (typeof input === 'string') return { industry: input }
  return {
    industry: input.industry?.trim() || null,
    targetBuyer: input.targetBuyer?.trim() || null,
    desiredAction: input.desiredAction?.trim() || null,
    offerFocus: input.offerFocus?.trim() || null,
    notes: input.notes?.trim() || null,
    location: input.location?.trim() || null,
    clarifyingAnswers: Array.isArray(input.clarifyingAnswers)
      ? input.clarifyingAnswers
          .map((item) => ({
            id: typeof item.id === 'string' ? item.id.trim().slice(0, 80) : null,
            field: typeof item.field === 'string' ? item.field.trim().slice(0, 40) : null,
            question: typeof item.question === 'string' ? item.question.trim().slice(0, 220) : '',
            answer: typeof item.answer === 'string' ? item.answer.trim().slice(0, 500) : '',
          }))
          .filter((item) => item.question && item.answer)
          .slice(0, 6)
      : null,
  }
}

function guidanceCacheKey(url: string, guidance: ImportGuidance, skipLlm: boolean): string {
  const key = {
    llm: !skipLlm && isLlmConfigured() ? `${llmProviderName()}:${llmModel()}` : 'deterministic',
    industry: guidance.industry || '',
    targetBuyer: guidance.targetBuyer || '',
    desiredAction: guidance.desiredAction || '',
    offerFocus: guidance.offerFocus || '',
    notes: guidance.notes || '',
    location: guidance.location || '',
    clarifyingAnswers: guidance.clarifyingAnswers?.map((item) => ({
      id: item.id || '',
      question: item.question,
      answer: item.answer,
    })) || [],
  }
  return `${IMPORTER_VERSION}:${normalizedImportCacheUrl(url)}::${JSON.stringify(key)}`
}

function formatClarifyingAnswers(guidance: ImportGuidance): string {
  const answers = guidance.clarifyingAnswers?.filter((item) => item.question && item.answer) || []
  return answers
    .map((item) => `Q: ${item.question}\nA: ${item.answer}`)
    .join('\n\n')
}

function combinedGuidanceNotes(guidance: ImportGuidance): string {
  return [guidance.notes || '', formatClarifyingAnswers(guidance)]
    .filter(Boolean)
    .join('\n\n')
    .trim()
}

function answerForField(guidance: ImportGuidance, field: string): string {
  return guidance.clarifyingAnswers?.find((item) => item.field === field && item.answer)?.answer || ''
}

function deterministicAiStatus(reason = 'LLM_API_KEY is not configured.'): ImportAiStatus {
  return {
    configured: isLlmConfigured(),
    attempted: false,
    used: false,
    status: 'deterministic',
    provider: llmProviderName(),
    model: llmModel(),
    reason,
  }
}

function aiStatusFromAttempt(
  attempt: AiDraftAttempt | AiOfferAttempt,
  status: ImportAiStatus['status'],
  used: boolean,
  fallbackReason: string,
): ImportAiStatus {
  const completion = attempt.completion
  const configured = completion?.configured ?? isLlmConfigured()
  const attempted = completion?.attempted ?? false
  const failed = completion && ['http_error', 'network_error'].includes(completion.status)
  const reason = used
    ? 'AI extraction returned usable structured data.'
    : attempt.skippedReason || completion?.error || fallbackReason

  return {
    configured,
    attempted,
    used,
    status: used ? status : failed ? 'failed' : 'fallback',
    provider: completion?.provider || llmProviderName(),
    model: completion?.model || llmModel(),
    reason,
    latencyMs: completion?.latencyMs,
    httpStatus: completion?.httpStatus,
  }
}

export async function llmExtractOffers(html: string, guidance?: string | ImportGuidance | null): Promise<OfferItem[]> {
  const result = await llmExtractOffersWithStatus(html, guidance)
  return result.offers
}

async function llmExtractOffersWithStatus(html: string, guidance?: string | ImportGuidance | null): Promise<AiOfferAttempt> {
  if (!isLlmConfigured()) return { offers: [], skippedReason: 'LLM_API_KEY is not configured.' }
  const context = normalizeGuidance(guidance)
  const userGuidance = combinedGuidanceNotes(context)
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 6000)
  if (text.length < 80) {
    return { offers: [], skippedReason: 'Page text was too short for AI extraction.' }
  }

  const completion = await llmCompleteDetailed(
    [
      'Extract the products or services this business offers from the page text below.',
      'Return ONLY a JSON array of objects with keys: name, price (string, "" if unknown), description (one sentence).',
      'Max 12 items. Do not invent offerings.',
      context.targetBuyer ? `Target buyer: ${context.targetBuyer}.` : '',
      context.offerFocus ? `Prioritize offers related to: ${context.offerFocus}.` : '',
      context.desiredAction ? `Preferred buyer action: ${context.desiredAction}.` : '',
      userGuidance ? `User guidance:\n${userGuidance}` : '',
      `Page text:\n${text}`,
    ].filter(Boolean).join('\n\n'),
    { system: 'You extract structured offer data from web pages for AI agents. Output strictly valid JSON, nothing else.', maxTokens: 1000, temperature: 0.2 },
  )
  if (!completion.text) return { offers: [], completion, parseStatus: 'no_completion' }
  try {
    const json = completion.text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
    const parsed = JSON.parse(json)
    if (!Array.isArray(parsed)) return { offers: [], completion, parseStatus: 'not_array' }
    const offers = parsed
      .filter((o) => o && typeof o.name === 'string' && o.name.trim())
      .slice(0, 12)
      .map((o) => ({
        name: String(o.name).trim().slice(0, 120),
        price: typeof o.price === 'string' ? o.price.slice(0, 40) : '',
        description: typeof o.description === 'string' ? o.description.slice(0, 300) : '',
        url: '',
        source: 'llm',
        confidence: 0.7,
      }))
    return { offers, completion, parseStatus: 'parsed' }
  } catch {
    return { offers: [], completion, parseStatus: 'invalid_json' }
  }
}

function extractJsonObject(value: string): string {
  const trimmed = value.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return trimmed
  return trimmed.slice(start, end + 1)
}

function toStringOrEmpty(value: unknown, max = 300): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

async function llmExtractDraftWithStatus(evidence: ImportEvidence[], guidance: ImportGuidance): Promise<AiDraftAttempt> {
  if (!isLlmConfigured()) return { draft: null, skippedReason: 'LLM_API_KEY is not configured.' }
  const userGuidance = combinedGuidanceNotes(guidance)

  const corpus = JSON.stringify(evidence.slice(0, 100).map((item) => ({
    id: item.id,
    field: item.field,
    value: item.value,
    source_url: item.sourceUrl,
    source_text: item.sourceText,
    method: item.method,
    status: item.status,
  })))

  if (corpus.length < 120) return { draft: null, skippedReason: 'Not enough page text for AI extraction.' }

  const prompt = [
    'Create a Nexez agent-page draft from the supplied business sources.',
    'Return ONLY strict JSON with this exact top-level shape:',
    '{"title":"","description":"","audience":"","industry":"","location":"","cta_label":"","cta_url":"","citations":{"title":["ev_id"],"description":["ev_id"],"audience":["ev_id"],"industry":["ev_id"],"location":["ev_id"],"cta_label":["ev_id"],"cta_url":["ev_id"]},"offers":[{"name":"","price":"","description":"","url":"","duration":"","serviceArea":"","isMobile":false,"travelFee":"","confidence":0.0,"evidence_ids":["ev_id"]}],"faqs":[{"question":"","answer":"","evidence_ids":["ev_id"]}],"clarifyingQuestions":[{"id":"","field":"audience|offers|pricing|action|location|contact","question":"","why":""}],"reviewNotes":[""]}',
    'Rules: every factual value and every offer must cite supplied evidence IDs. Do not cite an ID unless it supports the value. Do not invent offers, prices, URLs, locations, or contact details. Use exact source URLs from the evidence bundle. If uncertain, ask a clarifying question instead. Keep descriptions factual and one sentence.',
    guidance.targetBuyer ? `Target buyer: ${guidance.targetBuyer}` : '',
    guidance.desiredAction ? `Preferred action: ${guidance.desiredAction}` : '',
    guidance.offerFocus ? `Offer focus: ${guidance.offerFocus}` : '',
    userGuidance ? `User guidance and answered questions:\n${userGuidance}` : '',
    guidance.location ? `Known location/service area: ${guidance.location}` : '',
    `Evidence bundle:\n${corpus}`,
  ].filter(Boolean).join('\n\n')

  const completion = await llmCompleteDetailed(prompt, {
    system: 'You extract complete structured business drafts for clean AI-agent-readable listings. Output valid JSON only.',
    maxTokens: 1800,
    temperature: 0.15,
  })

  if (!completion.text) return { draft: null, completion, parseStatus: 'no_completion' }

  try {
    const parsed = JSON.parse(extractJsonObject(completion.text)) as any
    const evidenceById = new Map(evidence.map((item) => [item.id, item]))
    const normalizeClaim = (value: unknown) => toStringOrEmpty(value, 800).toLowerCase().replace(/[^a-z0-9@+.$:/-]+/g, ' ').replace(/\s+/g, ' ').trim()
    const citedItems = (ids: unknown): ImportEvidence[] => Array.isArray(ids)
      ? ids.flatMap((id) => typeof id === 'string' && evidenceById.has(id) ? [evidenceById.get(id)!] : [])
      : []
    const supportsExactClaim = (value: unknown, cited: ImportEvidence[]) => {
      const claim = normalizeClaim(value)
      if (!claim) return false
      return cited.some((item) => normalizeClaim(`${item.value} ${item.sourceText}`).includes(claim))
    }
    const supportsClaim = (value: unknown, cited: ImportEvidence[]) => {
      if (supportsExactClaim(value, cited)) return true
      const stopWords = new Set(['a', 'an', 'and', 'are', 'as', 'at', 'for', 'from', 'in', 'is', 'of', 'on', 'or', 'the', 'to', 'with'])
      const claimTokens = normalizeClaim(value).split(' ').filter((token) => token.length > 2 && !stopWords.has(token))
      if (!claimTokens.length) return false
      const evidenceText = normalizeClaim(cited.map((item) => `${item.value} ${item.sourceText}`).join(' '))
      const supported = claimTokens.filter((token) => evidenceText.includes(token)).length
      return supported / claimTokens.length >= 0.5
    }
    const citations = parsed.citations && typeof parsed.citations === 'object' ? parsed.citations : {}
    const citedString = (field: string, value: unknown, max: number, requireExact = false) => {
      const text = toStringOrEmpty(value, max)
      const cited = citedItems(citations[field])
      if (!text || !cited.length) return ''
      if (requireExact ? !supportsExactClaim(text, cited) : !supportsClaim(text, cited)) return ''
      return text
    }
    const allowedUrls = new Set<string>()
    for (const item of evidence) {
      for (const candidate of [item.value, item.sourceUrl]) {
        try {
          const parsedUrl = new URL(candidate)
          if (['http:', 'https:', 'mailto:', 'tel:'].includes(parsedUrl.protocol)) allowedUrls.add(parsedUrl.toString())
        } catch {}
      }
    }
    const offers = Array.isArray(parsed.offers)
      ? parsed.offers
          .filter((offer: any) => {
            if (!offer || typeof offer.name !== 'string' || !offer.name.trim()) return false
            const cited = citedItems(offer.evidence_ids)
            if (!cited.length || !supportsExactClaim(offer.name, cited)) return false
            if (offer.price && !/^(?:custom|unknown|see options)$/i.test(offer.price) && !supportsExactClaim(offer.price, cited)) return false
            if (offer.description && !supportsClaim(offer.description, cited)) return false
            if (offer.duration && !supportsExactClaim(offer.duration, cited)) return false
            if (offer.serviceArea && !supportsExactClaim(offer.serviceArea, cited)) return false
            if (offer.travelFee && !supportsExactClaim(offer.travelFee, cited)) return false
            if (offer.url) {
              try {
                if (!allowedUrls.has(new URL(offer.url).toString())) return false
              } catch {
                return false
              }
            }
            return true
          })
          .slice(0, 12)
          .map((offer: any) => {
            const cited = citedItems(offer.evidence_ids)
            const citedSource = cited[0]
            const source = sourceFor(citedSource.sourceUrl, 'llm', 'Structured AI extraction with citations', citedSource.sourceLabel)
            return withProvenance({
              name: toStringOrEmpty(offer.name, 120),
              price: toStringOrEmpty(offer.price, 60) || 'Custom',
              description: toStringOrEmpty(offer.description, 260) || toStringOrEmpty(offer.name, 120),
              url: toStringOrEmpty(offer.url, 500) || source.url,
              duration: toStringOrEmpty(offer.duration, 60) || undefined,
              serviceArea: toStringOrEmpty(offer.serviceArea, 90) || undefined,
              isMobile: typeof offer.isMobile === 'boolean' ? offer.isMobile : undefined,
              travelFee: toStringOrEmpty(offer.travelFee, 60) || undefined,
              confidence: typeof offer.confidence === 'number' ? Math.min(Math.max(offer.confidence, 0.4), 0.96) : 0.78,
              source: 'llm',
              metadata: { evidenceIds: cited.map((item) => item.id), evidenceText: cited.map((item) => item.sourceText).join(' ').slice(0, 600) },
            }, source, 0)
          })
      : []

    const faqs = Array.isArray(parsed.faqs)
      ? parsed.faqs
          .filter((faq: any) => {
            const cited = citedItems(faq?.evidence_ids)
            return faq && typeof faq.question === 'string' && typeof faq.answer === 'string' && cited.length > 0
              && supportsExactClaim(faq.question, cited) && supportsExactClaim(faq.answer, cited)
          })
          .slice(0, 5)
          .map((faq: any) => ({
            question: toStringOrEmpty(faq.question, 140),
            answer: toStringOrEmpty(faq.answer, 320),
          }))
      : []

    const clarifyingQuestions = Array.isArray(parsed.clarifyingQuestions)
      ? parsed.clarifyingQuestions
          .filter((question: any) => question && typeof question.question === 'string')
          .slice(0, 4)
          .map((question: any, index: number) => ({
            id: toStringOrEmpty(question.id, 40) || `ai-question-${index + 1}`,
            field: ['audience', 'offers', 'pricing', 'action', 'location', 'contact'].includes(question.field) ? question.field : 'offers',
            question: toStringOrEmpty(question.question, 180),
            why: toStringOrEmpty(question.why, 220) || 'This would improve import accuracy.',
          } as ImportClarifyingQuestion))
      : []

    const draft = {
      title: citedString('title', parsed.title, 120, true),
      description: citedString('description', parsed.description, 600),
      audience: citedString('audience', parsed.audience, 140),
      industry: citedString('industry', parsed.industry, 120),
      location: citedString('location', parsed.location, 120, true),
      cta_label: citedString('cta_label', parsed.cta_label, 40),
      cta_url: (() => {
        const value = citedString('cta_url', parsed.cta_url, 500)
        if (!value) return ''
        try {
          const normalized = new URL(value).toString()
          return allowedUrls.has(normalized) ? normalized : ''
        } catch {
          return ''
        }
      })(),
      offers,
      faqs,
      clarifyingQuestions,
      reviewNotes: Array.isArray(parsed.reviewNotes)
        ? parsed.reviewNotes.filter((note: any) => typeof note === 'string').slice(0, 4)
        : [],
    }

    const hasUsableFields = Boolean(
      draft.title ||
      draft.description ||
      draft.audience ||
      draft.industry ||
      draft.location ||
      draft.cta_label ||
      draft.cta_url ||
      draft.offers?.length ||
      draft.faqs?.length ||
      draft.clarifyingQuestions?.length,
    )

    return hasUsableFields
      ? { draft, completion, parseStatus: 'parsed' }
      : { draft: null, completion, parseStatus: 'no_usable_fields' }
  } catch {
    return { draft: null, completion, parseStatus: 'invalid_json' }
  }
}

export type ImportResult = {
  title: string
  description: string
  website_url: string
  structuredOffers: (OfferItem & { confidence?: number })[]
  /** Starter ideas are never presented as facts detected on the source site. */
  suggestedOffers: (OfferItem & { confidence?: number })[]
  /** FAQ prompts that need owner confirmation before they become listing facts. */
  suggestedFaqs: FaqItem[]
  servicesText: string // legacy pipe format for compat during transition
  industry?: string | null
  audience?: string | null
  location?: string | null
  cta_label?: string
  cta_url?: string
  faqs?: FaqItem[]
  reviewNotes?: string[]
  confidence?: number
  sources?: ImportSource[]
  evidence: ImportEvidence[]
  businessDetails: ImportBusinessDetails
  telemetry: ImportTelemetry
  clarifyingQuestions?: ImportClarifyingQuestion[]
  readiness?: ImportReadiness
  aiStatus: ImportAiStatus
  pagesAnalyzed: number
  agentDocumentsAnalyzed: number
  logo_url?: string | null  // one-click logo detection for branding
}

const COMMON_PATHS = [
  '/services',
  '/service',
  '/pricing',
  '/products',
  '/product',
  '/shop',
  '/store',
  '/book',
  '/booking',
  '/appointments',
  '/schedule',
  '/rates',
  '/packages',
  '/contact',
  '/about',
  '/',
]
const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^0(?:\.0){0,3}$/,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^\[?::1\]?$/i,
  /^\[?fc[0-9a-f]{2}:/i,
  /^\[?fd[0-9a-f]{2}:/i,
  /^\[?fe80:/i,
]
const HOST_SAFETY_CACHE = new Map<string, { ts: number; error: string | null }>()
const HOST_SAFETY_TTL_MS = 5 * 60 * 1000
/** Distinguishes "we ran out of time" from "the lookup genuinely failed". */
const DNS_TIMEOUT_MARKER = 'DNS safety lookup timed out'

// Simple in-memory short-TTL cache (Phase 5 robustness). Avoids hammering the same site repeatedly.
const IMPORT_CACHE = new Map<string, { ts: number; result: ImportResult }>()
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes
const HTML_BYTE_CAP = 768 * 1024
const TEXT_BYTE_CAP = 256 * 1024
const JSON_BYTE_CAP = 1024 * 1024
const IMPORTER_VERSION = '2.0.0'

const SOURCE_CONFIDENCE: Record<ImportSourceKind, { base: number; cap: number }> = {
  input_url: { base: 0.64, cap: 0.78 },
  common_path: { base: 0.62, cap: 0.76 },
  internal_link: { base: 0.65, cap: 0.79 },
  sitemap: { base: 0.66, cap: 0.8 },
  llms_txt: { base: 0.74, cap: 0.88 },
  agent_json: { base: 0.88, cap: 0.98 },
  schema_org: { base: 0.84, cap: 0.96 },
  heuristic: { base: 0.52, cap: 0.72 },
  shopify: { base: 0.9, cap: 0.98 },
  llm: { base: 0.7, cap: 0.86 },
  template: { base: 0, cap: 0 },
  guidance: { base: 0.35, cap: 0.5 },
}

function normalizedImportCacheUrl(value: string): string {
  try {
    const url = new URL(value)
    url.hash = ''
    return url.toString()
  } catch {
    return value.trim()
  }
}

function getCached(url: string, guidance: ImportGuidance, skipLlm: boolean): ImportResult | null {
  const key = guidanceCacheKey(url, guidance, skipLlm)
  const hit = IMPORT_CACHE.get(key)
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.result
  return null
}
function setCached(url: string, guidance: ImportGuidance, skipLlm: boolean, result: ImportResult) {
  const key = guidanceCacheKey(url, guidance, skipLlm)
  IMPORT_CACHE.set(key, { ts: Date.now(), result })
  // crude size limit
  if (IMPORT_CACHE.size > 50) {
    const first = IMPORT_CACHE.keys().next().value
    if (first) IMPORT_CACHE.delete(first)
  }
}

export function getImportUrlError(value: string): string | null {
  let url: URL

  try {
    url = new URL(value)
  } catch {
    return 'Enter a valid website URL, including https://.'
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return 'Website URL must use HTTP or HTTPS.'
  }

  if (url.username || url.password) {
    return 'Website URL cannot include embedded credentials.'
  }

  const hostname = url.hostname.toLowerCase()
  if (PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(hostname))) {
    return 'Website URL cannot target localhost, private networks, or link-local addresses.'
  }

  if (!hostname.includes('.')) {
    return 'Website URL must use a public hostname.'
  }

  return null
}

export async function getResolvedImportUrlError(
  value: string,
  opts: { useCache?: boolean; failClosed?: boolean } = {},
): Promise<string | null> {
  const urlError = getImportUrlError(value)
  if (urlError) return urlError

  const hostname = new URL(value).hostname.toLowerCase()
  const directIp = net.isIP(hostname)
  if (directIp) {
    return isBlockedIpAddress(hostname) ? 'Website URL cannot target localhost, private networks, or link-local addresses.' : null
  }

  const useCache = opts.useCache !== false
  const cached = useCache ? HOST_SAFETY_CACHE.get(hostname) : undefined
  if (cached && Date.now() - cached.ts < HOST_SAFETY_TTL_MS) return cached.error

  let error: string | null = null
  let timedOut = false
  try {
    const records = await Promise.race([
      dns.lookup(hostname, { all: true }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(DNS_TIMEOUT_MARKER)), 1500)),
    ])
    if (records.some((record) => isBlockedIpAddress(record.address))) {
      error = 'Website URL resolved to a private or local network address.'
    }
  } catch (err) {
    // Two very different situations land here and conflating them misleads the
    // caller. A TIMEOUT usually means this process is busy: the guard is
    // uncached on the scan path and races a hard 1500ms budget, and dns.lookup
    // runs on the libuv threadpool, so concurrent scans queue behind it. A
    // genuine FAILURE usually means the domain really is gone. Reporting the
    // first as the second tells a real merchant their live site is broken.
    timedOut = err instanceof Error && err.message === DNS_TIMEOUT_MARKER
    if (!opts.failClosed) error = null
    else if (timedOut) error = 'Could not verify this website address in time. Please try again.'
    else error = 'This website address could not be resolved. Check the domain and try again.'
  }

  // Never cache a timeout. It is a statement about how busy we were, not about
  // the host, and caching it would keep answering with it for the whole TTL.
  if (useCache && !timedOut) {
    HOST_SAFETY_CACHE.set(hostname, { ts: Date.now(), error })
    if (HOST_SAFETY_CACHE.size > 100) {
      const first = HOST_SAFETY_CACHE.keys().next().value
      if (first) HOST_SAFETY_CACHE.delete(first)
    }
  }
  return error
}

function isBlockedIpAddress(address: string): boolean {
  const version = net.isIP(address)
  if (version === 4) return isBlockedIpv4(address)
  if (version === 6) return isBlockedIpv6(address)
  return PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(address.toLowerCase()))
}

function isBlockedIpv4(address: string): boolean {
  const [a, b, c] = address.split('.').map((part) => Number(part))
  if ([a, b, c].some((part) => Number.isNaN(part))) return true
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 192 && b === 0) return true
  if (a === 198 && (b === 18 || b === 19)) return true
  if (a === 198 && b === 51 && c === 100) return true
  if (a === 203 && b === 0 && c === 113) return true
  if (a >= 224) return true
  return false
}

function isBlockedIpv6(address: string): boolean {
  const normalized = address.toLowerCase()
  // An IPv4-mapped/compatible IPv6 (`::ffff:169.254.169.254`, its hex form
  // `::ffff:a9fe:a9fe`, or the deprecated `::a.b.c.d`) must be judged by the
  // embedded v4 - otherwise a DNS name resolving to a mapped-IPv6 slips the v6
  // prefix checks below and reaches a private/link-local target (SSRF).
  const embedded = embeddedIpv4(normalized)
  if (embedded) return isBlockedIpv4(embedded)

  return normalized === '::1'
    || normalized === '::'
    || normalized.startsWith('fc')
    || normalized.startsWith('fd')
    || normalized.startsWith('fe8')
    || normalized.startsWith('fe9')
    || normalized.startsWith('fea')
    || normalized.startsWith('feb')
}

/** Decode the IPv4 embedded in a v4-mapped/compatible IPv6, or null. */
function embeddedIpv4(normalized: string): string | null {
  // Dotted tail: `::ffff:1.2.3.4` / `::1.2.3.4`.
  const dotted = normalized.match(/^::(?:ffff:)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)
  if (dotted) return dotted[1]!
  // Hex form: `::ffff:aabb:ccdd` -> a.b.c.d.
  const hex = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (hex) {
    const hi = parseInt(hex[1]!, 16)
    const lo = parseInt(hex[2]!, 16)
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`
  }
  return null
}

// Basic robots.txt respect. Parsing stays conservative, but one import fetches
// robots only once and applies the same policy to every candidate path.
export function isPathAllowedByRobots(txt: string | null, path: string): boolean {
  if (!txt) return true
  const rules: Array<{ allow: boolean; path: string }> = []
  let inRelevant = false

  for (const rawLine of txt.split('\n')) {
    const line = rawLine.replace(/\s+#.*$/, '').trim()
    const separator = line.indexOf(':')
    if (separator < 0) continue
    const field = line.slice(0, separator).trim().toLowerCase()
    const value = line.slice(separator + 1).trim()
    if (field === 'user-agent') {
      const agent = value.toLowerCase()
      inRelevant = agent === '*' || agent.includes('nexez')
      continue
    }
    if (!inRelevant || (field !== 'allow' && field !== 'disallow') || !value) continue
    rules.push({ allow: field === 'allow', path: value.replace(/\$$/, '') })
  }

  const matches = rules
    .filter((rule) => path.startsWith(rule.path))
    .sort((a, b) => b.path.length - a.path.length)
  return matches[0]?.allow ?? true
}

export async function isPathAllowed(base: string, path: string): Promise<boolean> {
  try {
    const robotsUrl = normalizeUrl(base, '/robots.txt')
    const txt = await fetchTextSafe(robotsUrl, 4000)
    return isPathAllowedByRobots(txt, path)
  } catch {
    return true
  }
}

// Shopify-specific extraction (high value for user request)
async function tryExtractShopifyProducts(baseUrl: string): Promise<OfferItem[]> {
  const offers: OfferItem[] = []
  try {
    const u = new URL(baseUrl)
    // Common Shopify public endpoint (works on many public stores without auth)
    const shopifyUrl = `${u.origin}/products.json?limit=30`
    // SSRF-safe: validate the target + every redirect hop (a 30x to an internal
    // host must not be followed) before connecting / parsing the JSON body.
    const res = await safeFetchWithTransientRetry(
      shopifyUrl,
      { headers: { 'User-Agent': 'Nexez Site Importer Bot/1.0 (Shopify)', Accept: 'application/json' } },
      importerFetchOptions(5000),
    )
    if (!res || !res.ok) return []

    const body = await readBodyCapped(res, JSON_BYTE_CAP)
    if (!body) return []
    const data = JSON.parse(body)
    const products = data.products || data

    for (const p of products || []) {
      if (!p.title) continue
      const firstVariant = p.variants?.[0]
      const price = firstVariant?.price ? `$${parseFloat(firstVariant.price).toFixed(0)}` : 'See options'
      const desc = p.body_html ? p.body_html.replace(/<[^>]+>/g, ' ').trim().substring(0, 200) : (p.product_type || 'Shopify product')
      const url = p.handle ? `${u.origin}/products/${p.handle}` : baseUrl

      const offer: OfferItem = {
        name: p.title,
        description: desc,
        price,
        url,
        confidence: 0.88,
        availability: firstVariant?.available === false ? 'sold_out' : firstVariant?.available === true ? 'available' : undefined,
        metadata: {
          offerKind: 'product',
          currency: firstVariant?.price ? 'store currency' : undefined,
          evidenceText: JSON.stringify({
            title: p.title,
            handle: p.handle,
            product_type: p.product_type,
            variant: firstVariant ? { title: firstVariant.title, price: firstVariant.price, available: firstVariant.available } : null,
          }).slice(0, 600),
        },
      }

      // Variants as tiers if multiple
      if (p.variants && p.variants.length > 1) {
        offer.tiers = p.variants.slice(0, 4).map((v: any) => ({
          name: v.title || v.option1 || 'Option',
          price: v.price ? `$${parseFloat(v.price).toFixed(0)}` : 'Custom',
        }))
      }

      offers.push(offer)
    }
  } catch {
    // Silent fail - fall back to normal crawling
  }
  return offers
}

function normalizeUrl(base: string, path: string): string {
  try {
    if (path.startsWith('http')) return path
    const u = new URL(base)
    return path.startsWith('/') ? new URL(path, u.origin).toString() : new URL(path, u).toString()
  } catch {
    return base
  }
}

function extractPrice(text: string): string | null {
  return extractPrices(text)[0] || null
}

function extractPrices(text: string): string[] {
  const matches = text.match(
    /(?:[$€£¥]\s?\d[\d,]*(?:\.\d{1,2})?|\b(?:USD|EUR|GBP|CAD|AUD|JPY)\s?\d[\d,]*(?:\.\d{1,2})?|\b\d[\d,]*(?:\.\d{1,2})?\s?(?:USD|EUR|GBP|CAD|AUD|JPY|dollars?|euros?|pounds?|cents?)\b|\b\d+(?:\.\d+)?\s?¢|\b(?:starting at|starts at|from)\s+\d[\d,]*(?:\.\d{1,2})?\b)/gi,
  ) || []
  const seen = new Set<string>()
  return matches.map((match) => match.trim()).filter((match) => {
    const key = match.toLowerCase().replace(/\s+/g, '')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function extractDuration(text: string): string | null {
  const m = text.match(/(\d+)\s*(min|minute|minutes|hr|hour|hours|day|days|week|weeks)\b/i)
  if (m) return `${m[1]} ${m[2].toLowerCase().replace(/s$/, '')}`
  const range = text.match(/(\d+)\s*[-–]\s*(\d+)\s*(min|minute|hr|hour|day|week)/i)
  if (range) return `${range[1]}-${range[2]} ${range[3].toLowerCase().replace(/s$/, '')}`
  return null
}

function extractIsMobile(text: string): boolean {
  const t = text.toLowerCase()
  return /mobile|at (your )?(home|location|door)|we come to you|on.?site|travel to|in.?studio or mobile|comes to you/.test(t)
}

function extractServiceArea(text: string): string | null {
  const locality = extractNamedLocality(text)
  if (locality) return locality
  const m = text.match(/(serving|service area|available in|throughout|greater|metro)\s+([A-Za-z0-9 ,.-]{3,40})/i)
  if (m) {
    const value = m[0].trim()
    if (!/\b(?:send|book|click|start|right team|learn|get your|sign up)\b/i.test(value)) return value
  }
  return null
}

function extractNamedLocality(text: string): string | null {
  const cityState = text.match(/\b([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){0,3},\s*(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|Texas|California|Florida|New York))\b/)
  if (cityState) return cityState[1]
  const localBuyer = text.match(/\b(?:in|for)\s+([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){0,2})\s+(?:service businesses|businesses|customers|clients)\b/)
  return localBuyer ? localBuyer[1] : null
}

function extractPrimaryServiceArea(html: string, pageUrl: string): string | null {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ''
  const description = metaContent(html, ['description', 'og:description']) || ''
  const headings = (html.match(/<h[12]\b[^>]*>[\s\S]*?<\/h[12]>/gi) || [])
    .slice(0, 8)
    .map((heading) => stripHtml(heading, 500))
    .join(' ')
  let path = ''
  try {
    path = decodeURIComponent(new URL(pageUrl).pathname.replace(/[\/_-]+/g, ' '))
  } catch {}
  return extractNamedLocality(decodeHtmlEntities(`${title} ${description} ${headings} ${path}`))
}

function extractTravelFee(text: string): string | null {
  const m = text.match(/travel fee[^\d$]*(\$?\d+(?:\.\d{2})?)/i)
  return m ? m[1] : null
}

function cleanName(text: string): string {
  return decodeHtmlEntities(text)
    .replace(/^(book|schedule|reserve|get|buy|purchase)\s+/i, '')
    .replace(/\s*(now|today|online|here)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 80)
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"',
  }
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    const lower = entity.toLowerCase()
    if (lower.startsWith('#x')) return String.fromCodePoint(Number.parseInt(lower.slice(2), 16))
    if (lower.startsWith('#')) return String.fromCodePoint(Number.parseInt(lower.slice(1), 10))
    return named[lower] || match
  })
}

function cleanTitle(title: string): string {
  return decodeHtmlEntities(title)
    .replace(/\s+[-|•]\s+(home|homepage|official site|services|pricing).*$/i, '')
    .replace(/\s+\|\s+.*$/i, '')
    .replace(/\s+-\s+.*$/i, '')
    .trim()
    .substring(0, 90) || 'Imported Business'
}

function ctaLabelForAction(action?: string | null): string {
  const a = (action || '').toLowerCase()
  if (a.includes('book') || a.includes('schedule') || a.includes('appointment')) return 'Book Now'
  if (a.includes('quote') || a.includes('proposal') || a.includes('estimate')) return 'Request Quote'
  if (a.includes('buy') || a.includes('checkout') || a.includes('purchase')) return 'Buy Now'
  if (a.includes('call') || a.includes('contact')) return 'Contact Sales'
  if (a.includes('lead') || a.includes('inquir')) return 'Send Inquiry'
  return 'Start Here'
}

function buildGuidedDescription(title: string, rawDescription: string, offers: OfferItem[], guidance: ImportGuidance): string {
  const business = cleanTitle(title)
  const buyer = guidance.targetBuyer || answerForField(guidance, 'audience') || 'buyers evaluating this business'
  const focus = guidance.offerFocus ? ` The listing emphasizes ${guidance.offerFocus}.` : ''
  const actionGuidance = guidance.desiredAction || answerForField(guidance, 'action')
  const action = actionGuidance ? ` Agents should guide qualified buyers toward ${actionGuidance.toLowerCase()}.` : ''
  const refinement = guidance.clarifyingAnswers?.length ? ' Refined with owner-provided context.' : ''
  const base = rawDescription && rawDescription.length > 40
    ? rawDescription.trim()
    : `${business} helps ${buyer} understand available offers, pricing, fit, and next steps.`

  const offerSignal = offers.length
    ? ` Includes ${offers.length} detected offer${offers.length === 1 ? '' : 's'} with structured details for agent parsing.`
    : ''

  return `${base}${focus}${action}${refinement}${offerSignal}`.replace(/\s+/g, ' ').trim().slice(0, 520)
}

function buildGuidedFaqs(title: string, offers: OfferItem[], guidance: ImportGuidance): FaqItem[] {
  const business = cleanTitle(title)
  const buyer = guidance.targetBuyer || answerForField(guidance, 'audience') || 'buyers'
  const actionLabel = ctaLabelForAction(guidance.desiredAction || answerForField(guidance, 'action'))
  const hasPricing = offers.some((offer) => !!offer.price)
  const primaryOffer = offers[0]?.name

  return [
    {
      question: 'Can an AI agent use this listing to understand what is offered?',
      answer: 'Yes. This listing is structured so agents can parse the business summary, offers, pricing, and next step without crawling the full marketing website.',
    },
    {
      question: `Who is ${business} best for?`,
      answer: `${business} is best for ${buyer}. Agents should match the buyer need against the listed offers before recommending the next step.`,
    },
    {
      question: `What should an agent do next?`,
      answer: `Use the "${actionLabel}" action when the buyer is ready. If fit is unclear, gather scope, budget, timeline, and contact details first.`,
    },
    ...(hasPricing
      ? [{
          question: 'Are listed prices exact?',
          answer: 'Prices are presented as fixed amounts, starting points, or custom quote signals. Agents should preserve the wording shown on each offer.',
        }]
      : []),
    ...(primaryOffer
      ? [{
          question: `Can agents recommend ${primaryOffer}?`,
          answer: `Yes, if the buyer request matches the offer description, timing, pricing, and service area shown on this listing.`,
        }]
      : []),
  ].slice(0, 5)
}

function buildImportReadiness(input: {
  title: string
  description: string
  websiteUrl: string
  ctaUrl: string
  audience?: string | null
  industry?: string | null
  location?: string | null
  offers: OfferItem[]
  faqs: FaqItem[]
}): ImportReadiness {
  const baseScore = getReadinessScore({
    name: input.title,
    slug: normalizeSlug(input.title),
    description: input.description,
    website_url: input.websiteUrl,
    cta_url: input.ctaUrl,
    audience: input.audience || null,
    industry: input.industry || null,
    location: input.location || null,
    services: input.offers,
    products: [],
    faqs: input.faqs,
    is_published: true,
  })
  const highConfidenceOffers = input.offers.filter((offer) => (offer.confidence || 0) >= 0.72)
  const lowConfidenceOffers = input.offers.filter((offer) => (offer.confidence || 0) < 0.62)
  const integrityWarnings = input.offers.reduce((count, offer) => (
    count + (Array.isArray(offer.metadata?.integrityWarnings) ? offer.metadata.integrityWarnings.length : 0)
  ), 0)
  const qualityPenalty = input.offers.length
    ? Math.min(30, Math.ceil((lowConfidenceOffers.length / input.offers.length) * 18) + (integrityWarnings * 6))
    : 0
  const score = Math.max(0, baseScore - qualityPenalty)

  const strengths = [
    input.title ? 'Business name detected.' : '',
    input.description ? 'Agent-readable summary generated.' : '',
    highConfidenceOffers.length ? `${highConfidenceOffers.length} high-confidence offer${highConfidenceOffers.length === 1 ? '' : 's'} verified.` : '',
    input.offers.length && !highConfidenceOffers.length ? `${input.offers.length} offer candidate${input.offers.length === 1 ? '' : 's'} ready for review.` : '',
    input.faqs.length ? 'FAQs prepared for agent parsing.' : '',
    input.ctaUrl ? 'Primary action URL available.' : '',
  ].filter(Boolean)

  const gaps = [
    !input.audience ? 'Add the best-fit buyer.' : '',
    !input.industry ? 'Confirm the industry.' : '',
    !input.location ? 'Add location or service area.' : '',
    !input.offers.length ? 'Add at least one service or product.' : '',
    lowConfidenceOffers.length ? `Review ${lowConfidenceOffers.length} low-confidence offer${lowConfidenceOffers.length === 1 ? '' : 's'} before publishing.` : '',
    integrityWarnings ? 'Resolve conflicting offer names, prices, or action links.' : '',
    input.offers.some((offer) => !offer.price || /custom|unknown|see/i.test(offer.price)) ? 'Review pricing for custom or unknown offers.' : '',
    input.offers.some((offer) => !offer.url) ? 'Add direct booking, quote, or checkout links.' : '',
  ].filter(Boolean)

  return { score, strengths, gaps }
}

function buildClarifyingQuestions(
  guidance: ImportGuidance,
  offers: OfferItem[],
  readiness: ImportReadiness,
  aiQuestions: ImportClarifyingQuestion[] = [],
): ImportClarifyingQuestion[] {
  const questions: ImportClarifyingQuestion[] = []
  const add = (question: ImportClarifyingQuestion) => {
    if (!questions.some((existing) => existing.id === question.id || existing.question === question.question)) {
      questions.push(question)
    }
  }

  if (!guidance.targetBuyer) {
    add({
      id: 'target-buyer',
      field: 'audience',
      question: 'Who should AI agents recommend this listing to first?',
      why: 'A clear buyer profile improves offer matching and agent summaries.',
    })
  }

  if (!guidance.desiredAction) {
    add({
      id: 'preferred-action',
      field: 'action',
      question: 'Should agents book, request a quote, buy, or contact sales?',
      why: 'The preferred action controls the main CTA and agent instructions.',
    })
  }

  if (offers.length === 0) {
    add({
      id: 'missing-offers',
      field: 'offers',
      question: 'What are the main products or services buyers can purchase or book?',
      why: 'The website did not provide enough evidence to detect an offer safely.',
    })
  }

  if (offers.some((offer) => !offer.price || /custom|unknown|see/i.test(offer.price))) {
    add({
      id: 'pricing-clarity',
      field: 'pricing',
      question: 'Which imported offers need exact prices, starting prices, or custom quote language?',
      why: 'Agents need pricing clarity to compare options and route buyers correctly.',
    })
  }

  if (offers.length > 5) {
    add({
      id: 'featured-offers',
      field: 'offers',
      question: 'Which 2-3 offers should be featured first for agents?',
      why: 'Prioritizing offers keeps the public agent listing easier to parse.',
    })
  }

  if (readiness.gaps.some((gap) => gap.toLowerCase().includes('location'))) {
    add({
      id: 'service-area',
      field: 'location',
      question: 'What location or service area should agents mention?',
      why: 'Location helps agents avoid recommending unavailable services.',
    })
  }

  aiQuestions.forEach(add)
  return questions.slice(0, 5)
}

function applyGuidanceToOffers(offers: OfferItem[], guidance: ImportGuidance, fallbackUrl: string): OfferItem[] {
  const focus = guidance.offerFocus?.toLowerCase()
  const location = guidance.location || answerForField(guidance, 'location')

  return offers.map((offer) => {
    const focusBoost = focus && `${offer.name} ${offer.description || ''}`.toLowerCase().includes(focus) ? 0.05 : 0

    return {
      ...offer,
      description: summarizeOfferDescription(offer, guidance),
      url: offer.url || fallbackUrl,
      serviceArea: offer.serviceArea || location || undefined,
      confidence: Math.min(0.98, (offer.confidence || 0.72) + focusBoost),
    }
  })
}

function summarizeOfferDescription(offer: OfferItem, guidance: ImportGuidance, maxLength = 260): string {
  const raw = normalizeSummaryText(offer.description || '')
  const sentences = raw
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 24 && !isLowValueSummarySentence(sentence))

  const base = sentences.slice(0, 2).join(' ') || fallbackOfferSummary(offer)
  const details = [
    offer.duration ? `${offer.duration}.` : '',
    offer.serviceArea ? `Available in ${offer.serviceArea}.` : '',
    offer.isMobile ? 'Mobile service available.' : '',
    offer.travelFee ? `Travel fee: ${offer.travelFee}.` : '',
  ].filter(Boolean)

  const additions = [
    ...details,
    guidance.targetBuyer && !/best for/i.test(base) ? `Best for ${guidance.targetBuyer.toLowerCase()}.` : '',
    guidance.desiredAction && !/(book|request|buy|purchase|schedule|quote)/i.test(base)
      ? `Next step: ${ctaLabelForAction(guidance.desiredAction).toLowerCase()}.`
      : '',
  ].filter(Boolean)

  let summary = base
  for (const addition of additions) {
    const candidate = `${summary.replace(/[.\s]+$/, '')}. ${addition}`
    if (candidate.length <= maxLength) summary = candidate
  }

  return clampSummary(summary, maxLength)
}

function normalizeSummaryText(value: string): string {
  return value
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\b(menu|home|about|contact|privacy policy|terms|learn more|read more|click here)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isLowValueSummarySentence(value: string): boolean {
  const lower = value.toLowerCase()
  if (/^(book|schedule|buy|contact|learn|read|click)\b/.test(lower)) return true
  if ((lower.match(/\b(book|schedule|buy|contact|learn more|read more)\b/g) || []).length >= 3) return true
  return lower.length < 24
}

function fallbackOfferSummary(offer: OfferItem): string {
  const parts = [
    offer.name,
    offer.price ? `priced at ${offer.price}` : 'with clear scope and next-step action',
  ]
  return `${parts.join(' ')}.`
}

function clampSummary(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized

  const clipped = normalized.slice(0, maxLength - 3)
  const sentenceBreak = Math.max(clipped.lastIndexOf('. '), clipped.lastIndexOf('? '), clipped.lastIndexOf('! '))
  const wordBreak = clipped.lastIndexOf(' ')
  const end = sentenceBreak > 80 ? sentenceBreak + 1 : wordBreak > 80 ? wordBreak : clipped.length
  return `${clipped.slice(0, end).trim().replace(/[.,;:\s]+$/, '')}...`
}

type SafeFetchOptions = {
  maxRedirects?: number
  timeoutMs?: number
  /** Resolve and connect to the same validated public IP, closing DNS-rebinding TOCTOU. */
  pinnedDns?: boolean
  /** Scanner posture: permit only the conventional public web ports. */
  standardPortsOnly?: boolean
  /** Scanner policy and shared pressure gate, evaluated for every redirect hop. */
  beforeRequest?: (url: string) => Promise<boolean>
}

function importerFetchOptions(timeoutMs: number, maxRedirects = 2): SafeFetchOptions {
  return {
    timeoutMs,
    maxRedirects,
    standardPortsOnly: true,
    // Unit tests stub the web fetch boundary. Production pins the socket to the
    // exact public DNS result so validation and connection cannot disagree.
    pinnedDns: process.env.NODE_ENV !== 'test',
  }
}

function standardWebPort(url: URL): boolean {
  if (!url.port) return true
  return (url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')
}

/**
 * GET/HEAD transport for anonymous scanners. DNS is resolved once, every answer
 * is checked, and the socket connects directly to the selected public IP while
 * retaining the original Host header and TLS server name. This closes the gap
 * between a safety lookup and a later resolver lookup inside native fetch.
 */
async function fetchWithPinnedPublicDns(
  url: string,
  init: RequestInit,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<Response | null> {
  const target = new URL(url)
  const method = (init.method || 'GET').toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') return null

  let records: Array<{ address: string; family: number }>
  try {
    records = await Promise.race([
      dns.lookup(target.hostname, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => {
        if (signal.aborted) reject(new Error('Aborted'))
        else signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true })
      }),
    ])
  } catch {
    return null
  }

  if (!records.length || records.some((record) => isBlockedIpAddress(record.address))) return null
  const selected = records.find((record) => record.family === 4) || records[0]!
  const requestHeaders: Record<string, string> = {}
  new Headers(init.headers).forEach((value, key) => { requestHeaders[key] = value })
  requestHeaders.host = target.host
  requestHeaders['accept-encoding'] = 'identity'
  delete requestHeaders.connection
  delete requestHeaders['content-length']
  delete requestHeaders['transfer-encoding']

  return new Promise((resolve) => {
    const transport = target.protocol === 'https:' ? https : http
    const options: https.RequestOptions = {
      protocol: target.protocol,
      hostname: selected.address,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      path: `${target.pathname}${target.search}`,
      method,
      headers: requestHeaders,
      signal,
      ...(target.protocol === 'https:' && net.isIP(target.hostname) === 0 ? { servername: target.hostname } : {}),
    }

    const req = transport.request(options, (incoming) => {
      const clearLifetime = () => clearTimeout(lifetime)
      incoming.once('end', clearLifetime)
      incoming.once('close', clearLifetime)
      const responseHeaders = new Headers()
      for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
        responseHeaders.append(incoming.rawHeaders[index]!, incoming.rawHeaders[index + 1] || '')
      }
      const status = incoming.statusCode || 0
      const noBody = method === 'HEAD' || status === 204 || status === 205 || status === 304
      const body = noBody ? null : Readable.toWeb(incoming) as ReadableStream<Uint8Array>
      const response = new Response(body, { status, statusText: incoming.statusMessage, headers: responseHeaders })
      Object.defineProperty(response, 'url', { value: target.toString(), configurable: true })
      resolve(response)
    })
    const lifetime = setTimeout(() => req.destroy(new Error('Response lifetime exceeded')), timeoutMs)
    req.once('error', () => {
      clearTimeout(lifetime)
      resolve(null)
    })
    req.end()
  })
}

/**
 * SSRF-hardened fetch. Validates the target and follows redirects manually,
 * re-validating every hop. Scanner callers can additionally pin the socket to
 * the exact public DNS result to prevent DNS rebinding.
 */
export async function safeFetch(
  url: string,
  init: RequestInit = {},
  opts: SafeFetchOptions = {},
): Promise<Response | null> {
  const maxRedirects = opts.maxRedirects ?? 4
  const timeoutMs = opts.timeoutMs ?? 6500
  let current = url
  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (init.signal?.aborted) return null
    if (getImportUrlError(current)) return null
    const parsed = new URL(current)
    if (opts.standardPortsOnly && !standardWebPort(parsed)) return null
    if (opts.beforeRequest && !await opts.beforeRequest(current)) return null
    if (await getResolvedImportUrlError(current, { useCache: !opts.pinnedDns, failClosed: Boolean(opts.pinnedDns) })) return null
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const signal = init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal
    let res: Response
    try {
      const fetched = opts.pinnedDns
        ? await fetchWithPinnedPublicDns(current, { ...init, redirect: 'manual' }, signal, timeoutMs)
        : await fetch(current, { ...init, signal, redirect: 'manual' })
      if (!fetched) return null
      res = fetched
    } catch {
      return null
    } finally {
      clearTimeout(timer)
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) return res
      try {
        current = new URL(loc, current).toString()
      } catch {
        return null
      }
      try {
        await res.body?.cancel()
      } catch {
        // Redirect body may already be closed.
      }
      continue // re-validate the redirect target before connecting to it
    }
    return res
  }
  return null // redirect loop / too many hops
}

async function safeFetchWithTransientRetry(
  url: string,
  init: RequestInit,
  opts: SafeFetchOptions,
  retryNetworkFailure = false,
): Promise<Response | null> {
  const first = await safeFetch(url, init, opts)
  if (!first) return retryNetworkFailure ? safeFetch(url, init, opts) : null
  if (![429, 502, 503, 504].includes(first.status)) return first
  try {
    await first.body?.cancel()
  } catch {}
  return safeFetch(url, init, opts)
}

export async function fetchHtmlSafe(
  url: string,
  timeoutMs = 6500,
  opts: { retryNetworkFailure?: boolean } = {},
): Promise<string | null> {
  const res = await safeFetchWithTransientRetry(
    url,
    { headers: { 'User-Agent': 'Nexez Site Importer Bot/1.0 (Production)', Accept: 'text/html,application/xhtml+xml' } },
    importerFetchOptions(timeoutMs),
    opts.retryNetworkFailure,
  )
  if (!res || !res.ok) return null
  const html = await readBodyCapped(res, HTML_BYTE_CAP)
  if (html === null) return null
  return html.length > 50 ? html : null
}

async function fetchTextSafe(
  url: string,
  timeoutMs = 4500,
  opts: { retryNetworkFailure?: boolean } = {},
): Promise<string | null> {
  const res = await safeFetchWithTransientRetry(
    url,
    { headers: { 'User-Agent': 'Nexez Site Importer Bot/1.0 (Production)', Accept: 'text/plain,application/json,application/xml,text/xml' } },
    importerFetchOptions(timeoutMs),
    opts.retryNetworkFailure,
  )
  if (!res || !res.ok) return null
  const text = await readBodyCapped(res, TEXT_BYTE_CAP)
  if (text === null) return null
  return text.length > 20 ? text : null
}

function stripHtml(html: string, maxLength = 8000): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

function metaContent(html: string, keys: string[]): string | null {
  const expected = new Set(keys.map((key) => key.toLowerCase()))
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attributes = new Map<string, string>()
    for (const match of tag.matchAll(/([:\w-]+)\s*=\s*["']([^"']*)["']/g)) {
      attributes.set(match[1].toLowerCase(), match[2].trim())
    }
    const identity = (attributes.get('name') || attributes.get('property') || '').toLowerCase()
    const content = attributes.get('content')
    if (expected.has(identity) && content) return content
  }
  return null
}

function sourceFor(url: string, type: ImportSourceKind, method: string, label?: string): ImportSource {
  let sourceLabel = label
  if (!sourceLabel) {
    try {
      const u = new URL(url)
      sourceLabel = u.pathname === '/' ? 'Homepage' : u.pathname
    } catch {
      sourceLabel = url
    }
  }
  return { url, type, method, label: sourceLabel }
}

function withProvenance(offer: OfferItem, source: ImportSource, confidenceBoost = 0): OfferItem {
  const calibration = SOURCE_CONFIDENCE[source.type]
  const startingConfidence = typeof offer.confidence === 'number' ? offer.confidence : calibration.base
  return {
    ...offer,
    url: offer.url || source.url,
    source: offer.source || source.type,
    confidence: Math.min(calibration.cap, Math.max(0, startingConfidence + confidenceBoost)),
    metadata: {
      ...(offer.metadata || {}),
      provenance: source,
      evidenceStatus: source.type === 'template' ? 'suggested' : source.type === 'llm' ? 'inferred' : 'detected',
    },
  }
}

function makeEvidence(
  field: string,
  value: unknown,
  source: ImportSource,
  sourceText: string,
  confidence: number,
  status: ImportEvidenceStatus = 'detected',
): ImportEvidence | null {
  if (value === null || value === undefined || value === '') return null
  const normalizedValue = typeof value === 'string' ? value.trim() : String(value)
  if (!normalizedValue) return null
  const identity = `${field}\n${normalizedValue}\n${source.url}\n${source.method}`
  return {
    id: `ev_${createHash('sha256').update(identity).digest('hex').slice(0, 16)}`,
    field,
    value: normalizedValue.slice(0, 800),
    sourceUrl: source.url,
    sourceLabel: source.label,
    sourceText: sourceText.replace(/\s+/g, ' ').trim().slice(0, 600),
    method: source.method,
    observedAt: new Date().toISOString(),
    confidence: Math.max(0, Math.min(1, confidence)),
    status,
  }
}

function uniqueEvidence(values: Array<ImportEvidence | null>, max = 120): ImportEvidence[] {
  const byId = new Map<string, ImportEvidence>()
  for (const value of values) {
    if (!value) continue
    const existing = byId.get(value.id)
    if (!existing || value.confidence > existing.confidence) byId.set(value.id, value)
  }
  return Array.from(byId.values()).slice(0, max)
}

function calibratedOfferConfidence(offer: OfferItem, industryRelevant: boolean): number {
  const provenance = offer.metadata?.provenance as ImportSource | undefined
  const sourceType = provenance?.type || (offer.source as ImportSourceKind | undefined) || 'heuristic'
  const calibration = SOURCE_CONFIDENCE[sourceType] || SOURCE_CONFIDENCE.heuristic
  if (sourceType === 'template') return 0

  const explicitPrice = Boolean(offer.price && !/custom|unknown|see|confirm/i.test(offer.price))
  const detailedDescription = (offer.description?.length || 0) >= 40
  const directAction = Boolean(offer.url && provenance?.url && offer.url !== provenance.url)
  const detailBoost = (explicitPrice ? 0.025 : 0)
    + (detailedDescription ? 0.02 : 0)
    + (offer.duration ? 0.015 : 0)
    + (directAction ? 0.015 : 0)
    + (industryRelevant ? 0.025 : 0)
  const startingConfidence = typeof offer.confidence === 'number' ? offer.confidence : calibration.base
  return Math.min(calibration.cap, Math.max(0.2, startingConfidence + detailBoost))
}

async function mapWithConcurrency<T, R>(
  values: T[],
  limit: number,
  task: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!values.length) return []
  const output = new Array<R>(values.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(Math.max(1, limit), values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor
      cursor += 1
      output[index] = await task(values[index], index)
    }
  })
  await Promise.all(workers)
  return output
}

function uniqueUrls(values: string[], max = 14): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    try {
      const u = new URL(value)
      u.hash = ''
      for (const key of Array.from(u.searchParams.keys())) {
        if (/^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$)/i.test(key)) u.searchParams.delete(key)
      }
      u.searchParams.sort()
      const key = u.toString().replace(/\/$/, '')
      if (!seen.has(key)) {
        seen.add(key)
        out.push(u.toString())
      }
    } catch {}
    if (out.length >= max) break
  }
  return out
}

function canonicalUrlKey(value: string): string {
  return uniqueUrls([value], 1)[0]?.replace(/\/$/, '') || value
}

function contentFingerprint(html: string): string {
  // Keep structured data in the identity. Two visually similar pages can carry
  // different JSON-LD offers, so a text-only hash would discard real evidence.
  const normalized = html.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 100_000)
  return createHash('sha256').update(normalized).digest('hex')
}

function pathRelevanceScore(value: string, guidance: ImportGuidance): number {
  try {
    const u = new URL(value)
    const path = `${u.pathname} ${u.search}`.toLowerCase()
    const focus = guidance.offerFocus?.toLowerCase().split(/[\s,]+/).filter(Boolean) || []
    let score = 0
    if (/service|offer|pricing|price|rates|package|product|shop|store|book|booking|appointment|schedule|checkout|quote|proposal|contact/.test(path)) score += 5
    if (/blog|article|press|privacy|terms|careers|login|cart|tag|category|author/.test(path)) score -= 4
    for (const word of focus) {
      if (word.length > 2 && path.includes(word)) score += 2
    }
    return score
  } catch {
    return 0
  }
}

function comparableHostname(value: string): string {
  return value.toLowerCase().replace(/^www\./, '')
}

function isSameSiteUrl(baseUrl: string, candidateUrl: string): boolean {
  try {
    return comparableHostname(new URL(baseUrl).hostname) === comparableHostname(new URL(candidateUrl).hostname)
  } catch {
    return false
  }
}

function xmlLocations(xml: string): string[] {
  return Array.from(xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi))
    .map((match) => match[1].trim().replace(/&amp;/gi, '&'))
}

function robotsSitemapUrls(robotsTxt: string | null): string[] {
  if (!robotsTxt) return []
  return robotsTxt
    .split('\n')
    .map((line) => line.replace(/\s+#.*$/, '').trim())
    .filter((line) => /^sitemap\s*:/i.test(line))
    .map((line) => line.slice(line.indexOf(':') + 1).trim())
    .filter(Boolean)
}

async function discoverSitemapUrls(baseUrl: string, guidance: ImportGuidance, robotsTxt: string | null): Promise<string[]> {
  const queue = uniqueUrls([
    ...robotsSitemapUrls(robotsTxt),
    normalizeUrl(baseUrl, '/sitemap.xml'),
    normalizeUrl(baseUrl, '/sitemap_index.xml'),
    normalizeUrl(baseUrl, '/wp-sitemap.xml'),
  ], 8).filter((value) => isSameSiteUrl(baseUrl, value))
  const visited = new Set<string>()
  const pages: Array<{ value: string; score: number }> = []

  while (queue.length > 0 && visited.size < 6) {
    const batch: string[] = []
    while (queue.length > 0 && visited.size + batch.length < 6) {
      const sitemapUrl = queue.shift()!
      if (!visited.has(sitemapUrl) && !batch.includes(sitemapUrl)) batch.push(sitemapUrl)
    }
    batch.forEach((value) => visited.add(value))
    const responses = await mapWithConcurrency(batch, 3, (sitemapUrl) => (
      fetchTextSafe(sitemapUrl, 3500, { retryNetworkFailure: true })
    ))

    for (const response of responses) {
      if (!response) continue
      for (const value of xmlLocations(response)) {
        if (!isSameSiteUrl(baseUrl, value)) continue
        const looksLikeSitemap = /(?:sitemap|wp-sitemap).*\.xml(?:\.gz)?(?:$|\?)/i.test(value)
        if (looksLikeSitemap && visited.size + queue.length < 6) {
          queue.push(value)
          continue
        }
        const score = pathRelevanceScore(value, guidance)
        if (score > 0) pages.push({ value, score })
      }
    }
  }

  return uniqueUrls(
    pages.sort((a, b) => b.score - a.score).map((item) => item.value),
    10,
  )
}

function discoverInternalUrls(html: string, baseUrl: string, guidance: ImportGuidance): string[] {
  const ranked: Array<{ value: string; score: number }> = []
  const links = html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)
  for (const match of links) {
    const href = match[1]?.trim()
    if (!href || /^(?:#|mailto:|tel:|javascript:)/i.test(href)) continue
    try {
      const value = new URL(href, baseUrl).toString()
      if (!isSameSiteUrl(baseUrl, value)) continue
      const label = match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase()
      const labelScore = /service|offer|pricing|rates|package|product|shop|book|appointment|schedule|quote|contact/.test(label) ? 3 : 0
      const score = pathRelevanceScore(value, guidance) + labelScore
      if (score > 0) ranked.push({ value, score })
    } catch {}
  }
  return uniqueUrls(ranked.sort((a, b) => b.score - a.score).map((item) => item.value), 10)
}

function buildCrawlCandidates(baseUrl: string, sitemapUrls: string[], internalUrls: string[], max = 14): string[] {
  const commonUrls = uniqueUrls(COMMON_PATHS.map((path) => normalizeUrl(baseUrl, path)), max)
  const ordered = [baseUrl]
  const width = Math.max(commonUrls.length, sitemapUrls.length, internalUrls.length)
  for (let index = 0; index < width; index += 1) {
    if (sitemapUrls[index]) ordered.push(sitemapUrls[index])
    if (internalUrls[index]) ordered.push(internalUrls[index])
    if (commonUrls[index]) ordered.push(commonUrls[index])
  }
  return uniqueUrls(ordered, max)
}

function crawlSourceKind(
  value: string,
  baseUrl: string,
  sitemapUrls: string[],
  internalUrls: string[],
): ImportSourceKind {
  const key = canonicalUrlKey(value)
  if (key === canonicalUrlKey(baseUrl)) return 'input_url'
  if (sitemapUrls.some((candidate) => canonicalUrlKey(candidate) === key)) return 'sitemap'
  if (internalUrls.some((candidate) => canonicalUrlKey(candidate) === key)) return 'internal_link'
  return 'common_path'
}

function isCriticalCrawlCandidate(
  value: string,
  baseUrl: string,
  sitemapUrls: string[],
  internalUrls: string[],
): boolean {
  const sourceKind = crawlSourceKind(value, baseUrl, sitemapUrls, internalUrls)
  if (sourceKind === 'sitemap' || sourceKind === 'internal_link') return true
  try {
    return /\/(?:pricing|prices?|rates|plans?|products?|services?|book|booking|contact)(?:\/|$)/.test(new URL(value).pathname.toLowerCase())
  } catch {
    return false
  }
}

function looksLikeShopifySite(baseUrl: string, docs: CrawledDoc[]): boolean {
  try {
    if (/\.myshopify\.com$/i.test(new URL(baseUrl).hostname)) return true
  } catch {}

  return docs.some((doc) => (
    /cdn\.shopify\.com|shopify-section|shopify\.theme|shopify-payment-button|myshopify\.com/i.test(doc.html || '')
  ))
}

async function fetchAgentDocs(baseUrl: string): Promise<CrawledDoc[]> {
  const candidates = [
    { url: normalizeUrl(baseUrl, '/llms.txt'), type: 'llms_txt' as const, label: 'llms.txt' },
    { url: normalizeUrl(baseUrl, '/agent.json'), type: 'agent_json' as const, label: 'agent.json' },
    { url: normalizeUrl(baseUrl, '/.well-known/agent.json'), type: 'agent_json' as const, label: '.well-known/agent.json' },
    { url: normalizeUrl(baseUrl, '/.well-known/nexez.json'), type: 'agent_json' as const, label: '.well-known/nexez.json' },
  ]

  const results = await mapWithConcurrency(candidates, 2, (candidate) => (
    fetchTextSafe(candidate.url, 3500, { retryNetworkFailure: true })
  ))
  return results.flatMap((value, index) => {
    if (!value) return []
    const candidate = candidates[index]
    return [{ ...candidate, text: value }]
  })
}

function extractFromPlainText(text: string, baseUrl: string): OfferItem[] {
  const offers: OfferItem[] = []
  const lines = text
    .split('\n')
    .map((line) => line.replace(/^[#*\-\d.\s]+/, '').trim())
    .filter((line) => line.length > 8 && line.length < 220 && !line.startsWith('>'))

  const candidates = lines.filter((line) => (
    /\$\d+|\bbook\b|\bschedule\b|\bpackage\b|\bservice\b|\bproduct\b|\bconsult\b|\bquote\b|\bproposal\b|\bretainer\b|\bpricing\b/i.test(line)
  ))

  const seen = new Set<string>()
  for (const line of candidates.slice(0, 12)) {
    const markdownLink = line.match(/\[([^\]]+)]\((https?:\/\/[^)]+)\)/i)
    const displayLine = markdownLink ? line.replace(markdownLink[0], markdownLink[1]) : line
    const price = extractPrice(displayLine) || 'Custom'
    const name = cleanName(displayLine.replace(price, '').split(/[:–-]/)[0] || displayLine)
    if (!name || name.length < 3 || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    offers.push({
      name: name.slice(0, 90),
      price,
      description: line.slice(0, 220),
      url: markdownLink?.[2] || baseUrl,
      duration: extractDuration(line) || undefined,
      isMobile: extractIsMobile(line) || undefined,
      serviceArea: extractServiceArea(line) || undefined,
      travelFee: extractTravelFee(line) || undefined,
      confidence: 0.74,
      metadata: { offerKind: 'service', evidenceText: line.slice(0, 500) },
    })
  }
  return offers
}

function extractFromAgentJson(text: string, baseUrl: string): OfferItem[] {
  try {
    const data = JSON.parse(text)
    const found: OfferItem[] = []
    const visit = (value: any) => {
      if (!value || found.length >= 16) return
      if (Array.isArray(value)) {
        value.forEach(visit)
        return
      }
      if (typeof value !== 'object') return

      const name = value.name || value.title || value.label
      const description = value.description || value.summary || value.details
      const price = value.price || value.price_text || value.starting_price || value.amount
      const actionUrl = value.url || value.href || value.action_url || value.checkout_url || value.booking_url
      if (typeof name === 'string' && (description || price || actionUrl)) {
        const kindSignal = String(value.kind || value.type || value.category || '').toLowerCase()
        found.push({
          name: cleanName(name).slice(0, 120),
          price: price ? String(price).slice(0, 60) : 'Custom',
          description: description ? String(description).slice(0, 260) : cleanName(name).slice(0, 120),
          url: typeof actionUrl === 'string' ? normalizeUrl(baseUrl, actionUrl) : baseUrl,
          duration: value.duration ? String(value.duration).slice(0, 60) : undefined,
          serviceArea: value.service_area ? String(value.service_area).slice(0, 90) : undefined,
          availability: value.availability === 'limited' || value.availability === 'sold_out' ? value.availability : undefined,
          confidence: 0.9,
          metadata: {
            offerKind: kindSignal.includes('product') ? 'product' : 'service',
            evidenceText: JSON.stringify(value).slice(0, 600),
          },
        })
      }
      Object.values(value).forEach(visit)
    }
    visit(data)
    return found
  } catch {
    return []
  }
}

type StructuredPageExtraction = {
  offers: OfferItem[]
  faqs: FaqItem[]
  details: ImportBusinessDetails
}

function schemaTypes(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string')
  return typeof value === 'string' ? [value] : []
}

function schemaText(value: unknown): string | null {
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim() || null
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  return schemaText(record.name || record.text || record.value || record.address)
}

function schemaAddress(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null
  if (!value || typeof value !== 'object') return null
  const address = value as Record<string, unknown>
  const parts = [
    address.streetAddress,
    address.addressLocality,
    address.addressRegion,
    address.postalCode,
    address.addressCountry,
  ].map(schemaText).filter(Boolean)
  return parts.length ? parts.join(', ') : null
}

function schemaPrice(value: unknown, currency?: unknown): string | null {
  const price = schemaText(value)
  if (!price) return null
  if (/[$€£¥]|\b(?:USD|EUR|GBP|CAD|AUD|JPY)\b/i.test(price)) return price
  const currencyText = schemaText(currency)
  return currencyText ? `${currencyText.toUpperCase()} ${price}` : price
}

function schemaAvailability(value: unknown): OfferItem['availability'] | undefined {
  const text = schemaText(value)?.toLowerCase() || ''
  if (/soldout|outofstock|discontinued/.test(text)) return 'sold_out'
  if (/limitedavailability|preorder|preorder/.test(text)) return 'limited'
  if (/instock|onlineonly|in-storeonly/.test(text)) return 'available'
  return undefined
}

function classifyOfferKind(input: {
  offerText: string
  pageText: string
  explicitProduct?: boolean
  explicitService?: boolean
}): 'product' | 'service' {
  if (input.explicitProduct) return 'product'
  const offerText = input.offerText.toLowerCase()
  const pageText = input.pageText.toLowerCase()
  const strongServiceSignal = /\b(appointment with|consult|session|treatment|repair|installation|cleaning|workshop|done-for-you|website build|retainer|hourly)\b/.test(offerText)
  const productSignal = /\b(product|software|plugin|license|download|saas|mobile app|web app|shipping|in stock|sku)\b/.test(offerText)
  const softwarePage = /\b(software|plugin|saas|digital platform|mobile app|web app|issue tracking|project management|product development)\b/.test(pageText)
  const subscriptionSignal = /\b(plan|tier|starter|standard|premium|enterprise|business|free|annual|monthly|lifetime|site)\b/.test(offerText)
  if (!strongServiceSignal && (productSignal || (softwarePage && subscriptionSignal))) return 'product'
  if (input.explicitService) return 'service'
  return 'service'
}

function extractStructuredPage(html: string, baseUrl: string): StructuredPageExtraction {
  const result: StructuredPageExtraction = { offers: [], faqs: [], details: { openingHours: [], actionLinks: [] } }
  const matches = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || []
  const pageText = `${metaContent(html, ['description', 'og:description']) || ''} ${stripHtml(html, 24_000)}`

  for (const match of matches) {
    try {
      const data = JSON.parse(match.replace(/<script[^>]*>|<\/script>/gi, ''))
      const visited = new Set<object>()
      const visit = (value: unknown) => {
        if (!value || result.offers.length >= 24) return
        if (Array.isArray(value)) {
          value.forEach(visit)
          return
        }
        if (typeof value !== 'object' || visited.has(value)) return
        visited.add(value)

        const node = value as Record<string, any>
        const types = schemaTypes(node['@type'])
        const lowerTypes = types.map((type) => type.toLowerCase())
        const itemOffered = node.itemOffered && typeof node.itemOffered === 'object' ? node.itemOffered : null
        const offerNodes = Array.isArray(node.offers) ? node.offers : node.offers ? [node.offers] : []
        const isOffer = lowerTypes.some((type) => ['offer', 'aggregateoffer'].includes(type))
        const isProduct = lowerTypes.includes('product') || schemaTypes(itemOffered?.['@type']).some((type) => type.toLowerCase() === 'product')
        const isService = lowerTypes.includes('service') || schemaTypes(itemOffered?.['@type']).some((type) => type.toLowerCase() === 'service')

        if (isOffer || isProduct || isService) {
          const primaryOffer = offerNodes[0] || node
          const name = schemaText(node.name || itemOffered?.name || primaryOffer.name)
          if (name) {
            const priceSpecification = primaryOffer.priceSpecification || node.priceSpecification || {}
            const lowPrice = primaryOffer.lowPrice || node.lowPrice
            const highPrice = primaryOffer.highPrice || node.highPrice
            const currency = primaryOffer.priceCurrency || node.priceCurrency || priceSpecification.priceCurrency
            const exactPrice = schemaPrice(primaryOffer.price || node.price || priceSpecification.price, currency)
            const rangePrice = lowPrice
              ? `${schemaPrice(lowPrice, currency)}${highPrice && String(highPrice) !== String(lowPrice) ? ` to ${schemaPrice(highPrice, currency)}` : ''}`
              : null
            const description = schemaText(node.description || itemOffered?.description || primaryOffer.description) || name
            const actionUrl = schemaText(primaryOffer.url || node.url || itemOffered?.url)
            const areaServed = schemaText(node.areaServed || itemOffered?.areaServed || primaryOffer.areaServed)
            const tiers = offerNodes.length > 1
              ? offerNodes.slice(0, 6).flatMap((offer: Record<string, unknown>, index: number) => {
                  const tierPrice = schemaPrice(offer.price, offer.priceCurrency || currency)
                  if (!tierPrice) return []
                  return [{ name: schemaText(offer.name) || `Option ${index + 1}`, price: tierPrice }]
                })
              : undefined
            const evidenceText = JSON.stringify(node).slice(0, 600)
            const offerText = `${name} ${description} ${types.join(' ')} ${schemaTypes(itemOffered?.['@type']).join(' ')}`
            result.offers.push({
              name: cleanName(name),
              price: exactPrice || rangePrice || 'Custom',
              description: description.slice(0, 600),
              url: actionUrl ? normalizeUrl(baseUrl, actionUrl) : baseUrl,
              duration: schemaText(node.duration || itemOffered?.duration || primaryOffer.duration) || undefined,
              serviceArea: areaServed || undefined,
              availability: schemaAvailability(primaryOffer.availability || node.availability),
              tiers: tiers?.length ? tiers : undefined,
              metadata: {
                offerKind: classifyOfferKind({ offerText, pageText, explicitProduct: isProduct, explicitService: isService }),
                currency: schemaText(currency) || undefined,
                schemaType: types.join(', ') || schemaTypes(itemOffered?.['@type']).join(', '),
                evidenceText,
              },
            })
          }
        }

        if (lowerTypes.includes('faqpage') || lowerTypes.includes('question')) {
          const questions = lowerTypes.includes('question') ? [node] : Array.isArray(node.mainEntity) ? node.mainEntity : [node.mainEntity]
          for (const question of questions) {
            if (!question || typeof question !== 'object') continue
            const prompt = schemaText(question.name || question.question)
            const answer = schemaText(question.acceptedAnswer?.text || question.suggestedAnswer?.text || question.answer)
            if (prompt && answer && !result.faqs.some((item) => item.question.toLowerCase() === prompt.toLowerCase())) {
              result.faqs.push({ question: prompt.slice(0, 220), answer: answer.slice(0, 600) })
            }
          }
        }

        if (lowerTypes.some((type) => type === 'localbusiness' || type.endsWith('business') || type === 'organization')) {
          result.details.name ||= schemaText(node.name)
          result.details.description ||= schemaText(node.description)
          result.details.email ||= schemaText(node.email)
          result.details.phone ||= schemaText(node.telephone)
          result.details.address ||= schemaAddress(node.address)
          const hours = Array.isArray(node.openingHours) ? node.openingHours : node.openingHours ? [node.openingHours] : []
          result.details.openingHours = Array.from(new Set([
            ...(result.details.openingHours || []),
            ...hours.map(schemaText).filter((item): item is string => Boolean(item)),
          ])).slice(0, 14)
        }

        Object.values(node).forEach(visit)
      }
      visit(data)
    } catch {}
  }

  return result
}

type ImportPageRole = 'catalog' | 'pricing' | 'service_detail' | 'booking' | 'contact' | 'location' | 'editorial' | 'marketing'

type HtmlElementRange = {
  tag: string
  attributes: string
  start: number
  openEnd: number
  end: number
  closeEnd: number
  parent: number | null
}

type HeuristicCandidate = {
  kind: 'card' | 'heading' | 'list' | 'paragraph'
  text: string
  name: string | null
  url: string
  evidenceText: string
  destination?: string
  pageRole: ImportPageRole
}

const HTML_VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
])

function maskNonContentHtml(html: string): string {
  return html.replace(/<(?:script|style|noscript|svg)\b[\s\S]*?<\/(?:script|style|noscript|svg)>/gi, (value) => ' '.repeat(value.length))
}

function parseHtmlElementRanges(html: string): HtmlElementRange[] {
  const source = maskNonContentHtml(html)
  const ranges: HtmlElementRange[] = []
  const stack: number[] = []
  const tokenPattern = /<\/?([a-z][\w:-]*)\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi
  let match: RegExpExecArray | null
  while ((match = tokenPattern.exec(source)) !== null) {
    const token = match[0]
    const tag = match[1].toLowerCase()
    if (token.startsWith('</')) {
      const stackIndex = stack.findLastIndex((index) => ranges[index]?.tag === tag)
      if (stackIndex < 0) continue
      const rangeIndex = stack[stackIndex]
      ranges[rangeIndex].end = match.index
      ranges[rangeIndex].closeEnd = tokenPattern.lastIndex
      stack.splice(stackIndex)
      continue
    }

    const range: HtmlElementRange = {
      tag,
      attributes: token,
      start: match.index,
      openEnd: tokenPattern.lastIndex,
      end: source.length,
      closeEnd: source.length,
      parent: stack.at(-1) ?? null,
    }
    const rangeIndex = ranges.push(range) - 1
    if (!HTML_VOID_ELEMENTS.has(tag) && !/\/\s*>$/.test(token)) stack.push(rangeIndex)
  }
  return ranges
}

function classifyImportPage(url: string, html: string): ImportPageRole {
  let path = ''
  try {
    path = new URL(url).pathname.toLowerCase()
  } catch {}
  if (/\/(?:blog|posts?|articles?|news|changelog|guides?|resources?)(?:\/|$)/.test(path)) return 'editorial'
  if (/\/(?:book|booking|checkout|schedule|appointments?)(?:\/|$)/.test(path)) return 'booking'
  if (/\/(?:contact|support)(?:\/|$)/.test(path)) return 'contact'
  if (/\/(?:pricing|prices?|rates|packages?)(?:\/|$)/.test(path)) return 'pricing'
  if (/\/(?:products?|shop|store|plans?|catalog|destinations?|countries)(?:\/|$)/.test(path)) return 'catalog'
  if (/\/(?:locations?|cities|areas)(?:\/|$)/.test(path)) return 'location'
  if (/\/(?:services?)(?:\/|$)/.test(path)) return 'service_detail'
  if (/\b(?:pricing|plan-card|product-card|service-card|offer-card)\b/i.test(html)) return 'catalog'
  return 'marketing'
}

function attributeValue(tag: string, name: string): string {
  return tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1] || ''
}

function textFromHtmlFragment(value: string): string {
  return decodeHtmlEntities(value
    .replace(/<(?:script|style|noscript|svg)\b[\s\S]*?<\/(?:script|style|noscript|svg)>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim())
}

function bestCardLink(cardHtml: string, baseUrl: string): string {
  const links = Array.from(cardHtml.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi))
    .map((match) => {
      const href = decodeHtmlEntities(match[1] || '')
      const label = textFromHtmlFragment(match[2] || '')
      const value = `${label} ${href}`.toLowerCase()
      const score = (/\b(?:view plan|buy|purchase|book|schedule|select|choose|start|checkout|order)\b/.test(value) ? 12 : 0)
        + (/\/(?:plans?|products?|services?|book|booking|checkout|order)(?:\/|$)/.test(value) ? 8 : 0)
        + (href && !href.startsWith('#') ? 1 : -20)
      return { href, score }
    })
    .filter((item) => item.href && !/^(?:mailto:|tel:|javascript:)/i.test(item.href))
    .sort((a, b) => b.score - a.score)
  return links[0]?.href ? normalizeUrl(baseUrl, links[0].href) : baseUrl
}

function cardDestination(cardHtml: string): string | null {
  for (const match of cardHtml.matchAll(/<([a-z][\w:-]*)\b([^>]*(?:class|id)=["'][^"']*(?:destination|country|region|location)[^"']*["'][^>]*)>([\s\S]*?)<\/\1>/gi)) {
    const value = textFromHtmlFragment(match[3] || '')
    if (value.length >= 2 && value.length <= 60 && !/\b(?:plan|price|view|buy|book)\b/i.test(value)) return value
  }
  return null
}

function cardTitle(cardHtml: string): string | null {
  const heading = cardHtml.match(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i)
  if (heading) return textFromHtmlFragment(heading[1])
  const explicit = cardHtml.match(/<([a-z][\w:-]*)\b[^>]*(?:class|id)=["'](?=[^"']*(?:plan|tier|package|product|service|offer))(?=[^"']*(?:title|name|heading))[^"']+["'][^>]*>([\s\S]*?)<\/\1>/i)
  return explicit ? textFromHtmlFragment(explicit[2]) : null
}

function extractStructuredCardCandidates(html: string, baseUrl: string, pageRole: ImportPageRole): Array<HeuristicCandidate & { start: number; end: number }> {
  const ranges = parseHtmlElementRanges(html)
  const cards: Array<HeuristicCandidate & { start: number; end: number }> = []
  for (const range of ranges) {
    if (!['article', 'section', 'li', 'div'].includes(range.tag)) continue
    const identity = `${attributeValue(range.attributes, 'class')} ${attributeValue(range.attributes, 'id')}`
    const explicitCard = /\b(?:service|product|offer|pricing|price|package|plan|tier|card)(?:[-_\s]|$)/i.test(identity)
    if (!explicitCard && range.tag !== 'article') continue
    const cardHtml = html.slice(range.start, range.closeEnd)
    const text = textFromHtmlFragment(cardHtml)
    if (text.length < 8 || text.length > 1400) continue
    const title = cardTitle(cardHtml)
    if (!title) continue
    const prices = extractPrices(text)
    const hasCommercialAction = /\b(?:view plan|book|schedule|buy|purchase|select|choose|start|checkout|order|free trial)\b/i.test(text)
    const hasOfferLanguage = /\b(?:service|product|package|session|consultation|cleaning|plan|tier|membership|license|eSIM|data)\b/i.test(text)
    if (!prices.length && !(hasCommercialAction && hasOfferLanguage)) continue
    const destination = cardDestination(cardHtml)
    const name = destination && !title.toLowerCase().includes(destination.toLowerCase())
      ? `${destination} ${title}`
      : title
    cards.push({
      kind: 'card',
      text,
      name,
      url: bestCardLink(cardHtml, baseUrl),
      evidenceText: text.slice(0, 600),
      destination: destination || undefined,
      pageRole,
      start: range.start,
      end: range.closeEnd,
    })
  }
  return cards.filter((candidate, index, values) => !values.some((other, otherIndex) => (
    otherIndex !== index
    && other.start <= candidate.start
    && other.end >= candidate.end
    && other.text === candidate.text
  )))
}

function isWeakOfferName(name: string): boolean {
  const value = name.trim()
  return /^(?:from|per\b|\/\s*(?:mo|month|year|yr|hour)|built for|give every|try\b|plans? tailored|free trial included|city \+|individual business profiles|editorial blog|service hub pages|bookings happen|powerful\b|never lose|from service|want new|send us|common buyer|operational controls|our .+ best fit|step\s*\d+|trusted by\b|one-time price\b|supported networks?\b|coverage notes?\b|plan details?\b|\d+\s*[.)/-]\s*(?:the\b|weekly\b|review\b)|\d+\/\d+\b)/i.test(value)
    || /\b(?:one-time price|supported networks?|coverage notes?|plan details?)\b/i.test(value)
    || /\b(?:demo|what our clients say)$/.test(value.toLowerCase())
    || /\bworkflow highlights?$/i.test(value)
    || (value.length > 36 && /[.!]$/.test(value))
    || (/^[A-Z][A-Z\s.'-]{2,40}$/.test(value) && !/\b(?:API|SEO|CRM|AI)\b/.test(value))
}

function cardIntegrityWarnings(candidate: HeuristicCandidate): string[] {
  if (!candidate.destination || candidate.url === '') return []
  try {
    const path = decodeURIComponent(new URL(candidate.url).pathname).toLowerCase()
    if (!/\/(?:plans?|products?|services?|packages?)\//.test(path)) return []
    const destinationSlug = candidate.destination.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    if (destinationSlug && !path.includes(destinationSlug)) return ['Destination text conflicts with the action URL.']
  } catch {
    return ['Action URL could not be validated.']
  }
  return []
}

function extractFromHeuristics(html: string, baseUrl: string, industry?: string | null): OfferItem[] {
  const offers: OfferItem[] = []
  const boostKeywords = getIndustryBoostKeywords(industry)
  const textFromHtml = textFromHtmlFragment
  const pageRole = classifyImportPage(baseUrl, html)
  const pageContext = `${metaContent(html, ['description', 'og:description']) || ''} ${textFromHtml(html).slice(0, 24_000)}`
  const softwarePage = /\b(?:software|plugin|saas|digital platform|mobile app|web app|issue tracking|project management|product development)\b/i.test(pageContext)
  const structuredCards = extractStructuredCardCandidates(html, baseUrl, pageRole)
  const tags = [
    ...(html.match(/<li[^>]*>([\s\S]*?)<\/li>/gi) || []).map((value) => ({ value, kind: 'list' as const })),
    ...(html.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || []).map((value) => ({ value, kind: 'paragraph' as const })),
  ]

  const titlePattern = /<(h[1-6]|div|span)\b[^>]*(?:(?:class|id)=["'](?=[^"']*(?:plan|tier|package|pricing|price|product|service|offer))(?=[^"']*(?:title|name|heading))[^"']+["'])[^>]*>([\s\S]*?)<\/\1>/gi
  const headingPattern = /<(h[2-4])\b[^>]*>([\s\S]*?)<\/\1>/gi
  const explicitTitleMarkers = Array.from(html.matchAll(titlePattern))
  const explicitTitleIndices = new Set(explicitTitleMarkers.map((match) => match.index || 0))
  const titleMarkers = [...explicitTitleMarkers, ...Array.from(html.matchAll(headingPattern))]
    .sort((a, b) => (a.index || 0) - (b.index || 0))
    .filter((match, index, values) => match.index !== values[index - 1]?.index)
    .filter((match) => {
      const name = textFromHtml(match[2] || '')
      return name.length >= 2 && name.length <= 80 && !/[?]/.test(name)
    })
  const titleWindows = titleMarkers.map((match, index) => {
    const start = match.index || 0
    const nextStart = explicitTitleIndices.has(start)
      ? titleMarkers.slice(index + 1).find((candidate) => explicitTitleIndices.has(candidate.index || 0))?.index ?? html.length
      : titleMarkers[index + 1]?.index ?? html.length
    const value = html.slice(start, Math.min(nextStart, start + 3200))
    const link = value.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i)
    return {
      kind: 'heading' as const,
      text: textFromHtml(value),
      name: textFromHtml(match[2] || ''),
      url: link?.[1] ? normalizeUrl(baseUrl, decodeHtmlEntities(link[1])) : baseUrl,
      evidenceText: textFromHtml(value).slice(0, 600),
      pageRole,
    }
  }).filter(({ text }, index) => {
    const markerStart = titleMarkers[index]?.index || 0
    return text.length > 8
      && text.length < 1600
      && !structuredCards.some((card) => markerStart >= card.start && markerStart < card.end)
  })

  const tagCandidates = tags
    .map(({ value, kind }) => ({
      kind,
      text: textFromHtml(value),
      name: null,
      url: baseUrl,
      evidenceText: textFromHtml(value).slice(0, 500),
      pageRole,
    }))
    .filter(({ text }) => text.length > 6 && text.length < 200)

  const candidates: HeuristicCandidate[] = [
    ...structuredCards.map(({ start: _start, end: _end, ...candidate }) => candidate),
    ...titleWindows,
    ...tagCandidates,
  ]
    .filter(({ text, kind }) => {
      const lower = text.toLowerCase()
      const hasPrice = Boolean(extractPrice(text))
      const hasDuration = Boolean(extractDuration(text))
      const hasOfferKeyword = /\b(service|product|package|session|consultation|appointment|treatment|repair|installation|cleaning|lesson|class|course|plan|retainer|membership|audit|visit|starter|standard|premium|enterprise|professional|business|free)\b/i.test(text)
      const hasAction = /\b(book|schedule|reserve|buy|shop|start|get started|free trial|request a quote|contact sales)\b/i.test(text)
      const testimonialOrQuestion = /[?]|\b(?:testimonial|what our customers|what our clients|customer stor|my no-shows|i replaced my|frequently asked)\b/i.test(text)
      if (testimonialOrQuestion) return false
      if (['editorial', 'contact', 'location'].includes(pageRole) && kind !== 'card') return false
      if (pageRole === 'booking' && kind !== 'card') return false
      if (kind === 'card') return hasPrice || (hasOfferKeyword && hasAction)
      if (kind === 'heading') return hasPrice || (hasOfferKeyword && hasAction && (hasDuration || text.length < 90))
      return hasPrice && (hasOfferKeyword || hasDuration || boostKeywords.some((keyword) => lower.includes(keyword)))
    })
    .sort((a, b) => {
      const quality = (candidate: typeof a) => (
        (extractPrice(candidate.text) ? 8 : 0)
        + (candidate.kind === 'card' ? 4 : 0)
        + (candidate.name ? 2 : 0)
      )
      return quality(b) - quality(a)
    })

  const seen = new Set<string>()
  for (const candidate of candidates.slice(0, 24)) {
    const { text } = candidate
    const prices = extractPrices(text)
    const price = prices[0] || 'Custom'
    const name = cleanName(candidate.name || text.replace(price, ''))
    const integrityWarnings = cardIntegrityWarnings(candidate)
    if (!name || (!candidate.name && name.length >= 72) || isWeakOfferName(name) || integrityWarnings.length || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    const lower = text.toLowerCase()
    const strongServiceSignal = /\b(consult|session|treatment|repair|installation|cleaning|workshop|done-for-you|website build|retainer|hourly)\b/.test(lower)
    const productSignal = /\b(product|shop|store|buy|order|shipping|in stock|software|plugin|license|download|saas|app|platform|esim|data plan)\b/.test(lower)
    const subscriptionSignal = /\b(plan|tier|starter|standard|premium|enterprise|business|free)\b/.test(lower) && prices.length > 0
    const offerKind = !strongServiceSignal && (productSignal || (softwarePage && subscriptionSignal)) ? 'product' : 'service'
    const tiers = prices.length > 1
      ? prices.slice(1, 5).map((tierPrice, index) => ({ name: `Additional price ${index + 1}`, price: tierPrice }))
      : undefined

    offers.push({
      name: name.substring(0, 80),
      price,
      description: text.length > 40 ? text.substring(0, 260) : name,
      url: candidate.url,
      duration: extractDuration(text) || undefined,
      isMobile: extractIsMobile(text) || undefined,
      serviceArea: extractServiceArea(text) || undefined,
      travelFee: extractTravelFee(text) || undefined,
      tiers,
      confidence: candidate.kind === 'card' ? 0.68 : undefined,
      metadata: {
        offerKind,
        evidenceText: candidate.evidenceText,
        extractionStrength: candidate.kind === 'card' && prices.length ? 'structured_card' : candidate.kind,
        pageRole: candidate.pageRole,
        destination: candidate.destination,
        cardBoundary: candidate.kind === 'card',
        integrityWarnings,
      },
    })
  }
  return offers
}

function actionKind(label: string, url: string): NonNullable<ImportBusinessDetails['actionLinks']>[number]['kind'] {
  const labelValue = decodeHtmlEntities(label).toLowerCase()
  let pathValue = ''
  try {
    const parsed = new URL(url)
    pathValue = `${parsed.pathname} ${parsed.searchParams.get('action') || ''}`.toLowerCase()
  } catch {}
  if (/^(?:book|schedule|reserve)\b/.test(labelValue) || /\/(?:book|booking|schedule|reserve)(?:\/|$)/.test(pathValue)) return 'book'
  if (/^(?:buy|checkout|order|shop|purchase)\b|\badd to cart\b/.test(labelValue) || /\/(?:buy|checkout|cart|order|shop|purchase)(?:\/|$)/.test(pathValue)) return 'buy'
  if (/\b(?:quote|estimate|proposal)\b/.test(labelValue) || /\/(?:quote|estimate|proposal)(?:\/|$)/.test(pathValue)) return 'quote'
  if (/\b(?:contact|call|email|inquir)/.test(labelValue) || /\/(?:contact|call|email|inquiry)(?:\/|$)/.test(pathValue)) return 'contact'
  return 'other'
}

function actionLinkScore(link: NonNullable<ImportBusinessDetails['actionLinks']>[number]): number {
  const value = `${link.label} ${link.url}`.toLowerCase()
  const kindScore = link.kind === 'buy'
    ? 10
    : link.kind === 'book' || link.kind === 'quote'
      ? 9
    : link.kind === 'contact'
      ? 4
      : 2
  const directAction = /\b(?:start|get started|sign up|signup|free trial)\b/.test(value)
    ? 6
    : /\b(?:pricing|plans|shop now|view products?)\b/.test(value)
      ? 4
      : 0
  const weakDestination = /\b(?:help|support|blog|article|docs|documents|tutorial|resources|guide|faq|privacy|terms|cookie|login|sign in)\b/.test(value) ? -8 : 0
  return kindScore + directAction + weakDestination
}

function extractActionLinks(html: string, baseUrl: string): NonNullable<ImportBusinessDetails['actionLinks']> {
  const links: NonNullable<ImportBusinessDetails['actionLinks']> = []
  const seen = new Set<string>()
  const re = /<a\b[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let m
  while ((m = re.exec(html)) !== null) {
    const href = decodeHtmlEntities(m[1])
    const label = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    if (!href || label.length < 2 || !/book|schedule|reserve|appointment|buy|checkout|order|shop|purchase|quote|estimate|contact|call|email|inquir|start|get started|sign up|signup|free trial|pricing|plans|products?/i.test(`${label} ${href}`)) continue
    const url = normalizeUrl(baseUrl, href)
    const key = canonicalUrlKey(url)
    if (seen.has(key)) continue
    seen.add(key)
    links.push({ label: label.slice(0, 80), url, kind: actionKind(label, url) })
    if (links.length >= 12) break
  }
  return links.sort((a, b) => actionLinkScore(b) - actionLinkScore(a))
}

function extractPageDetails(html: string, baseUrl: string): ImportBusinessDetails {
  const email = html.match(/(?:mailto:|\b)([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i)?.[1] || null
  const phoneHref = html.match(/href=["']tel:([^"']+)["']/i)?.[1]
  const visiblePhone = stripHtml(html, 20_000).match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/)?.[0]
  const addressHtml = html.match(/<address\b[^>]*>([\s\S]*?)<\/address>/i)?.[1]
  const address = addressHtml ? addressHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180) : null
  const hours = Array.from(stripHtml(html, 30_000).matchAll(/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)(?:day)?(?:\s*[-–]\s*(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)(?:day)?)?\s*[: ]\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)\s*[-–]\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)/gi))
    .map((match) => match[0])
  return {
    email,
    phone: phoneHref?.trim() || visiblePhone || null,
    address,
    openingHours: Array.from(new Set(hours)).slice(0, 14),
    actionLinks: extractActionLinks(html, baseUrl),
  }
}

function mergeBusinessDetails(primary: ImportBusinessDetails, secondary: ImportBusinessDetails): ImportBusinessDetails {
  const actionLinks = [...(primary.actionLinks || []), ...(secondary.actionLinks || [])]
  const seenActions = new Set<string>()
  return {
    name: primary.name || secondary.name || null,
    description: primary.description || secondary.description || null,
    email: primary.email || secondary.email || null,
    phone: primary.phone || secondary.phone || null,
    address: primary.address || secondary.address || null,
    openingHours: Array.from(new Set([...(primary.openingHours || []), ...(secondary.openingHours || [])])).slice(0, 14),
    actionLinks: actionLinks.filter((link) => {
      const key = canonicalUrlKey(link.url)
      if (seenActions.has(key)) return false
      seenActions.add(key)
      return true
    }).sort((a, b) => actionLinkScore(b) - actionLinkScore(a)).slice(0, 12),
  }
}

function normalizedOfferIdentity(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function directOfferUrlKey(offer: OfferItem): string | null {
  if (!offer.url) return null
  try {
    const path = new URL(offer.url).pathname.toLowerCase()
    if (/\/(?:plans?|products?|services?|packages?)\/[^/]+/.test(path)) return canonicalUrlKey(offer.url)
  } catch {}
  return null
}

function offerMergeKey(offer: OfferItem): string {
  const directUrl = directOfferUrlKey(offer)
  if (directUrl) return `url:${directUrl}`
  const destination = normalizedOfferIdentity(String(offer.metadata?.destination || offer.serviceArea || ''))
  const name = normalizedOfferIdentity(offer.name)
  return `offer:${destination}:${name}`
}

function mergeOffers(primary: OfferItem[], secondary: OfferItem[]): OfferItem[] {
  const byIdentity = new Map<string, OfferItem>()
  for (const offer of primary) byIdentity.set(offerMergeKey(offer), { ...offer })
  for (const o of secondary) {
    const key = offerMergeKey(o)
    if (!byIdentity.has(key)) {
      byIdentity.set(key, { ...o })
    } else {
      const ex = byIdentity.get(key)!
      if ((o.confidence || 0) > (ex.confidence || 0)) {
        byIdentity.set(key, {
          ...o,
          duration: o.duration || ex.duration,
          isMobile: o.isMobile || ex.isMobile,
          serviceArea: o.serviceArea || ex.serviceArea,
          travelFee: o.travelFee || ex.travelFee,
          tiers: o.tiers?.length ? o.tiers : ex.tiers,
          availability: o.availability || ex.availability,
        })
        continue
      }
      ex.duration = ex.duration || o.duration
      ex.isMobile = ex.isMobile || o.isMobile
      ex.serviceArea = ex.serviceArea || o.serviceArea
      ex.travelFee = ex.travelFee || o.travelFee
      ex.tiers = ex.tiers?.length ? ex.tiers : o.tiers
      ex.availability = ex.availability || o.availability
      if (!ex.url && o.url) ex.url = o.url
      if (!ex.source && o.source) ex.source = o.source
      if (!ex.metadata && o.metadata) ex.metadata = o.metadata
    }
  }
  return Array.from(byIdentity.values()).slice(0, 12)
}

function pruneAndRankOffers(offers: OfferItem[], baseUrl: string, softwareBusiness: boolean): OfferItem[] {
  const baseKey = canonicalUrlKey(baseUrl)
  const authoritativeSourceTypes = new Set(['shopify', 'agent_json', 'schema_org'])
  const authoritativeCount = offers.filter((offer) => {
    const provenance = offer.metadata?.provenance as ImportSource | undefined
    return authoritativeSourceTypes.has(provenance?.type || offer.source || '')
  }).length
  const sourceWeight: Record<string, number> = {
    shopify: 60,
    agent_json: 55,
    schema_org: 50,
    llms_txt: 35,
    input_url: 32,
    internal_link: 28,
    sitemap: 26,
    common_path: 24,
    heuristic: 20,
    llm: 18,
  }
  const retained = offers.filter((offer) => {
    const provenance = offer.metadata?.provenance as ImportSource | undefined
    const sourceUrl = provenance?.url || offer.url || baseUrl
    let sourcePath = ''
    try {
      sourcePath = new URL(sourceUrl).pathname.toLowerCase()
    } catch {}
    const sameAsInput = canonicalUrlKey(sourceUrl) === baseKey
    if (!sameAsInput && /\/(?:blog|articles?|news|changelog|docs?|documents|guides?|resources?|help)(?:\/|$)/.test(sourcePath)) return false

    const customPrice = !offer.price || /^(?:custom|unknown|see options|confirm)$/i.test(offer.price)
    const sourceType = provenance?.type || offer.source || ''
    const heuristicLike = ['heuristic', 'llms_txt', 'common_path', 'internal_link', 'sitemap'].includes(sourceType)
    if (authoritativeCount >= 2 && !authoritativeSourceTypes.has(sourceType) && sourceType !== 'llm') {
      const strongIndependentCard = offer.metadata?.extractionStrength === 'structured_card'
        && !customPrice
        && (offer.confidence || 0) >= 0.64
        && Boolean(directOfferUrlKey(offer))
        && ['catalog', 'pricing', 'service_detail'].includes(String(offer.metadata?.pageRole || ''))
      if (!strongIndependentCard) return false
    }
    if (softwareBusiness && heuristicLike) {
      if (!sameAsInput && !/\/(?:pricing|plans?|products?|shop|services?|packages?)(?:\/|$)/.test(sourcePath)) return false
      if (customPrice) return false
      if (offer.metadata?.offerKind === 'service') return false
    }
    return true
  })

  return retained.sort((a, b) => {
    const score = (offer: OfferItem) => {
      const provenance = offer.metadata?.provenance as ImportSource | undefined
      const sourceType = provenance?.type || offer.source || 'heuristic'
      const sameAsInput = provenance?.url ? canonicalUrlKey(provenance.url) === baseKey : false
      const explicitPrice = Boolean(offer.price && !/^(?:custom|unknown|see options|confirm)$/i.test(offer.price))
      return (sourceWeight[sourceType] || 0)
        + (sameAsInput ? 18 : 0)
        + (explicitPrice ? 12 : 0)
        + (offer.metadata?.extractionStrength === 'structured_card' ? 8 : 0)
        + (offer.url && canonicalUrlKey(offer.url) !== baseKey ? 3 : 0)
    }
    return score(b) - score(a)
  }).slice(0, 12)
}

function extractLogo(html: string, baseUrl: string): string | null {
  const tryResolve = (href: string) => {
    try {
      return new URL(href, baseUrl).toString()
    } catch {
      return null
    }
  }

  const structuredCandidates: string[] = []
  const visitStructuredLogo = (value: unknown, organizationContext = false) => {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) {
      value.forEach((item) => visitStructuredLogo(item, organizationContext))
      return
    }
    const record = value as Record<string, unknown>
    const types = schemaTypes(record['@type']).map((type) => type.toLowerCase())
    const isOrganization = organizationContext || types.some((type) => /organization|localbusiness|corporation|store/.test(type))
    if (isOrganization && record.logo) {
      const logo = typeof record.logo === 'string'
        ? record.logo
        : schemaText((record.logo as Record<string, unknown>)?.url || (record.logo as Record<string, unknown>)?.contentUrl)
      if (logo) structuredCandidates.push(logo)
    }
    Object.values(record).forEach((item) => visitStructuredLogo(item, isOrganization))
  }
  for (const script of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      visitStructuredLogo(JSON.parse(script[1]))
    } catch {}
  }
  for (const candidate of structuredCandidates) {
    const resolved = tryResolve(candidate)
    if (resolved) return resolved
  }

  const imageCandidates: Array<{ url: string; score: number }> = []
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0]
    const src = attributeValue(tag, 'src') || attributeValue(tag, 'data-src')
    if (!src) continue
    const resolved = tryResolve(src)
    if (!resolved) continue
    const signal = `${src} ${attributeValue(tag, 'alt')} ${attributeValue(tag, 'class')} ${attributeValue(tag, 'id')}`.toLowerCase()
    const nearby = html.slice(Math.max(0, (match.index || 0) - 300), Math.min(html.length, (match.index || 0) + tag.length + 300)).toLowerCase()
    const score = (/\b(?:logo|brand|wordmark|brandmark)\b/.test(signal) ? 80 : 0)
      + (/<(?:header|nav)\b/.test(nearby) ? 20 : 0)
      + (/\.(?:svg|png)(?:$|\?)/.test(resolved.toLowerCase()) ? 5 : 0)
      - (/\b(?:hero|banner|cover|background|gallery)\b/.test(signal) ? 100 : 0)
    if (score > 0) imageCandidates.push({ url: resolved, score })
  }
  imageCandidates.sort((a, b) => b.score - a.score)
  if (imageCandidates[0]) return imageCandidates[0].url

  const rels = html.matchAll(/<link[^>]+rel=["']([^"']*(?:icon|logo|apple-touch-icon)[^"']*)["'][^>]+href=["']([^"']+)["']/gi)
  let bestIco: string | null = null
  for (const match of rels) {
    const rel = (match[1] || '').toLowerCase()
    const href = match[2]
    const resolved = tryResolve(href)
    if (!resolved) continue
    if (resolved.endsWith('.svg') || resolved.endsWith('.png') || resolved.includes('logo')) {
      return resolved
    }
    if (!bestIco) bestIco = resolved
  }
  if (bestIco) return bestIco

  for (const meta of html.matchAll(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]+content=["']([^"']+)["']/gi)) {
    const resolved = tryResolve(meta[1])
    if (resolved && /\b(?:logo|brand|wordmark|brandmark|icon)\b/i.test(resolved)) return resolved
  }

  return null
}

export async function analyzeSite(
  url: string,
  guidanceInput?: string | ImportGuidance | null,
  opts?: { skipLlm?: boolean },
): Promise<ImportResult> {
  const analysisStartedAt = Date.now()
  if (!url) throw new Error('URL required')
  const urlError = getImportUrlError(url)
  if (urlError) throw new Error(urlError)
  const resolvedUrlError = await getResolvedImportUrlError(url)
  if (resolvedUrlError) throw new Error(resolvedUrlError)
  // Deterministic-only mode: used by the unauthenticated /api/simulate-url demo
  // so an anonymous, outward-facing endpoint never spends on the LLM. The
  // deterministic crawl (schema.org/JSON-LD, common paths, Shopify, agent docs)
  // still produces a real structured result.
  const skipLlm = opts?.skipLlm === true
  const guidance = normalizeGuidance(guidanceInput)
  const industry = guidance.industry || null

  // Short-TTL cache hit (robustness + speed)
  const cached = getCached(url, guidance, skipLlm)
  if (cached) {
    return {
      ...cached,
      telemetry: {
        ...cached.telemetry,
        cacheHit: true,
        durationMs: Date.now() - analysisStartedAt,
      },
    }
  }

  // Fetch the entry page, robots policy, and agent-readable documents in one
  // bounded round. The entry page then supplies real navigation candidates.
  const [robotsTxt, entryHtml, agentDocs] = await Promise.all([
    fetchTextSafe(normalizeUrl(url, '/robots.txt'), 4000, { retryNetworkFailure: true }),
    fetchHtmlSafe(url, 5200, { retryNetworkFailure: true }),
    fetchAgentDocs(url),
  ])
  const sitemapUrls = await discoverSitemapUrls(url, guidance, robotsTxt)
  const internalUrls = entryHtml ? discoverInternalUrls(entryHtml, url, guidance) : []

  // Balance verified navigation and sitemap pages with conventional paths so
  // one discovery source cannot consume the entire crawl budget.
  let candidates = buildCrawlCandidates(url, sitemapUrls, internalUrls)
  const pagesConsidered = candidates.length
  const skippedPages: ImportTelemetry['skippedPages'] = []

  // Apply the single robots response consistently to every candidate.
  candidates = candidates.filter((candidate) => {
    try {
      const allowed = isPathAllowedByRobots(robotsTxt, new URL(candidate).pathname || '/')
      if (!allowed) skippedPages.push({ url: candidate, reason: 'robots' })
      return allowed
    } catch {
      return true
    }
  })

  if (candidates.length === 0) candidates = [url]

  const htmlDocs: CrawledDoc[] = []
  const fingerprints = new Set<string>()
  const addHtmlDoc = (candidate: string, html: string) => {
    const fingerprint = contentFingerprint(html)
    if (fingerprints.has(fingerprint)) {
      skippedPages.push({ url: candidate, reason: 'duplicate' })
      return
    }
    fingerprints.add(fingerprint)
    const sourceKind = crawlSourceKind(candidate, url, sitemapUrls, internalUrls)
    htmlDocs.push({
      html,
      text: stripHtml(html, 9000),
      url: candidate,
      type: 'html',
      sourceKind,
      label: sourceFor(candidate, sourceKind, 'HTML crawl').label,
    })
  }
  if (entryHtml) addHtmlDoc(url, entryHtml)

  const entryKey = canonicalUrlKey(url)
  const remainingCandidates = candidates.filter((candidate) => !entryHtml || canonicalUrlKey(candidate) !== entryKey)
  const results = await mapWithConcurrency(remainingCandidates, 4, (candidate) => fetchHtmlSafe(candidate, 5200, {
    retryNetworkFailure: isCriticalCrawlCandidate(candidate, url, sitemapUrls, internalUrls),
  }))
  results.forEach((value, i) => {
    if (value) {
      addHtmlDoc(remainingCandidates[i], value)
    } else {
      skippedPages.push({ url: remainingCandidates[i], reason: 'fetch_failed' })
    }
  })

  // Machine-readable agent files are the strongest context for reconciliation,
  // so keep them ahead of ordinary HTML in the bounded AI corpus.
  const allDocs = [...agentDocs, ...htmlDocs]

  if (allDocs.length === 0) {
    throw new Error('Could not fetch site or common subpages (robots or network)')
  }

  const primary = htmlDocs[0] || allDocs[0]
  const primaryHtml = primary.html || ''
  const primaryServiceArea = primaryHtml ? extractPrimaryServiceArea(primaryHtml, primary.url) : null
  const titleMatch = primaryHtml.match(/<title>(.*?)<\/title>/i)
  const primaryStructuredIdentity = primaryHtml ? extractStructuredPage(primaryHtml, primary.url).details : {}
  const detectedTitle = primaryStructuredIdentity.name
    || metaContent(primaryHtml, ['og:site_name'])
    || titleMatch?.[1]?.trim()
  const title = detectedTitle || 'Imported Business'

  const detectedDescription = primaryStructuredIdentity.description || metaContent(primaryHtml, ['description', 'og:description', 'twitter:description']) || ''
  let description = detectedDescription
  if (industry && description.length < 15) description = `${industry} services.`

  // One-click logo for branding (C10)
  let logo_url: string | null = null
  for (const doc of htmlDocs) {
    if (!doc.html) continue
    const l = extractLogo(doc.html, doc.url)
    if (l) {
      logo_url = l
      break
    }
  }

  let rich: OfferItem[] = []
  let businessDetails: ImportBusinessDetails = { openingHours: [], actionLinks: [] }
  const detectedFaqs: FaqItem[] = []
  const evidence: Array<ImportEvidence | null> = []

  // Shopify special path (high value per user request)
  const shopifyOffers = looksLikeShopifySite(url, htmlDocs)
    ? await tryExtractShopifyProducts(url)
    : []
  if (shopifyOffers.length > 0) {
    const shopifySource = sourceFor(normalizeUrl(url, '/products.json?limit=30'), 'shopify', 'Shopify product feed', 'Shopify products feed')
    rich = mergeOffers(rich, shopifyOffers.map((offer) => withProvenance(offer, shopifySource, 0.08)))
  }

  for (const doc of htmlDocs) {
    if (!doc.html) continue
    const htmlSourceType = doc.sourceKind || 'common_path'
    const schemaSource = sourceFor(doc.url, 'schema_org', 'schema.org JSON-LD', `${doc.label} schema`)
    const heuristicSource = sourceFor(doc.url, 'heuristic', `HTML extraction from ${htmlSourceType.replace('_', ' ')}`, doc.label)
    const structured = extractStructuredPage(doc.html, doc.url)
    const ld = structured.offers.map((offer) => withProvenance(offer, schemaSource, 0.12))
    const heur = extractFromHeuristics(doc.html, doc.url, industry).map((offer) => withProvenance(offer, heuristicSource, 0))
    const pageDetails = extractPageDetails(doc.html, doc.url)
    businessDetails = mergeBusinessDetails(businessDetails, mergeBusinessDetails(structured.details, pageDetails))
    for (const faq of structured.faqs) {
      if (!detectedFaqs.some((item) => item.question.toLowerCase() === faq.question.toLowerCase())) detectedFaqs.push(faq)
      evidence.push(makeEvidence('faq', `${faq.question} | ${faq.answer}`, schemaSource, `${faq.question} ${faq.answer}`, 0.9))
    }
    const structuredDetailFields: Array<[string, unknown]> = [
      ['contact.email', structured.details.email],
      ['contact.phone', structured.details.phone],
      ['location.address', structured.details.address],
      ...((structured.details.openingHours || []).map((value) => ['openingHours', value] as [string, unknown])),
    ]
    structuredDetailFields.forEach(([field, value]) => evidence.push(makeEvidence(field, value, schemaSource, String(value || ''), 0.9)))
    const pageDetailFields: Array<[string, unknown]> = [
      ['contact.email', pageDetails.email],
      ['contact.phone', pageDetails.phone],
      ['location.address', pageDetails.address],
      ...((pageDetails.openingHours || []).map((value) => ['openingHours', value] as [string, unknown])),
    ]
    pageDetailFields.forEach(([field, value]) => evidence.push(makeEvidence(field, value, heuristicSource, String(value || ''), 0.7)))
    for (const link of pageDetails.actionLinks || []) {
      evidence.push(makeEvidence(`action.${link.kind}`, link.url, heuristicSource, link.label, 0.74))
    }
    rich = mergeOffers(rich, [...ld, ...heur])
  }

  for (const doc of agentDocs) {
    if (doc.type === 'agent_json') {
      const source = sourceFor(doc.url, 'agent_json', 'Agent JSON extraction', doc.label)
      rich = mergeOffers(rich, extractFromAgentJson(doc.text, url).map((offer) => withProvenance(offer, source, 0.12)))
    } else if (doc.type === 'llms_txt') {
      const source = sourceFor(doc.url, 'llms_txt', 'llms.txt extraction', doc.label)
      rich = mergeOffers(rich, extractFromPlainText(doc.text, url).map((offer) => withProvenance(offer, source, 0.08)))
    }
  }

  const primarySourceType = primary.type === 'html' ? primary.sourceKind || 'input_url' : primary.type
  const primarySource = sourceFor(primary.url, primarySourceType, primary.type === 'html' ? 'HTML crawl' : 'Agent-readable document', primary.label)
  const aiSource = sourceFor(url, 'llm', 'Structured AI draft', 'AI extraction')
  const guidanceSource = sourceFor(url, 'guidance', 'Owner import guidance', 'Owner-provided guidance')
  evidence.push(makeEvidence('business.name', cleanTitle(title), primarySource, detectedTitle || title, detectedTitle ? 0.8 : 0.3, detectedTitle ? 'detected' : 'inferred'))
  if (description) evidence.push(makeEvidence('business.description', description, primarySource, detectedDescription || description, 0.74))
  const guidanceFields: Array<[string, unknown]> = [
    ['audience', guidance.targetBuyer || answerForField(guidance, 'audience')],
    ['industry', guidance.industry],
    ['location', guidance.location || answerForField(guidance, 'location')],
    ['action.preference', guidance.desiredAction || answerForField(guidance, 'action')],
    ['offer.focus', guidance.offerFocus],
  ]
  guidanceFields.forEach(([field, value]) => evidence.push(makeEvidence(field, value, guidanceSource, String(value || ''), 1, 'owner_confirmed')))
  rich.forEach((offer, index) => {
    const source = offer.metadata?.provenance as ImportSource | undefined
    const offerSource = source || sourceFor(offer.url || url, 'heuristic', 'Offer evidence', `Offer ${index + 1}`)
    const sourceText = typeof offer.metadata?.evidenceText === 'string' ? offer.metadata.evidenceText : offer.description || offer.name
    const fields: Array<[string, unknown]> = [
      [`offers.${index}.name`, offer.name],
      [`offers.${index}.description`, offer.description],
      ...(!/^(?:custom|unknown|see options|confirm)$/i.test(offer.price || '') ? [[`offers.${index}.price`, offer.price] as [string, unknown]] : []),
      [`offers.${index}.url`, offer.url],
      [`offers.${index}.kind`, offer.metadata?.offerKind],
      [`offers.${index}.duration`, offer.duration],
      [`offers.${index}.serviceArea`, offer.serviceArea],
      [`offers.${index}.availability`, offer.availability],
    ]
    fields.forEach(([field, value]) => evidence.push(makeEvidence(field, value, offerSource, sourceText, offer.confidence || 0.6)))
  })
  const aiEvidence = uniqueEvidence(evidence)
  const aiDraftAttempt: AiDraftAttempt = skipLlm
    ? { draft: null, skippedReason: 'AI extraction disabled for this run.' }
    : await llmExtractDraftWithStatus(aiEvidence, guidance).catch((error) => ({
        draft: null,
        skippedReason: error instanceof Error ? error.message.slice(0, 180) : 'AI draft extraction failed.',
      } satisfies AiDraftAttempt))
  const aiDraft = aiDraftAttempt.draft
  let aiStatus = aiStatusFromAttempt(
    aiDraftAttempt,
    'structured_ai',
    Boolean(aiDraft),
    'AI draft extraction did not return usable cited data.',
  )

  if (aiDraft?.offers?.length) {
    rich = mergeOffers(rich, aiDraft.offers)
  }

  if (skipLlm || !isLlmConfigured()) {
    aiStatus = deterministicAiStatus()
  }

  // Attach booking links
  for (const o of rich) {
    const lower = o.name.toLowerCase()
    for (const link of businessDetails.actionLinks || []) {
      const label = link.label.toLowerCase()
      if (lower.includes(label.slice(0, 10)) || label.includes(lower.slice(0, 10))) {
        if (!o.url || canonicalUrlKey(o.url) === canonicalUrlKey(url)) o.url = link.url
        break
      }
    }
  }

  rich = applyGuidanceToOffers(rich, guidance, url)
  const pricedProducts = rich.filter((offer) => (
    offer.metadata?.offerKind === 'product' && offer.price && !/^(?:custom|unknown|see options|confirm)$/i.test(offer.price)
  )).length
  const pricedServices = rich.filter((offer) => (
    offer.metadata?.offerKind === 'service' && offer.price && !/^(?:custom|unknown|see options|confirm)$/i.test(offer.price)
  )).length
  const softwareIdentity = /\b(?:software|plugin|saas|digital platform|mobile app|web app|issue tracking|project management|product development)\b/i.test(
    `${title} ${detectedDescription} ${url}`,
  )
  const softwareBusiness = softwareIdentity || (pricedProducts >= 2 && pricedProducts >= pricedServices)
  rich = pruneAndRankOffers(rich, url, softwareBusiness)

  // Suggestions remain useful on thin sites, but they are a separate lane.
  // They are never counted as detected offers, never affect readiness, and are
  // never folded into intake without an explicit owner selection.
  const templateSource = sourceFor(url, 'template', 'Industry starter suggestion', 'Nexez starter suggestion')
  const detectedNames = new Set(rich.map((offer) => offer.name.toLowerCase()))
  const suggestedOffers = rich.length >= 2
    ? []
    : industrySeeds(industry, url)
        .filter((offer) => !detectedNames.has(offer.name.toLowerCase()))
        .slice(0, 2)
        .map((offer) => withProvenance(offer, templateSource, 0))

  const servicesText = rich.map(o => {
    let line = `${o.name} | ${o.price} | ${o.description || o.name} | ${o.url || url}`
    if (o.duration) line += ` | ${o.duration}`
    if (o.serviceArea) line += ` | ${o.serviceArea}`
    if (o.travelFee) line += ` | ${o.travelFee}`
    if (o.isMobile) line += ` | Mobile`
    return line
  }).join('\n')

  const boostKeywords = getIndustryBoostKeywords(industry)
  let structuredOffers = rich.map(o => {
    const text = `${o.name} ${o.description || ''}`.toLowerCase()
    const relevant = boostKeywords.some(k => text.includes(k))

    return {
      ...o,
      confidence: calibratedOfferConfidence(o, Boolean(relevant && industry)),
    }
  })

  const cleanResultTitle = cleanTitle(aiDraft?.title || title)
  const cleanDescription = aiDraft?.description || description
  const averageConfidence = structuredOffers.length
    ? structuredOffers.reduce((sum, offer) => sum + (offer.confidence || 0.7), 0) / structuredOffers.length
    : 0
  const actionGuidance = guidance.desiredAction || answerForField(guidance, 'action')
  const desiredActionKind = actionKind(actionGuidance || '', '')
  const offerAction = structuredOffers.find((offer) => offer.url && canonicalUrlKey(offer.url) !== canonicalUrlKey(url))
  const rankedActions = [...(businessDetails.actionLinks || [])].sort((a, b) => actionLinkScore(b) - actionLinkScore(a))
  const detectedAction = rankedActions.find((link) => desiredActionKind !== 'other' && link.kind === desiredActionKind)
    || rankedActions[0]
    || (offerAction ? {
      label: offerAction.metadata?.offerKind === 'product' ? `Buy ${offerAction.name}` : `View ${offerAction.name}`,
      url: offerAction.url,
      kind: offerAction.metadata?.offerKind === 'product' ? 'buy' as const : 'other' as const,
    } : undefined)
  const ctaLabel = aiDraft?.cta_label || detectedAction?.label || ctaLabelForAction(actionGuidance)
  const ctaUrl = aiDraft?.cta_url || detectedAction?.url || url
  const inferredIndustry = industry || aiDraft?.industry || null
  const inferredAudience = guidance.targetBuyer || answerForField(guidance, 'audience') || aiDraft?.audience || null
  const detectedServiceArea = structuredOffers.find((offer) => {
    const source = offer.metadata?.provenance as ImportSource | undefined
    return offer.serviceArea && source?.url && canonicalUrlKey(source.url) === canonicalUrlKey(primary.url)
  })?.serviceArea || null
  const inferredLocation = guidance.location || answerForField(guidance, 'location') || businessDetails.address || primaryServiceArea || detectedServiceArea || aiDraft?.location || null
  const importedFaqs = [...detectedFaqs, ...(aiDraft?.faqs || [])].filter((faq, index, values) => (
    values.findIndex((candidate) => candidate.question.toLowerCase() === faq.question.toLowerCase()) === index
  )).slice(0, 5)
  const faqs = importedFaqs
  const suggestedFaqs = importedFaqs.length ? [] : buildGuidedFaqs(cleanResultTitle, structuredOffers, guidance)
  const finalDescription = buildGuidedDescription(cleanResultTitle, cleanDescription, structuredOffers, guidance)

  evidence.push(makeEvidence('business.name', cleanResultTitle, aiDraft?.title ? aiSource : primarySource, detectedTitle || cleanResultTitle, aiDraft?.title ? 0.72 : detectedTitle ? 0.8 : 0.3, aiDraft?.title || !detectedTitle ? 'inferred' : 'detected'))
  if (description) evidence.push(makeEvidence('business.description', description, primarySource, detectedDescription || description, 0.74))
  if (finalDescription !== description) evidence.push(makeEvidence('business.agentDescription', finalDescription, aiDraft?.description ? aiSource : guidanceSource, finalDescription, aiDraft?.description ? 0.72 : 0.55, 'inferred'))
  if (logo_url) evidence.push(makeEvidence('business.logo', logo_url, primarySource, logo_url, 0.7))
  if (inferredLocation) {
    const ownerLocation = Boolean(guidance.location || answerForField(guidance, 'location'))
    const detectedLocation = !ownerLocation && [businessDetails.address, primaryServiceArea, detectedServiceArea].includes(inferredLocation)
    evidence.push(makeEvidence(
      'location',
      inferredLocation,
      ownerLocation ? guidanceSource : detectedLocation ? primarySource : aiSource,
      inferredLocation,
      ownerLocation ? 1 : detectedLocation ? 0.82 : 0.68,
      ownerLocation ? 'owner_confirmed' : detectedLocation ? 'detected' : 'inferred',
    ))
  }
  if (detectedAction) evidence.push(makeEvidence(`action.${detectedAction.kind}`, detectedAction.url, primarySource, detectedAction.label, 0.76))
  if (aiDraft?.cta_url) evidence.push(makeEvidence('action.primary', aiDraft.cta_url, aiSource, aiDraft.cta_url, 0.7, 'inferred'))

  structuredOffers = structuredOffers.map((offer, index) => {
    const source = offer.metadata?.provenance as ImportSource | undefined
    const fallbackSource = sourceFor(offer.url || url, 'heuristic', 'Offer evidence', `Offer ${index + 1}`)
    const offerSource = source || fallbackSource
    const evidenceText = typeof offer.metadata?.evidenceText === 'string' ? offer.metadata.evidenceText : offer.description || offer.name
    const status = offer.metadata?.evidenceStatus === 'inferred' ? 'inferred' : 'detected'
    const fields: Array<[string, unknown]> = [
      [`offers.${index}.name`, offer.name],
      [`offers.${index}.description`, offer.description],
      ...(!/^(?:custom|unknown|see options|confirm)$/i.test(offer.price || '') ? [[`offers.${index}.price`, offer.price] as [string, unknown]] : []),
      [`offers.${index}.url`, offer.url],
      [`offers.${index}.kind`, offer.metadata?.offerKind],
      [`offers.${index}.duration`, offer.duration],
      [`offers.${index}.serviceArea`, offer.serviceArea],
      [`offers.${index}.availability`, offer.availability],
    ]
    const offerEvidence = uniqueEvidence(fields.map(([field, value]) => makeEvidence(
      field,
      value,
      offerSource,
      evidenceText,
      offer.confidence || 0.6,
      status,
    )))
    evidence.push(...offerEvidence)
    return {
      ...offer,
      metadata: {
        ...(offer.metadata || {}),
        evidenceIds: offerEvidence.map((item) => item.id),
      },
    }
  })
  const readiness = buildImportReadiness({
    title: cleanResultTitle,
    description: finalDescription,
    websiteUrl: url,
    ctaUrl,
    audience: inferredAudience,
    industry: inferredIndustry,
    location: inferredLocation,
    offers: structuredOffers,
    faqs,
  })
  const clarifyingQuestions = buildClarifyingQuestions(guidance, structuredOffers, readiness, aiDraft?.clarifyingQuestions || [])
  const sourcesByKey = new Map<string, ImportSource>()
  for (const doc of allDocs) {
    const type: ImportSourceKind = doc.type === 'llms_txt'
      ? 'llms_txt'
      : doc.type === 'agent_json'
        ? 'agent_json'
        : doc.sourceKind || 'common_path'
    const source = sourceFor(doc.url, type, doc.type === 'html' ? 'HTML crawl' : doc.type === 'llms_txt' ? 'Agent-readable text' : 'Agent JSON')
    sourcesByKey.set(`${source.type}:${source.url}`, source)
  }
  for (const offer of structuredOffers) {
    const source = offer.metadata?.provenance as ImportSource | undefined
    if (source?.url) sourcesByKey.set(`${source.type}:${source.url}`, source)
  }
  if (aiDraft) {
    const source = sourceFor(url, 'llm', 'Structured AI draft', 'AI extraction')
    sourcesByKey.set(`${source.type}:${source.url}`, source)
  }
  const sources = Array.from(sourcesByKey.values()).slice(0, 12)

  const reviewNotes = [
    `Checked ${htmlDocs.length} web page${htmlDocs.length === 1 ? '' : 's'} and ${agentDocs.length} agent file${agentDocs.length === 1 ? '' : 's'}.`,
    aiStatus.used
      ? `Structured AI extraction contributed to this draft via ${aiStatus.model}.`
      : aiStatus.configured
        ? `AI extraction was attempted but the deterministic importer produced the usable draft. Reason: ${aiStatus.reason}`
        : 'Used deterministic extraction; add an LLM key later for deeper extraction on messy sites.',
    guidance.targetBuyer ? `Target buyer applied: ${guidance.targetBuyer}.` : 'No target buyer provided; using general buyer language.',
    guidance.offerFocus ? `Offer focus applied: ${guidance.offerFocus}.` : 'No offer focus provided; keeping all detected offers.',
    actionGuidance ? `Preferred action set to "${ctaLabel}".` : `Default action set to "${ctaLabel}".`,
    guidance.clarifyingAnswers?.length ? `${guidance.clarifyingAnswers.length} owner answer${guidance.clarifyingAnswers.length === 1 ? '' : 's'} applied to refine this draft.` : '',
    `Agent readiness estimate: ${readiness.score}%.`,
    structuredOffers.length === 0
      ? 'No offers were labeled as detected because the source did not provide enough supporting evidence.'
      : averageConfidence < 0.72
        ? 'Import confidence is moderate. Review offer names, prices, and booking links before publishing.'
        : 'Import confidence is healthy. Still review pricing and action links before publishing.',
    suggestedOffers.length
      ? `${suggestedOffers.length} starter suggestion${suggestedOffers.length === 1 ? '' : 's'} prepared separately because the source did not provide enough offer evidence.`
      : '',
    ...(aiDraft?.reviewNotes || []),
  ].filter(Boolean)

  for (const [index, offer] of suggestedOffers.entries()) {
    evidence.push(makeEvidence(
      `suggestions.${index}.name`,
      offer.name,
      templateSource,
      'Industry starter suggestion. This value was not detected on the source website.',
      0,
      'suggested',
    ))
  }
  const citedEvidenceIds = new Set(structuredOffers.flatMap((offer) => (
    Array.isArray(offer.metadata?.evidenceIds) ? offer.metadata.evidenceIds as string[] : []
  )))
  const finalEvidence = uniqueEvidence([
    ...evidence.filter((item) => item && citedEvidenceIds.has(item.id)),
    ...evidence,
  ], 400)
  const extractionMethods = finalEvidence.reduce<Record<string, number>>((counts, item) => {
    counts[item.method] = (counts[item.method] || 0) + 1
    return counts
  }, {})
  const sourceFingerprint = createHash('sha256').update(allDocs.map((doc) => {
    const body = doc.html || doc.text
    return `${doc.type}:${canonicalUrlKey(doc.url)}:${createHash('sha256').update(body).digest('hex')}`
  }).join('\n')).digest('hex')

  const result: ImportResult = {
    title: cleanResultTitle,
    description: finalDescription,
    website_url: url,
    structuredOffers,
    suggestedOffers,
    suggestedFaqs,
    servicesText,
    industry: inferredIndustry,
    audience: inferredAudience,
    location: inferredLocation,
    cta_label: ctaLabel,
    cta_url: ctaUrl,
    faqs,
    reviewNotes: reviewNotes.slice(0, 9),
    sources,
    evidence: finalEvidence,
    businessDetails,
    telemetry: {
      importerVersion: IMPORTER_VERSION,
      cacheHit: false,
      durationMs: Date.now() - analysisStartedAt,
      pagesConsidered,
      pagesUsed: htmlDocs.length,
      sourceFingerprint,
      extractionMethods,
      skippedPages: skippedPages.slice(0, 30),
    },
    clarifyingQuestions,
    readiness,
    confidence: averageConfidence,
    pagesAnalyzed: htmlDocs.length,
    agentDocumentsAnalyzed: agentDocs.length,
    logo_url,
    aiStatus,
  }

  setCached(url, guidance, skipLlm, result)
  return result
}

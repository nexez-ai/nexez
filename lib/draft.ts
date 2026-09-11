// D12 - staging: draft content that can be previewed before it goes live.
// Pure helpers shared by the editor (save/publish) and the public page
// (owner-only preview overlay). Drafts are owner-only; never selected for
// anonymous public reads.
import { FaqItem, OfferItem } from './agent-page'

export type PageDraft = {
  name?: string
  description?: string | null
  services?: OfferItem[] | null
  products?: OfferItem[] | null
  faqs?: FaqItem[] | null
  industry?: string | null
  prefer_original_site?: boolean
}

const DRAFT_FIELDS = new Set([
  'name', 'description', 'services', 'products', 'faqs', 'industry', 'prefer_original_site',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
}

/** Preserve supported legacy content; refuse shapes that publication would discard. */
export function isSupportedPageDraft(value: unknown): value is PageDraft {
  if (!isRecord(value)) return false
  return Object.entries(value).every(([key, entry]) => {
    if (!DRAFT_FIELDS.has(key)) return false
    if (entry === undefined) return true
    if (key === 'name') return typeof entry === 'string'
    if (key === 'description' || key === 'industry') return entry === null || typeof entry === 'string'
    if (key === 'prefer_original_site') return typeof entry === 'boolean'
    if (entry === null) return true
    if (!Array.isArray(entry)) return false
    if (key === 'faqs') return entry.every(item => isRecord(item) && typeof item.question === 'string' && typeof item.answer === 'string')
    return entry.every(item => isRecord(item) && typeof item.name === 'string')
  })
}

export function hasPendingDraft(page: { draft?: unknown } | null | undefined): boolean {
  const d = page?.draft
  return Boolean(d && typeof d === 'object' && !Array.isArray(d) && Object.keys(d as object).length > 0)
}

/** Overlay draft content onto a live page object (for preview rendering). */
export function applyDraftOverlay<T extends Record<string, unknown>>(
  page: T,
  draft: PageDraft | null | undefined,
): T {
  if (!draft) return page
  const overlay: Record<string, unknown> = {}
  if (draft.name !== undefined) overlay.name = draft.name
  if (draft.description !== undefined) overlay.description = draft.description
  if (draft.services !== undefined) overlay.services = draft.services
  if (draft.products !== undefined) overlay.products = draft.products
  if (draft.faqs !== undefined) overlay.faqs = draft.faqs
  if (draft.industry !== undefined) overlay.industry = draft.industry
  if (draft.prefer_original_site !== undefined) overlay.prefer_original_site = draft.prefer_original_site
  return { ...page, ...overlay }
}

/** Publish staged fields only. An omitted field keeps its current live value. */
export function draftToLiveUpdate(draft: PageDraft): Record<string, unknown> {
  if (!isSupportedPageDraft(draft)) throw new Error('This draft contains unsupported content and cannot be published safely.')
  return applyDraftOverlay({}, draft)
}

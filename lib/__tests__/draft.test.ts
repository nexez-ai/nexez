import { describe, expect, it } from 'vitest'
import { applyDraftOverlay, draftToLiveUpdate, hasPendingDraft, type PageDraft } from '../draft'

describe('hasPendingDraft', () => {
  it('true only for a non-empty draft object', () => {
    expect(hasPendingDraft({ draft: { name: 'x' } })).toBe(true)
    expect(hasPendingDraft({ draft: {} })).toBe(false)
    expect(hasPendingDraft({ draft: null })).toBe(false)
    expect(hasPendingDraft({})).toBe(false)
    expect(hasPendingDraft(null)).toBe(false)
    expect(hasPendingDraft({ draft: [] as unknown })).toBe(false) // arrays don't count
  })
})

describe('applyDraftOverlay', () => {
  const live = {
    name: 'Live Name',
    description: 'live desc',
    services: [{ name: 'a' }],
    products: [],
    faqs: [],
    industry: 'plumbing',
    prefer_original_site: false,
    slug: 'acme',
  } as Record<string, unknown>

  it('overlays only provided draft fields, preserving the rest', () => {
    const draft: PageDraft = { name: 'Draft Name', services: [{ name: 'b' }, { name: 'c' }] as never }
    const out = applyDraftOverlay(live, draft)
    expect(out.name).toBe('Draft Name')
    expect((out.services as unknown[]).length).toBe(2)
    expect(out.description).toBe('live desc') // untouched
    expect(out.slug).toBe('acme') // non-content field preserved
  })

  it('returns the page unchanged when no draft', () => {
    expect(applyDraftOverlay(live, null)).toBe(live)
  })
})

describe('draftToLiveUpdate', () => {
  it('publishes only staged fields, preserving every omitted live field', () => {
    expect(draftToLiveUpdate({ name: 'X' })).toEqual({
      name: 'X',
    })
  })

  it('preserves offers and website preference when publishing a re-interview draft', () => {
    const live = {
      name: 'Merchant', description: 'Before', services: [{ name: 'Configured offer', rules: { minimum: 42 } }],
      products: [{ name: 'Product', provider: { id: 'external-1' } }], faqs: [], industry: 'services',
      prefer_original_site: true, is_published: false,
    }
    const draft = { description: 'Reviewed description' }
    expect({ ...live, ...draftToLiveUpdate(draft) }).toEqual({ ...live, description: draft.description })
  })

  it('distinguishes explicit clearing from omission', () => {
    expect(draftToLiveUpdate({ description: null, faqs: [], prefer_original_site: false })).toEqual({
      description: null, faqs: [], prefer_original_site: false,
    })
    expect(draftToLiveUpdate({ description: undefined })).toEqual({})
  })

  it.each([
    { description: 'Reviewed', is_published: true },
    { description: 'Reviewed', unknown_legacy_field: 'retain me' },
    { prefer_original_site: 'false' },
    { services: 'not an array' },
    { faqs: [{ question: 'Question', answer: 42 }] },
    ['not an object'],
  ])('rejects unsupported persisted draft shapes instead of silently discarding data: %j', (draft) => {
    expect(() => draftToLiveUpdate(draft as unknown as PageDraft)).toThrow(/draft/i)
  })

  it('passes through provided values', () => {
    const draft: PageDraft = {
      name: 'Y',
      description: 'd',
      services: [{ name: 's' }] as never,
      products: [{ name: 'p' }] as never,
      faqs: [{ question: 'q', answer: 'a' }],
      industry: 'massage',
      prefer_original_site: true,
    }
    const out = draftToLiveUpdate(draft)
    expect(out.industry).toBe('massage')
    expect(out.prefer_original_site).toBe(true)
    expect((out.services as unknown[]).length).toBe(1)
  })
})

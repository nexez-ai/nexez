// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePageEditor } from './usePageEditor'
import type { EditorInitial } from './types'

const refs = vi.hoisted(() => ({
  from: vi.fn(), update: vi.fn(), eq: vi.fn(), select: vi.fn(), maybeSingle: vi.fn(),
  response: { data: null, error: null } as { data: unknown; error: { message: string } | null },
}))
vi.mock('../../utils/supabase/client', () => ({ createClient: () => ({ from: refs.from }) }))
vi.mock('../public-identifier/PublicIdentifierFeedback', () => ({
  usePublicIdentifierAvailability: () => ({ result: { available: true } }),
}))

const initial: EditorInitial = {
  page: {
    id: '11111111-1111-4111-8111-111111111111', owner_id: '22222222-2222-4222-8222-222222222222',
    name: 'Merchant', slug: 'merchant', description: 'Live description', website_url: 'https://example.com',
    cta_url: 'https://example.com/contact', cta_label: 'Contact', audience: null, location: null,
    contact_email: null, services: [], products: [], faqs: [], industry: 'services',
    prefer_original_site: true, is_published: false, updated_at: '2026-09-10T12:00:00.000001Z',
    draft: { description: 'Staged description' }, draft_updated_at: '2026-09-10T11:00:00Z',
  },
  commerceTemplateLineage: null, recentCalendlyBookings: [], recentOutboundFires: [], trustEvents: [],
  aiFeaturesEnabled: false, integrationsEnabled: false, outboundWebhooksEnabled: false,
  teamCollaborationEnabled: false, negotiationEnabled: false, shopifyConnection: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  sessionStorage.clear()
  window.history.replaceState({}, '', '/')
  refs.response = { data: null, error: null }
  const query = {
    update: refs.update, eq: refs.eq, select: refs.select, maybeSingle: refs.maybeSingle,
    then: (resolve: (value: typeof refs.response) => unknown) => Promise.resolve(refs.response).then(resolve),
  }
  refs.from.mockReturnValue(query)
  refs.update.mockReturnValue(query)
  refs.eq.mockReturnValue(query)
  refs.select.mockReturnValue(query)
  refs.maybeSingle.mockImplementation(async () => refs.response)
})

describe('merchant editor draft handoff', () => {
  it('hydrates staged content while retaining omitted live values', () => {
    const { result } = renderHook(() => usePageEditor(initial))
    expect(result.current.description).toBe('Staged description')
    expect(result.current.name).toBe('Merchant')
    expect(result.current.preferOriginalSite).toBe(true)
    expect(result.current.page.description).toBe('Live description')
  })

  it.each(['handleSaveDraft', 'handlePublishDraft', 'handleSubmit'] as const)('%s rejects a zero-row update and retains local work', async (handler) => {
    const { result } = renderHook(() => usePageEditor(initial))
    await act(async () => {
      if (handler === 'handleSubmit') await result.current.handleSubmit({ preventDefault() {} } as React.FormEvent)
      else await result.current[handler]()
    })
    expect(result.current.message).toMatch(/changed|access|reload/i)
    expect(result.current.page).toEqual(initial.page)
    expect(result.current.saving).toBe(false)
    expect(refs.eq).toHaveBeenCalledWith('updated_at', initial.page.updated_at)
    expect(refs.eq).toHaveBeenCalledWith('owner_id', initial.page.owner_id)
  })

  it('uses the returned server version for the next write', async () => {
    const updated = { ...initial.page, draft: { description: 'Staged description' }, updated_at: '2026-09-10T12:01:00.000002Z' }
    refs.response.data = updated
    const { result } = renderHook(() => usePageEditor(initial))
    await act(async () => { await result.current.handleSaveDraft() })
    expect(result.current.page.updated_at).toBe(updated.updated_at)
    refs.eq.mockClear()
    await act(async () => { await result.current.handlePublishDraft() })
    expect(refs.eq).toHaveBeenCalledWith('updated_at', updated.updated_at)
  })

  it('refuses a write when its server version is missing', async () => {
    const { result } = renderHook(() => usePageEditor({ ...initial, page: { ...initial.page, updated_at: undefined } }))
    await act(async () => { await result.current.handleSaveDraft() })
    expect(refs.update).not.toHaveBeenCalled()
    expect(result.current.message).toMatch(/reload/i)
  })

  it('does not clear an unsupported legacy draft', async () => {
    const { result } = renderHook(() => usePageEditor({ ...initial, page: { ...initial.page, draft: { unknown_legacy_field: 'private work' } } }))
    await act(async () => { await result.current.handlePublishDraft() })
    expect(refs.update).not.toHaveBeenCalled()
    expect(result.current.message).toMatch(/draft/i)
  })

  it('recovers the save controls after a connection failure', async () => {
    refs.maybeSingle.mockRejectedValueOnce(new Error('connection failed'))
    const { result } = renderHook(() => usePageEditor(initial))
    await act(async () => { await result.current.handleSaveDraft() })
    expect(result.current.saving).toBe(false)
    expect(result.current.message).toMatch(/connection|retry|could not/i)
    expect(result.current.page).toEqual(initial.page)
  })

  it('allows only one pending write across save and publish', async () => {
    let finish!: (value: typeof refs.response) => void
    refs.maybeSingle.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const { result } = renderHook(() => usePageEditor(initial))
    let pending!: Promise<void>
    await act(async () => {
      pending = result.current.handleSaveDraft()
      await result.current.handlePublishDraft()
    })
    expect(refs.update).toHaveBeenCalledTimes(1)
    await act(async () => { finish({ data: initial.page, error: null }); await pending })
    expect(result.current.saving).toBe(false)
  })

  it('publishing never changes the page publication flag or unstaged fields', async () => {
    refs.response.data = { ...initial.page, description: 'Staged description', draft: null }
    const { result } = renderHook(() => usePageEditor(initial))
    await act(async () => { await result.current.handlePublishDraft() })
    expect(refs.update).toHaveBeenCalledWith({ description: 'Staged description', draft: null, draft_updated_at: null })
    expect(result.current.page.is_published).toBe(false)
  })
})

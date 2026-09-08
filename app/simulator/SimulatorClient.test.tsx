// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '../../test/dom'
import GlobalAgentSimulator from './SimulatorClient'
import { getDemoPage, runMultiAgentSimulation } from '../../lib/agent-simulator'

const { planRef, pagesRef } = vi.hoisted(() => ({
  planRef: { value: 'free' as 'free' | 'launch' },
  pagesRef: { value: [] as unknown[] },
}))

vi.mock('../../components/billing/PlanProvider', () => ({
  usePlan: () => planRef.value,
}))

vi.mock('../../utils/supabase/client', () => ({
  createClient: () => {
    const query: any = {
      select: () => query,
      eq: () => query,
      order: () => query,
      limit: () => query,
      returns: async () => ({ data: pagesRef.value, error: null }),
      single: async () => ({ data: null, error: null }),
    }
    return {
      auth: { getUser: async () => ({ data: { user: { id: 'owner-1' } } }) },
      from: () => query,
    }
  },
}))

const comparison = {
  url: 'https://existing.example',
  host: 'existing.example',
  agentReady: {
    name: 'Existing',
    description: null,
    audience: null,
    location: null,
    offers: [],
    offerCount: 0,
    pricedCount: 0,
    faqCount: 0,
    readiness: 25,
    pagesAnalyzed: 1,
    confidence: 0.5,
  },
  raw: {
    title: 'Existing',
    nativeStructuredData: false,
    nativeAgentDocs: false,
    actionable: false as const,
    summary: 'Unstructured public site.',
  },
  gains: ['Structured offers'],
  verdict: 'A deterministic comparison.',
}

const savedRun = {
  id: '123e4567-e89b-42d3-a456-426614174000',
  kind: 'url_snapshot',
  targetUrl: comparison.url,
  targetHost: comparison.host,
  comparedPageId: null,
  comparedPageSlug: null,
  result: comparison,
  evidence: {},
  createdAt: '2026-08-21T00:00:00.000Z',
}

describe('Agent Lab URL research plan gate', () => {
  let postedBody: Record<string, unknown> | null

  beforeEach(() => {
    planRef.value = 'free'
    pagesRef.value = []
    postedBody = null
    window.history.replaceState({}, '', '/simulator?mode=url')
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/api/agent-lab/research-runs')) {
        return new Response(JSON.stringify({ runs: [savedRun] }), { status: 200 })
      }
      if (url.includes('/api/simulate-url')) {
        postedBody = JSON.parse(String(init?.body || '{}'))
        return new Response(JSON.stringify({ ok: true, ...comparison }), { status: 200 })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }))
  })

  it('disables new private saves below Launch while retaining saved replay and removal controls', async () => {
    render(<GlobalAgentSimulator />)

    const save = await screen.findByRole('checkbox', { name: /Save this scan privately/ })
    expect(save).toBeDisabled()
    expect(screen.getByText(/New private reports require Launch or above/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Launch/ })).toBeInTheDocument()

    expect(await screen.findByText('existing.example')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open scan' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove saved scan for existing.example' })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Public website URL'), { target: { value: 'https://new.example' } })
    fireEvent.click(screen.getByRole('button', { name: 'Simulate' }))
    await waitFor(() => expect(postedBody).toMatchObject({ url: 'https://new.example', save: false }))
  })

  it('allows a Launch owner to opt into a new private report', async () => {
    planRef.value = 'launch'
    render(<GlobalAgentSimulator />)

    const save = await screen.findByRole('checkbox', { name: /Save this scan privately/ })
    expect(save).toBeEnabled()
    expect(save).not.toBeChecked()
    fireEvent.click(save)
    fireEvent.change(screen.getByLabelText('Public website URL'), { target: { value: 'https://new.example' } })
    fireEvent.click(screen.getByRole('button', { name: 'Simulate' }))

    await waitFor(() => expect(postedBody).toMatchObject({ url: 'https://new.example', save: true }))
  })
})

describe('Agent Lab history response ordering', () => {
  it.each(['empty', 'server error', 'network error'])('keeps the saved run when an older history request finishes with %s', async (outcome) => {
    planRef.value = 'launch'
    const listing = { ...getDemoPage(), id: 'listing-race', owner_id: 'owner-1', name: 'History race listing', slug: 'history-race', is_published: true }
    pagesRef.value = [listing]
    window.history.replaceState({}, '', '/simulator?mode=test')
    const run = {
      id: 'saved-race-run', ownerId: 'owner-1', pageId: listing.id, pageSlug: listing.slug,
      query: 'Find services', engineVersion: 'test', executionMode: 'deterministic', readiness: 80,
      createdAt: '2026-09-07T00:00:00.000Z', persisted: true,
      result: { ...runMultiAgentSimulation(listing, 'Find services'), recommendations: [], overallReadiness: 80, success: null, rankAnalysis: null },
      evidence: {
        execution: { boundary: 'server', engineVersion: 'test', deterministicAgents: 5, llm: { requested: false, executed: false, model: null, reason: 'not_requested' } },
        competitiveField: { rankingPolicy: 'test', visiblePagesEvaluated: 1, totalPublished: 1, complete: true, cap: 1000 },
        commerce: { offersInspected: 0, runtimeDryRuns: 0, scope: 'published_contract', notice: 'No transaction executed.', offers: [] },
      },
    }
    let resolveOld!: (response: Response) => void
    let rejectOld!: (error: Error) => void
    const oldHistory = new Promise<Response>((resolve, reject) => { resolveOld = resolve; rejectOld = reject })
    let historyRequests = 0
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/simulator/runs')) {
        if (init?.method === 'POST') return new Response(JSON.stringify({ run, persisted: true }), { status: 200 })
        historyRequests += 1
        if (historyRequests === 1) return oldHistory
        return new Response(JSON.stringify({ runs: [run] }), { status: 200 })
      }
      if (url.startsWith('/api/agent-lab/research-runs')) return new Response(JSON.stringify({ runs: [] }), { status: 200 })
      throw new Error(`Unexpected fetch: ${url}`)
    }))

    render(<GlobalAgentSimulator />)
    fireEvent.click(await screen.findByRole('button', { name: listing.name }))
    await screen.findByText('Analysis complete and saved as an immutable Agent Lab run.')
    await act(async () => {
      if (outcome === 'network error') rejectOld(new Error('stale history network failure'))
      else resolveOld(new Response(JSON.stringify(outcome === 'empty' ? { runs: [] } : { error: 'stale history server failure' }), { status: outcome === 'empty' ? 200 : 503 }))
    })
    await waitFor(() => expect(screen.getByText('1 saved runs for this listing')).toBeInTheDocument())
    expect(screen.queryByText(/stale history/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Saved listing runs could not be loaded/)).not.toBeInTheDocument()
  })
})

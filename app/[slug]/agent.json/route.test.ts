import { describe, it, expect, vi, beforeEach } from 'vitest'

const { dbRef, storefrontRef, reviewRef } = vi.hoisted(() => ({
  dbRef: { handler: (_c: any) => ({ data: null, error: null }) as { data?: any; error?: any } },
  storefrontRef: { handle: null as string | null },
  reviewRef: {
    summary: {
      average: null,
      count: 0,
      verified_count: 0,
      reputation_score: 0,
      distribution: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 },
      recent_positive_tags: [],
      recent_reviews: [],
    } as any,
  },
}))

vi.mock('../../../lib/supabase', async () => {
  const { createSupabaseMock } = await import('../../../test/supabase-mock')
  return { supabase: createSupabaseMock((c) => dbRef.handler(c)) }
})
vi.mock('next/server', async (importOriginal) => ({ ...(await importOriginal<typeof import('next/server')>()), after: () => {} }))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND') } }))
vi.mock('../../../lib/server/log-agent-page-view', () => ({ logAgentPageView: vi.fn() }))
vi.mock('../../../lib/server/storefront', () => ({
  loadStorefrontHandleForSlug: vi.fn(async () => storefrontRef.handle),
}))
vi.mock('../../../lib/server/reviews', () => ({
  loadReviewSummaryForSlug: vi.fn(async () => reviewRef.summary),
}))

import { GET } from './route'

const demoPage = {
  id: 'p1',
  owner_id: 'o1',
  slug: 'demo',
  name: 'Demo Co',
  description: 'A demo business.',
  website_url: 'https://demo.example.com',
  cta_url: 'https://demo.example.com/book',
  cta_label: 'Book',
  audience: 'startups',
  location: 'Remote',
  contact_email: 'hi@demo.example.com',
  industry: 'Consulting',
  services: [{ name: 'Consult', price: '$100', description: 'A call', url: '' }],
  products: [],
  faqs: [{ question: 'q', answer: 'a' }],
  is_published: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
  branding: null,
}

const req = () => new Request('https://nexez.test/demo/agent.json')
const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) })

describe('GET /[slug]/agent.json', () => {
  beforeEach(() => {
    dbRef.handler = () => ({ data: null, error: null })
    storefrontRef.handle = null
    reviewRef.summary = {
      average: null,
      count: 0,
      verified_count: 0,
      reputation_score: 0,
      distribution: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 },
      recent_positive_tags: [],
      recent_reviews: [],
    }
  })

  it('returns the agent manifest JSON for a published page', async () => {
    dbRef.handler = () => ({ data: demoPage, error: null })
    const res = await GET(req(), ctx('demo'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    // Cross-origin fetchable (the redirect recipe / plugin lands agents here) while
    // keeping the host-poison guard.
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect((res.headers.get('vary') || '').toLowerCase()).toContain('x-forwarded-host')
    // Out of Google's index, but still crawlable/fetchable by agents.
    expect(res.headers.get('x-robots-tag')).toBe('noindex')
    const body = await res.json()
    expect(JSON.stringify(body)).toContain('demo') // references the page
  })

  it('includes storefront context when the listing owner has a storefront', async () => {
    dbRef.handler = () => ({ data: demoPage, error: null })
    storefrontRef.handle = 'demo-store'
    const res = await GET(req(), ctx('demo'))
    const body = await res.json()
    expect(body.storefront.handle).toBe('demo-store')
    expect(body.storefront.url).toMatch(/^https:\/\/.+\/store\/demo-store$/)
    expect(body.storefront.agent_json_url).toMatch(/^https:\/\/.+\/store\/demo-store\/agent\.json$/)
    expect(body.plain_text).toContain(`Storefront: ${body.storefront.url}`)
  })

  it('preserves direct reviewer artifact access when a fixture is excluded from discovery', async () => {
    const slug = 'shopify-review-rehearsal-20260908'
    dbRef.handler = () => ({ data: { ...demoPage, slug, marketplace_discoverable: false }, error: null })
    const res = await GET(new Request(`https://nexez.test/${slug}/agent.json`), ctx(slug))
    expect(res.status).toBe(200)
    expect(JSON.stringify(await res.json())).toContain(slug)
  })

  it('includes verified review summaries when present', async () => {
    dbRef.handler = () => ({ data: demoPage, error: null })
    reviewRef.summary = {
      average: 4.9,
      count: 7,
      verified_count: 7,
      reputation_score: 4.55,
      distribution: { '1': 0, '2': 0, '3': 0, '4': 1, '5': 6 },
      recent_positive_tags: [{ label: 'Agent-friendly', count: 5 }],
      recent_reviews: [{ id: 'r1', rating: 5, title: 'Great', body: 'Clear.', tags: [], createdAt: '2026-06-20T00:00:00Z' }],
    }

    const res = await GET(req(), ctx('demo'))
    const body = await res.json()

    expect(body.page.rating_summary).toMatchObject({
      average: 4.9,
      count: 7,
      reputation_score: 4.55,
    })
    expect(body.plain_text).toContain('Verified rating: 4.9/5 from 7 purchase reviews')
  })

  it('advertises root artifact URLs on a verified custom host that contains nexez', async () => {
    dbRef.handler = () => ({
      data: {
        ...demoPage,
        custom_domain: 'closure-950d06c.nexez.ai',
        custom_domain_verified: '2026-08-25T19:16:54Z',
        domain_path: '/',
      },
      error: null,
    })
    const customRequest = new Request('https://closure-950d06c.nexez.ai/agent.json', {
      headers: { host: 'closure-950d06c.nexez.ai' },
    })

    const res = await GET(customRequest, ctx('demo'))
    const body = await res.json()

    expect(body.page.url).toBe('https://closure-950d06c.nexez.ai')
    expect(body.page.agent_json_url).toBe('https://closure-950d06c.nexez.ai/agent.json')
    expect(body.page.llms_url).toBe('https://closure-950d06c.nexez.ai/llms.txt')
    expect(body.page.openapi_url).toBe('https://closure-950d06c.nexez.ai/openapi.json')
  })

  it('calls notFound() for a missing/unpublished page', async () => {
    dbRef.handler = () => ({ data: null, error: { message: 'none' } })
    await expect(GET(req(), ctx('missing'))).rejects.toThrow('NEXT_NOT_FOUND')
  })
})

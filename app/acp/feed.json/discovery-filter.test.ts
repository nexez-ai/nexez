import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET as getAcpFeed } from './route'
import { GET as getUcpFeed } from '../../ucp/feed.json/route'

const mocks = vi.hoisted(() => ({ rows: vi.fn(), eligible: vi.fn() }))
vi.mock('../../../lib/supabase', () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ order: () => ({ returns: mocks.rows }) }) }) }) },
}))
vi.mock('../../../lib/server/agentic-commerce-eligibility', () => ({
  acpCheckoutEligibleSlugs: mocks.eligible,
  ucpCheckoutEligibleSlugs: mocks.eligible,
}))

const page = (slug: string) => ({
  slug, name: slug, description: 'Catalog', currency: 'usd', is_published: true,
  marketplace_discoverable: true,
  products: [{ name: 'Sample product', description: 'Product', price: '$20', url: '' }],
  services: [],
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.rows.mockResolvedValue({ data: [page('shopify-review-rehearsal-20260908'), page('ordinary-merchant')] })
  mocks.eligible.mockResolvedValue(null)
})

describe('public commerce feed fixture isolation', () => {
  it.each([['ACP', getAcpFeed], ['UCP', getUcpFeed]] as const)('%s filters fixtures before checkout eligibility and projection', async (_name, handler) => {
    const response = await handler(new Request('https://nexez.app/acp/feed.json'))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.products).toHaveLength(1)
    expect(JSON.stringify(body.products)).toContain('ordinary-merchant')
    expect(JSON.stringify(body.products)).not.toContain('shopify-review-rehearsal')
    expect(mocks.eligible).toHaveBeenCalledWith(['ordinary-merchant'])
  })
})

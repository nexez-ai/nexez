import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), limiter: vi.fn(), read: vi.fn(), command: vi.fn(), collect: vi.fn(), hasAdmin: vi.fn() }))
vi.mock('@/lib/server/request-auth', () => ({ resolveRequestAuth: mocks.auth }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: mocks.limiter }))
vi.mock('@/utils/supabase/admin', () => ({ hasSupabaseAdminEnv: mocks.hasAdmin }))
vi.mock('@/lib/server/merchant-website-baselines', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/server/merchant-website-baselines')>(),
  readWebsiteBaseline: mocks.read, commandWebsiteBaseline: mocks.command, collectWebsiteBaseline: mocks.collect,
}))
import { WebsiteBaselineError } from '@/lib/server/merchant-website-baselines'
import { GET, POST } from './route'
const ownerId = 'ad000000-0000-4000-8000-000000000001'
const listingId = 'bd000000-0000-4000-8000-000000000001'
const associationId = 'cd000000-0000-4000-8000-000000000001'
const idempotencyKey = 'dd000000-0000-4000-8000-000000000001'
const client = {}
const body = { action: 'approve', listingId, origin: 'https://example.com', attested: true, approvalVersion: 'merchant-website-v1', idempotencyKey }
const post = (value: unknown = body, headers: HeadersInit = {}) => new Request('https://app.nexez.ai/api/merchant/website-baseline', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(value),
})
beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue({ user: { id: ownerId }, supabase: client })
  mocks.limiter.mockResolvedValue(null)
  mocks.hasAdmin.mockReturnValue(true)
  mocks.command.mockResolvedValue(idempotencyKey)
  mocks.read.mockResolvedValue({ ownerId, listingId, collectionEnabled: true, suggestedOrigin: body.origin, association: null, latest: null, attempt: null })
})
describe('website baseline API authority and transport', () => {
  it('requires current sign-in for reads and writes before touching sources', async () => {
    for (const user of [null, { id: ownerId, is_anonymous: true }]) {
      mocks.auth.mockResolvedValue({ user, supabase: client })
      for (const response of [await GET(new Request(`https://app.nexez.ai/api/merchant/website-baseline?listingId=${listingId}`)), await POST(post())]) {
        expect(response.status).toBe(401)
        expect(response.headers.get('cache-control')).toBe('private, no-store')
      }
    }
    expect(mocks.read).not.toHaveBeenCalled()
    expect(mocks.command).not.toHaveBeenCalled()
  })
  it.each([`listingId=${listingId}&listingId=${listingId}`, `listingId=${listingId}&ownerId=${ownerId}`, 'listingId=bad', ''])('rejects invalid or authority-bearing query %s', async query => {
    expect((await GET(new Request(`https://app.nexez.ai/api/merchant/website-baseline?${query}`))).status).toBe(400)
    expect(mocks.read).not.toHaveBeenCalled()
  })
  it.each([{ ...body, attested: false }, { ...body, ownerId }, { ...body, provenance: 'merchant_website_snapshot' }, { ...body, result: {} },
    { ...body, approvalVersion: 'domain_verified' }, { ...body, origin: 'http://127.0.0.1' }, { ...body, origin: 'https://example.com/private' }])('rejects forged or incomplete approval', async value => {
    expect((await POST(post(value))).status).toBe(400)
    expect(mocks.command).not.toHaveBeenCalled()
  })
  it('rejects cross-origin requests and oversized bodies before commands', async () => {
    expect((await POST(post(body, { Origin: 'https://evil.com' }))).status).toBe(403)
    expect((await POST(post('x'.repeat(40_000)))).status).toBe(413)
    expect(mocks.command).not.toHaveBeenCalled()
  })
  it('approves without fetching and returns a freshly authorized view', async () => {
    const response = await POST(post())
    expect(response.status).toBe(200)
    expect(response.headers.get('vary')).toBe('Cookie, Authorization')
    expect(mocks.command).toHaveBeenCalledWith(client, ownerId, body)
    expect(mocks.collect).not.toHaveBeenCalled()
    expect(mocks.read).toHaveBeenCalledWith(client, ownerId, listingId)
  })
  it('collects only the reservation returned by the session and rereads after completion', async () => {
    const response = await POST(post({ action: 'collect', listingId, associationId, idempotencyKey }))
    expect(response.status).toBe(200)
    expect(mocks.collect).toHaveBeenCalledWith(idempotencyKey, ownerId, listingId, associationId)
    expect(mocks.read.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.collect.mock.invocationCallOrder[0])
  })
  it('does not expose a captured result after ownership changes before the final read', async () => {
    mocks.read.mockRejectedValue(new WebsiteBaselineError(404, 'Listing not found.'))
    const response = await POST(post({ action: 'collect', listingId, associationId, idempotencyKey }))
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Listing not found.' })
  })
  it('does not reserve a request if the collector is unavailable', async () => {
    mocks.hasAdmin.mockReturnValue(false)
    expect((await POST(post({ action: 'collect', listingId, associationId, idempotencyKey }))).status).toBe(503)
    expect(mocks.command).not.toHaveBeenCalled()
  })
  it.each([429, 503])('fails closed when the limiter returns %s', async status => {
    mocks.limiter.mockResolvedValue(new Response('Unavailable', { status }))
    const response = await POST(post())
    expect(response.status).toBe(status)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(mocks.command).not.toHaveBeenCalled()
  })
  it('redacts unexpected exceptions', async () => {
    mocks.command.mockRejectedValue(new Error('PRIVATE_DATABASE_ERROR'))
    const response = await POST(post())
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'Website baselines are temporarily unavailable.' })
  })
})

import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { auth, limiter, response, rpc } = vi.hoisted(() => {
  const response = vi.fn()
  return { auth: vi.fn(), limiter: vi.fn(), response, rpc: vi.fn(() => ({ abortSignal: response })) }
})
vi.mock('@/lib/server/request-auth', () => ({ resolveRequestAuth: auth }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: limiter }))
import { GET } from './route'

const ownerId = '9a000000-0000-4000-8000-000000000001'
const listingId = '9b000000-0000-4000-8000-000000000001'
const query = `listingId=${listingId}&month=2026-08`
const request = (search = query) => new Request(`https://app.nexez.ai/api/merchant/report-inputs?${search}`)
const row = { ownerId, listingId, month: '2026-08', observedAt: '2026-09-11T00:00:00Z', websiteSnapshot: null,
  listing: { state: 'available', name: 'Merchant', description: null, isPublished: false, standardVersion: '2026.1',
    readinessSignals: [true, true, false, false, false, false, false, false, false, false, false] },
  traffic: { state: 'no_coverage' }, orders: { state: 'no_coverage' } }
beforeEach(() => {
  vi.clearAllMocks()
  auth.mockResolvedValue({ user: { id: ownerId }, supabase: { rpc } })
  limiter.mockResolvedValue(null)
  response.mockResolvedValue({ data: row, error: null })
})

describe('merchant report input API', () => {
  it('returns an owner report with private cache headers and a bounded per-user limiter', async () => {
    const res = await GET(request())
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(res.headers.get('vary')).toBe('Cookie, Authorization')
    expect(await res.json()).toMatchObject({ dataBasis: 'merchant_sources', scope: { ownerId, listingId },
      website: { state: 'not_collected' }, traffic: { state: 'no_coverage' }, orders: { state: 'no_coverage' } })
    expect(limiter).toHaveBeenCalledWith(expect.any(Request), 'merchant-report-inputs', 6, 60000, { subject: ownerId, failClosed: true })
  })
  it.each([null, { id: ownerId, is_anonymous: true }])('denies missing or anonymous identity before reading sources', async user => {
    auth.mockResolvedValue({ user, supabase: { rpc } })
    const res = await GET(request())
    expect(res.status).toBe(401)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(rpc).not.toHaveBeenCalled()
    expect(limiter).not.toHaveBeenCalled()
  })
  it.each(['', `${query}&ownerId=${ownerId}`, `${query}&orgId=anything`, `${query}&month=2026-07`, `${query}&coverage=complete`,
    `listingId=bad&month=2026-08`, `listingId=${listingId}&month=2026-13`])('rejects malformed, duplicate and authority-bearing parameters', async search => {
    expect((await GET(request(search))).status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })
  it.each([429, 503])('keeps a limiter failure private and does not query sources (%s)', async status => {
    limiter.mockResolvedValue(new Response('Unavailable', { status }))
    const res = await GET(request())
    expect(res.status).toBe(status)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(rpc).not.toHaveBeenCalled()
  })
  it('returns the same safe 404 for SQL ownership denials', async () => {
    response.mockResolvedValue({ data: null, error: null })
    const res = await GET(request())
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Listing not found.' })
  })
  it('redacts SQL and authentication exceptions', async () => {
    response.mockRejectedValue(new Error('database secret'))
    let res = await GET(request())
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'Report inputs are temporarily unavailable.' })
    auth.mockRejectedValue(new Error('auth secret'))
    res = await GET(request())
    expect(res.status).toBe(503)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(await res.json()).toEqual({ error: 'Report inputs are temporarily unavailable.' })
  })

  if (process.env.NEXEZ_REPORT_SQL_FIXTURE) {
    it('transports an actual local PostgreSQL projection through the DAL and API', async () => {
      const actual = JSON.parse(readFileSync(process.env.NEXEZ_REPORT_SQL_FIXTURE!, 'utf8'))
      auth.mockResolvedValue({ user: { id: actual.ownerId }, supabase: { rpc } })
      response.mockResolvedValue({ data: actual, error: null })
      const res = await GET(request(`listingId=${actual.listingId}&month=${actual.month}`))
      expect(res.status).toBe(200)
      const report = await res.json()
      expect(report.scope).toMatchObject({ ownerId: actual.ownerId, listingId: actual.listingId })
      expect(report.traffic).toMatchObject({ state: 'available', value: { totalVisits: 0 }, coverage: { state: 'complete' } })
      expect(report.orders).toEqual({ state: 'no_coverage' })
      expect(report.website).toEqual({ state: 'not_collected' })
      expect(JSON.stringify(report)).not.toMatch(/evidenceId|evidenceSha256|readinessSignals|amount_cents|buyer_email/)
    })
  }
  if (process.env.NEXEZ_WEBSITE_SQL_FIXTURE) {
    it('transports an actual immutable PostgreSQL snapshot into the owner report', async () => {
      const actual = JSON.parse(readFileSync(process.env.NEXEZ_WEBSITE_SQL_FIXTURE!, 'utf8'))
      auth.mockResolvedValue({ user: { id: actual.ownerId }, supabase: { rpc } })
      response.mockResolvedValue({ data: actual, error: null })
      const res = await GET(request(`listingId=${actual.listingId}&month=${actual.month}`))
      expect(res.status).toBe(200)
      const report = await res.json()
      expect(report.website).toMatchObject({ state: 'available', sourceVersion: actual.websiteSnapshot.sourceVersion,
        value: { snapshotId: actual.websiteSnapshot.id, associationId: actual.websiteSnapshot.associationId,
          associationMethod: 'merchant_approved', provenance: 'merchant_website_snapshot', result: { score: 100, version: 2 } } })
      expect(report.traffic).toEqual({ state: 'no_coverage' })
      expect(JSON.stringify(report)).not.toMatch(/leaseToken|PRIVATE|pageText|website_url_at_approval/)
    })
  }
})

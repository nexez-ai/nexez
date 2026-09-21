import { beforeEach, describe, expect, it, vi } from 'vitest'
const { authorize, limited, status, batch } = vi.hoisted(() => ({
  authorize: vi.fn(), limited: vi.fn(), status: vi.fn(), batch: vi.fn(),
}))
vi.mock('@/lib/server/agent-readiness-study', () => ({ authorizeStudyRequest: authorize }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: limited }))
vi.mock('@/lib/server/large-readiness-study', () => ({ readResearchStatus: status, runResearchBatch: batch }))
import { POST } from './route'
function request(body: unknown) {
  return new Request('https://app.nexez.ai/api/internal/readiness-research', {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  })
}
beforeEach(() => {
  vi.resetAllMocks(); authorize.mockResolvedValue(true); limited.mockResolvedValue(null)
  status.mockResolvedValue({ results: 2, state: 'pilot' })
  batch.mockResolvedValue({ ok: true, claimed: 6, persisted: 6, failures: 0 })
})
describe('readiness research route', () => {
  it('uses independent research authorization and rejects unauthenticated work', async () => {
    authorize.mockResolvedValue(false)
    const req = request({ action: 'status', cohort: 'test-cohort' })
    expect((await POST(req)).status).toBe(401)
    expect(authorize).toHaveBeenCalledWith(req, 'research')
    expect(batch).not.toHaveBeenCalled(); expect(status).not.toHaveBeenCalled()
  })
  it('returns only the aggregate status with no-store', async () => {
    const res = await POST(request({ action: 'status', cohort: 'test-cohort' }))
    expect(res.status).toBe(200); expect(res.headers.get('cache-control')).toContain('no-store')
    expect(await res.json()).toEqual({ results: 2, state: 'pilot' })
  })
  it.each([
    { action: 'start', cohort: 'test-cohort' },
    { action: 'tick', cohort: 'test-cohort' },
    { action: 'status', cohort: '../private' },
    { action: 'status', cohort: 'test-cohort', target: 'https://arbitrary.com' },
    { action: 'status', cohort: 'x'.repeat(2000) },
  ])('rejects malformed or caller-selected work %j', async (body) => {
    expect((await POST(request(body))).status).toBe(400)
    expect(batch).not.toHaveBeenCalled()
  })
  it('accepts only a scheduler-created dispatch ID', async () => {
    const id = 'f1000000-0000-4000-8000-000000000001'
    const res = await POST(request({ action: 'tick', cohort: 'test-cohort', dispatchId: id }))
    expect(res.status).toBe(200); expect(batch).toHaveBeenCalledWith('test-cohort', id)
  })
  it('redacts internal errors and represents unavailable cohorts', async () => {
    status.mockResolvedValue(null)
    expect((await POST(request({ action: 'status', cohort: 'unknown-cohort' }))).status).toBe(404)
    status.mockRejectedValue(new Error('secret.example token'))
    const res = await POST(request({ action: 'status', cohort: 'test-cohort' }))
    expect(res.status).toBe(503); expect(await res.text()).not.toMatch(/secret|token/)
  })
  it('respects the request rate limiter', async () => {
    limited.mockResolvedValue(new Response('{}', { status: 429 }))
    expect((await POST(request({ action: 'status', cohort: 'test-cohort' }))).status).toBe(429)
    expect(status).not.toHaveBeenCalled()
  })
})

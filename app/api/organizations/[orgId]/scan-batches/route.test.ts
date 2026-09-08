import { beforeEach, describe, expect, it, vi } from 'vitest'

const { auth, rpc, resolve, limiter, runner, send, response, capture } = vi.hoisted(() => {
  const response = vi.fn()
  return { auth: vi.fn(), rpc: vi.fn((name, args) => ({ abortSignal: (signal: AbortSignal) => response(name, args, signal) })),
    resolve: vi.fn(), limiter: vi.fn(), runner: vi.fn(), send: vi.fn(), response, capture: vi.fn() }
})
vi.mock('@/lib/observability', () => ({ captureEvent: capture }))
vi.mock('@/lib/server/request-auth', () => ({ resolveRequestAuth: auth }))
vi.mock('@/lib/importer', () => ({ getResolvedImportUrlError: resolve }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: limiter }))
vi.mock('@/lib/server/organization-scan-worker', () => ({ hasOrganizationScanRunner: runner }))
vi.mock('@/lib/inngest/client', () => ({ inngest: { send } }))
import { GET, POST } from './route'
import { GET as detail, PATCH, DELETE } from './[batchId]/route'

const orgId = 'c2000000-0000-4000-8000-000000000001'
const batchId = 'c3000000-0000-4000-8000-000000000001'
const userId = 'c1000000-0000-4000-8000-000000000001'
const key = 'c4000000-0000-4000-8000-000000000001'
const params = () => ({ params: Promise.resolve({ orgId, batchId }) })
const workspace = { batches: [], used_today: 0, can_submit: true }
const receipt = { batch_id: batchId, replayed: false, reserved: 1 }
function request(body: unknown = { input: 'acme.com', attested: true, idempotencyKey: key }, method = 'POST', origin = 'https://app.nexez.ai') {
  return new Request(`https://app.nexez.ai/api/organizations/${orgId}/scan-batches`, { method, headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) })
}
beforeEach(() => {
  vi.clearAllMocks()
  auth.mockResolvedValue({ user: { id: userId }, supabase: { rpc } })
  runner.mockReturnValue(true); limiter.mockResolvedValue(null); resolve.mockResolvedValue(null); send.mockResolvedValue({ ids: [] })
  response.mockImplementation(async (name: string) => ({ error: null, data: name === 'read_organization_scan_batches' ? workspace : name === 'find_organization_scan_receipt' ? null : name === 'submit_organization_scan_batch' ? receipt : true }))
})

describe('organization scan API', () => {
  it.each([GET, POST, detail, PATCH, DELETE])('requires a verified actor and keeps errors private', async (handler) => {
    auth.mockResolvedValue({ user: null, supabase: { rpc } })
    const res = await handler(request(), params())
    expect(res.status).toBe(401)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(res.headers.get('vary')).toBe('Cookie, Authorization')
    expect(rpc).not.toHaveBeenCalled()
  })
  it('refuses cross-origin mutations before database or target work', async () => {
    for (const handler of [POST, PATCH, DELETE]) expect((await handler(request({}, 'POST', 'https://evil.com'), params())).status).toBe(403)
    expect(rpc).not.toHaveBeenCalled(); expect(resolve).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled()
  })
  it('uses the browser Host when Next reconstructs a loopback URL and ignores forwarded-host spoofing', async () => {
    const local = new Request('http://localhost:3117/api/organizations/scan-batches', { method: 'POST', headers: {
      'Content-Type': 'application/json', Host: '127.0.0.1:3117', Origin: 'http://127.0.0.1:3117', 'X-Forwarded-Host': 'evil.com',
    }, body: JSON.stringify({ input: 'acme.com', attested: true, idempotencyKey: key }) })
    expect((await POST(local, params())).status).toBe(202)
    const forged = request()
    forged.headers.set('Host', 'app.nexez.ai'); forged.headers.set('Origin', 'https://evil.com'); forged.headers.set('X-Forwarded-Host', 'evil.com')
    expect((await POST(forged, params())).status).toBe(403)
  })
  it('requires current org membership before DNS or dispatch', async () => {
    response.mockResolvedValue({ data: null, error: null })
    expect((await POST(request(), params())).status).toBe(404)
    expect(resolve).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled()
  })
  it('reserves normalized unique targets and sends only org and batch IDs', async () => {
    const res = await POST(request({ input: 'https://ACME.com/\nacme.com', attested: true, idempotencyKey: key }), params())
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual(receipt)
    expect(rpc).toHaveBeenCalledWith('submit_organization_scan_batch', { p_org_id: orgId, p_idempotency_key: key, p_targets: ['https://acme.com'], p_attested: true })
    expect(limiter).toHaveBeenCalledWith(expect.any(Request), 'organization-scan-submit', 6, 60000, { subject: userId, failClosed: true })
    expect(send).toHaveBeenCalledWith({ name: 'nexez/organization-scan.batch', data: { orgId, batchId } })
    expect(JSON.stringify(send.mock.calls)).not.toContain('acme.com')
  })
  it('recovers accepted submissions independently of runner, DNS, quota and pause state', async () => {
    runner.mockReturnValue(false)
    response.mockImplementation(async (name: string) => ({ error: null, data: name === 'read_organization_scan_batches' ? { ...workspace, used_today: 250, can_submit: false } : { ...receipt, replayed: true } }))
    const res = await POST(request(), params())
    expect(res.status).toBe(200)
    expect((await res.json()).replayed).toBe(true)
    expect(resolve).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled()
    expect(rpc.mock.calls.map(([name]) => name)).not.toContain('submit_organization_scan_batch')
  })
  it('returns the durable receipt when event sending fails', async () => {
    send.mockRejectedValue(new Error('event service unavailable'))
    const res = await POST(request(), params())
    expect(res.status).toBe(202); expect(await res.json()).toEqual(receipt)
    expect(rpc.mock.calls.filter(([name]) => name === 'submit_organization_scan_batch')).toHaveLength(1)
  })
  it.each([['PT409', 'idempotency_conflict', 409], ['PT410', 'batch_deleted', 410], ['PT429', 'daily_limit', 429]])('preserves closed database failure %s', async (code, message, status) => {
    response.mockResolvedValue({ data: null, error: { code, message } })
    const res = await POST(request(), params())
    expect(res.status).toBe(status); expect(send).not.toHaveBeenCalled()
  })
  it('fails closed on limiter, runner or private DNS failure', async () => {
    limiter.mockResolvedValueOnce(new Response('Unavailable', { status: 503 }))
    expect((await POST(request(), params())).status).toBe(503)
    expect(rpc).not.toHaveBeenCalled()
    runner.mockReturnValue(false)
    expect((await POST(request(), params())).status).toBe(503)
    expect(resolve).not.toHaveBeenCalled()
    runner.mockReturnValue(true); resolve.mockResolvedValue('Resolves to private address')
    expect((await POST(request(), params())).status).toBe(400)
    expect(rpc.mock.calls.map(([name]) => name)).not.toContain('submit_organization_scan_batch')
    expect(send).not.toHaveBeenCalled()
  })
  it('records a daily quota rejection with no target list or request key', async () => {
    response.mockImplementation(async (name: string) => name === 'submit_organization_scan_batch'
      ? { data: null, error: { code: 'PT429', message: 'daily_limit' } }
      : { data: name === 'read_organization_scan_batches' ? workspace : null, error: null })
    expect((await POST(request(), params())).status).toBe(429)
    expect(capture).toHaveBeenCalledWith('organization-scan.quota_denied', { orgId, kind: 'daily_allowance' })
    expect(JSON.stringify(capture.mock.calls)).not.toContain('acme.com')
    expect(JSON.stringify(capture.mock.calls)).not.toContain(key)
  })
  it('rejects unbounded bodies and caller-supplied identity fields', async () => {
    expect((await POST(request({ input: 'x'.repeat(38000), attested: true, idempotencyKey: key }), params())).status).toBe(413)
    expect((await POST(request({ input: 'acme.com', attested: true, idempotencyKey: key, userId: 'forged' }), params())).status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })
  it('rejects mismatched org data and generic database details', async () => {
    response.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'secret schema details' } })
    const res = await GET(request(), params())
    expect(res.status).toBe(503); expect(await res.text()).not.toContain('secret')
  })
  it('binds follow-up and deletion to the URL organization and batch', async () => {
    expect((await PATCH(request({ action: 'follow_up', targetId: key, selected: true }, 'PATCH'), params())).status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('change_organization_scan_batch', { p_org_id: orgId, p_batch_id: batchId, p_action: 'follow_up', p_target_id: key, p_follow_up: true })
    expect((await DELETE(request({}, 'DELETE'), params())).status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('change_organization_scan_batch', { p_org_id: orgId, p_batch_id: batchId, p_action: 'delete' })
    expect((await PATCH(request({ action: 'complete', result: '<script>' }, 'PATCH'), params())).status).toBe(400)
  })
})

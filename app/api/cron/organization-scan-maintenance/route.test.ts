import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const refs = vi.hoisted(() => ({ maintain: vi.fn(), configured: vi.fn(), event: vi.fn(), signal: vi.fn() }))
vi.mock('@/lib/server/organization-scan-operations', () => ({ runOrganizationScanMaintenance: refs.maintain }))
vi.mock('@/utils/supabase/admin', () => ({ hasSupabaseAdminEnv: refs.configured }))
vi.mock('@/lib/observability', () => ({ captureEvent: refs.event, captureSignal: refs.signal }))
import { GET } from './route'

const request = (authorization?: string) => new Request('https://app.nexez.ai/api/cron/organization-scan-maintenance', {
  headers: authorization === undefined ? {} : { authorization },
})
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('CRON_SECRET', 'cron-secret')
  refs.configured.mockReturnValue(true)
  refs.maintain.mockResolvedValue(0)
})
afterEach(() => vi.unstubAllEnvs())

describe('independent scanner maintenance cron', () => {
  it.each([undefined, 'Bearer wrong', 'cron-secret', 'bearer cron-secret', 'Bearer  cron-secret'])('rejects unauthorized requests before database work: %j', async (authorization) => {
    const response = await GET(request(authorization))
    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(refs.maintain).not.toHaveBeenCalled()
  })
  it.each(['development', 'production', 'test'])('requires a configured secret in %s', async (environment) => {
    vi.stubEnv('NODE_ENV', environment)
    vi.stubEnv('CRON_SECRET', '')
    expect((await GET(request('Bearer '))).status).toBe(401)
    expect(refs.maintain).not.toHaveBeenCalled()
  })
  it('reports missing database configuration without running cleanup', async () => {
    refs.configured.mockReturnValue(false)
    const response = await GET(request('Bearer cron-secret'))
    expect(response.status).toBe(503)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(refs.maintain).not.toHaveBeenCalled()
  })
  it('cleans up independently of Inngest keys and records only the aggregate count', async () => {
    vi.stubEnv('INNGEST_EVENT_KEY', '')
    vi.stubEnv('INNGEST_SIGNING_KEY', '')
    refs.maintain.mockResolvedValue(4)
    const response = await GET(request('Bearer cron-secret'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, removedBatches: 4 })
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(refs.event).toHaveBeenCalledWith('scanner.maintenance', { removedBatches: 4 })
  })
  it('fails visibly without sending SQL errors or prospect data to logs or clients', async () => {
    refs.maintain.mockRejectedValue(new Error('secret.example?token=credential'))
    const response = await GET(request('Bearer cron-secret'))
    expect(response.status).toBe(503)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.json()).toEqual({ ok: false, error: 'maintenance_failed' })
    expect(refs.signal).toHaveBeenCalledWith('scanner.maintenance_failed', { reason: 'database_unavailable' })
    expect(refs.event).not.toHaveBeenCalled()
  })
})

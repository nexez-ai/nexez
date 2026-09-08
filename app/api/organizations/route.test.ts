import { beforeEach, describe, expect, it, vi } from 'vitest'

const { auth, rpc, abortSignal } = vi.hoisted(() => {
  const abortSignal = vi.fn()
  return { auth: vi.fn(), abortSignal, rpc: vi.fn(() => ({ abortSignal })) }
})
vi.mock('@/lib/server/request-auth', () => ({ resolveRequestAuth: auth }))

import { GET as list } from './route'
import { GET as context } from './[orgId]/context/route'

const orgId = '92000000-0000-4000-8000-000000000001'
const request = () => new Request('https://app.nexez.ai/api/organizations')
const params = (id = orgId) => ({ params: Promise.resolve({ orgId: id }) })
const row = {
  org_id: orgId, org_slug: 'agency-one', org_name: 'Agency One',
  membership_id: '94000000-0000-4000-8000-000000000001', member_role: 'operator',
  scan_access: 'unconfigured', scan_starts_at: null, scan_expires_at: null,
  max_targets_per_batch: null, max_targets_per_day: null, max_concurrent_targets: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  auth.mockResolvedValue({ user: { id: 'actor' }, supabase: { rpc } })
  abortSignal.mockResolvedValue({ data: [row], error: null })
})

describe('organization API authorization and privacy', () => {
  it.each(['list', 'context'])('requires verified auth for %s', async (handler) => {
    auth.mockResolvedValue({ user: null, supabase: { rpc } })
    const response = handler === 'list' ? await list(request()) : await context(request(), params())
    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('lists only the database-authorized DTO and forbids response caching', async () => {
    const response = await list(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ organizations: [{ id: orgId, slug: 'agency-one', name: 'Agency One', membershipId: row.membership_id, role: 'operator' }], nextCursor: null })
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('vary')).toBe('Cookie, Authorization')
  })

  it('returns only current context and scan limits for an explicit org', async () => {
    const response = await context(request(), params())
    expect(response.status).toBe(200)
    expect((await response.json()).organization.scanAccess.state).toBe('unconfigured')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  it('hides existence on an authorization denial', async () => {
    abortSignal.mockResolvedValue({ data: [], error: null })
    const response = await context(request(), params())
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Workspace not found.' })
  })

  it('treats a malformed org ID as unavailable without querying', async () => {
    const response = await context(request(), params('../merchant'))
    expect(response.status).toBe(404)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects invalid pagination', async () => {
    const response = await list(new Request('https://app.nexez.ai/api/organizations?cursor=../../merchant'))
    expect(response.status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each(['list', 'context'])('returns a private 503 on database failure for %s', async (handler) => {
    abortSignal.mockResolvedValue({ data: null, error: { message: 'private relation does not exist' } })
    const response = handler === 'list' ? await list(request()) : await context(request(), params())
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('private relation')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  it('handles auth service failure without leaking raw errors', async () => {
    auth.mockRejectedValue(new Error('token and private auth details'))
    const response = await context(request(), params())
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('token')
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getOrganizationWorkspace, listOrganizationWorkspaces, OrganizationWorkspaceUnavailable } from './organization-context'

const orgId = '92000000-0000-4000-8000-000000000001'
const row = {
  org_id: orgId,
  org_slug: 'agency-one',
  org_name: 'Agency One',
  membership_id: '94000000-0000-4000-8000-000000000001',
  member_role: 'owner',
  scan_access: 'paused',
  scan_starts_at: '2026-09-07T00:00:00+00:00',
  scan_expires_at: '2026-09-21T00:00:00+00:00',
  max_targets_per_batch: 50,
  max_targets_per_day: 250,
  max_concurrent_targets: 3,
}
const abortSignal = vi.fn()
const rpc = vi.fn(() => ({ abortSignal }))
const supabase = { rpc } as unknown as SupabaseClient

beforeEach(() => {
  vi.clearAllMocks()
  abortSignal.mockResolvedValue({ data: [row], error: null })
})

describe('organization context boundary', () => {
  it('uses the session RPC and returns only the bounded projection', async () => {
    abortSignal.mockResolvedValue({ data: [{ ...row, merchant_owner_id: 'private', internal_notes: 'private' }], error: null })
    const context = await getOrganizationWorkspace(supabase, { id: orgId })
    expect(rpc).toHaveBeenCalledWith('get_organization_context', { p_org_id: orgId, p_org_slug: null })
    expect(abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal))
    expect(context).toEqual({
      id: orgId, slug: 'agency-one', name: 'Agency One', membershipId: row.membership_id, role: 'owner',
      scanAccess: { state: 'paused', startsAt: row.scan_starts_at, expiresAt: row.scan_expires_at, maxTargetsPerBatch: 50, maxTargetsPerDay: 250, maxConcurrentTargets: 3 },
    })
  })

  it('looks up the explicit slug without a caller-supplied actor', async () => {
    await getOrganizationWorkspace(supabase, { slug: 'agency-one' })
    expect(rpc).toHaveBeenCalledWith('get_organization_context', { p_org_id: null, p_org_slug: 'agency-one' })
  })

  it.each(['../../merchant', 'agency/one', 'AGENCY', '', 'a', 'a'.repeat(64), 'agency-one?owner=other', 'agency\n'])('rejects unsafe slug %j before querying', async (slug) => {
    expect(await getOrganizationWorkspace(supabase, { slug })).toBeNull()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects malformed organization IDs before querying', async () => {
    expect(await getOrganizationWorkspace(supabase, { id: 'owner-id' })).toBeNull()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('returns the same absent result for all database authorization denials', async () => {
    abortSignal.mockResolvedValue({ data: [], error: null })
    expect(await getOrganizationWorkspace(supabase, { id: orgId })).toBeNull()
  })

  it.each([
    null, {}, [row, row], [{ ...row, member_role: 'admin' }],
    [{ ...row, scan_access: 'allow-all' }], [{ ...row, max_targets_per_batch: 5000 }],
    [{ ...row, scan_expires_at: 'infinity' }], [{ ...row, org_id: '92000000-0000-4000-8000-000000000002' }],
  ])('fails closed on a malformed or mismatched database response', async (data) => {
    abortSignal.mockResolvedValue({ data, error: null })
    await expect(getOrganizationWorkspace(supabase, { id: orgId })).rejects.toBeInstanceOf(OrganizationWorkspaceUnavailable)
  })

  it('does not turn database failure into missing membership or leak database details', async () => {
    abortSignal.mockResolvedValue({ data: null, error: { message: 'private schema details' } })
    await expect(getOrganizationWorkspace(supabase, { id: orgId })).rejects.toThrow('Workspaces are temporarily unavailable. Please try again.')
  })

  it('does not cache a successful membership across later requests', async () => {
    expect(await getOrganizationWorkspace(supabase, { id: orgId })).not.toBeNull()
    abortSignal.mockResolvedValueOnce({ data: [], error: null })
    expect(await getOrganizationWorkspace(supabase, { id: orgId })).toBeNull()
    expect(rpc).toHaveBeenCalledTimes(2)
  })

  it('maps network and timeout failures to the same safe unavailable error', async () => {
    abortSignal.mockRejectedValue(new Error('network exception with credentials'))
    await expect(getOrganizationWorkspace(supabase, { id: orgId })).rejects.toThrow('Workspaces are temporarily unavailable. Please try again.')
  })
})

describe('organization directory', () => {
  it('returns empty memberships without inventing an organization', async () => {
    abortSignal.mockResolvedValue({ data: [], error: null })
    expect(await listOrganizationWorkspaces(supabase)).toEqual({ organizations: [], nextCursor: null })
  })

  it('uses a bounded page plus sentinel and an exclusive continuation cursor', async () => {
    abortSignal.mockResolvedValue({ data: Array.from({ length: 51 }, (_, i) => ({ ...row, org_slug: `org-${String(i).padStart(3, '0')}` })), error: null })
    const directory = await listOrganizationWorkspaces(supabase, 'org-before')
    expect(directory.organizations).toHaveLength(50)
    expect(directory.nextCursor).toBe('org-049')
    expect(rpc).toHaveBeenCalledWith('list_my_organizations', { p_after_slug: 'org-before' })
  })

  it('rejects an unbounded database response', async () => {
    abortSignal.mockResolvedValue({ data: Array(52).fill(row), error: null })
    await expect(listOrganizationWorkspaces(supabase)).rejects.toBeInstanceOf(OrganizationWorkspaceUnavailable)
  })

  it('rejects invalid cursors before the database query', async () => {
    await expect(listOrganizationWorkspaces(supabase, '../private')).rejects.toBeInstanceOf(OrganizationWorkspaceUnavailable)
    expect(rpc).not.toHaveBeenCalled()
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const { status, from, query } = vi.hoisted(() => {
  const query = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn(), abortSignal: vi.fn() }
  for (const key of ['select', 'eq', 'order', 'limit'] as const) query[key].mockReturnValue(query)
  return { status: vi.fn(), from: vi.fn(() => query), query }
})
vi.mock('@/utils/supabase/admin', () => ({ createAdminClient: () => ({ from }) }))
vi.mock('./large-readiness-study', async original => ({
  ...await original<typeof import('./large-readiness-study')>(), readResearchStatus: status,
}))
import { readResearchIdentityAudit } from './research-identity-audit'
import { hashScanDomain } from './log-scan-result'

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('SCAN_DOMAIN_HASH_SALT', 'private-audit-salt')
  status.mockResolvedValue({ state: 'paused', researchProtocolVersion: 5, runtimeHashIdentityFingerprint: 'a'.repeat(64) })
  query.abortSignal.mockResolvedValue({ error: null, data: [
    { final_domain_hash: hashScanDomain('example.com'), created_at: '2026-09-22T08:00:00+00:00', target: { domain_key: 'www.example.com' } },
    { final_domain_hash: hashScanDomain('redirect.example'), created_at: '2026-09-23T19:00:00+00:00', target: { domain_key: 'initial.example' } },
  ] })
})
afterEach(() => vi.unstubAllEnvs())
describe('private research identity review', () => {
  it('compares bounded earliest/latest samples and returns only aggregate evidence', async () => {
    const result = await readResearchIdentityAudit('test-cohort')
    expect(result?.protocol).toBe(5)
    expect(result?.windows).toHaveLength(2)
    expect(result?.windows[0]).toMatchObject({ edge: 'earliest', sampled: 2, matchedInitialDomains: 1, inconclusive: 1 })
    expect(result?.windows[1].edge).toBe('latest')
    expect(query.limit).toHaveBeenNthCalledWith(1, 32)
    expect(query.limit).toHaveBeenNthCalledWith(2, 32)
    expect(query.eq).toHaveBeenCalledWith('cohort', 'test-cohort')
    expect(query.select).toHaveBeenCalledWith('final_domain_hash,created_at,target:study_run_targets!study_run_results_cohort_target_id_fkey!inner(domain_key)')
    expect(JSON.stringify(result)).not.toMatch(/example|private-audit-salt|domain_key|final_domain_hash/)
  })
  it('keeps stopped predecessor identity evidence available without running its scanner', async () => {
    status.mockResolvedValue({ state: 'paused', researchProtocolVersion: 4 })
    expect((await readResearchIdentityAudit('old-cohort'))?.protocol).toBe(4)
  })
  it('supports the stopped protocol-6 recovery without exposing its salt', async () => {
    status.mockResolvedValue({ state: 'paused', researchProtocolVersion: 6 })
    expect((await readResearchIdentityAudit('recovery-cohort'))?.protocol).toBe(6)
  })
  it.each(['running', 'pilot', 'preparing'])('rejects the active or unready %s state before reading identities', async state => {
    status.mockResolvedValue({ state, researchProtocolVersion: 5 })
    await expect(readResearchIdentityAudit('test-cohort')).rejects.toThrow('stopped protocol-4')
    expect(from).not.toHaveBeenCalled()
  })
  it.each(['pilot_review', 'paused', 'exhausted', 'completed'])('permits the stopped %s state', async state => {
    status.mockResolvedValue({ state, researchProtocolVersion: 5 })
    expect((await readResearchIdentityAudit('test-cohort'))?.windows).toHaveLength(2)
  })
  it('rejects superseded protocols and represents unknown cohorts', async () => {
    status.mockResolvedValue({ state: 'paused', researchProtocolVersion: 3 })
    await expect(readResearchIdentityAudit('old-cohort')).rejects.toThrow('stopped protocol-4')
    status.mockResolvedValue(null)
    expect(await readResearchIdentityAudit('unknown-cohort')).toBeNull()
  })
  it('does not mistake empty evidence for matches', async () => {
    query.abortSignal.mockResolvedValue({ data: [], error: null })
    expect((await readResearchIdentityAudit('test-cohort'))?.windows[0]).toMatchObject({ sampled: 0, matchedInitialDomains: 0, from: null, to: null })
  })
  it('fails closed on unavailable or malformed evidence', async () => {
    query.abortSignal.mockResolvedValue({ data: null, error: { message: 'private detail' } })
    await expect(readResearchIdentityAudit('test-cohort')).rejects.toThrow('Identity review unavailable')
    query.abortSignal.mockResolvedValue({ data: [{ target: { domain_key: 'bad/raw' } }], error: null })
    await expect(readResearchIdentityAudit('test-cohort')).rejects.toThrow()
  })
})

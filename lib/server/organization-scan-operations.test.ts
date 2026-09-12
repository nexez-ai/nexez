import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const { rpc, configured, hasAdmin, abort } = vi.hoisted(() => ({ rpc: vi.fn(), configured: vi.fn(), hasAdmin: vi.fn(), abort: vi.fn() }))
vi.mock('@/utils/supabase/admin', () => ({ createAdminClient: () => ({ rpc }), hasSupabaseAdminEnv: hasAdmin }))
vi.mock('./organization-scan-worker', () => ({ hasOrganizationScanRunner: configured }))
import { getOrganizationScanOperationChecks, recordOrganizationScanRecovery, runOrganizationScanMaintenance } from './organization-scan-operations'

beforeEach(() => {
  vi.clearAllMocks()
  hasAdmin.mockReturnValue(true)
  configured.mockReturnValue(true)
  vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'a'.repeat(40))
  rpc.mockReturnValue({ abortSignal: abort })
  abort.mockResolvedValue({ data: true, error: null })
})
afterEach(() => vi.unstubAllEnvs())

describe('scanner operations RPC boundary', () => {
  it('records only the current revision and returns only a completion marker', async () => {
    expect(await recordOrganizationScanRecovery()).toBe(true)
    expect(rpc).toHaveBeenCalledWith('record_organization_scan_recovery', { p_commit_sha: 'a'.repeat(40) })
    expect(abort).toHaveBeenCalledWith(expect.any(AbortSignal))
  })
  it.each(['', 'production', `${'a'.repeat(40)}\n`, 'A'.repeat(40)])('does not record a malformed revision: %j', async (revision) => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', revision)
    await recordOrganizationScanRecovery()
    expect(rpc).toHaveBeenCalledWith('record_organization_scan_recovery', { p_commit_sha: null })
  })
  it.each([false, null, { ok: true }])('rejects a failed completion marker: %j', async (data) => {
    abort.mockResolvedValue({ data, error: null })
    await expect(recordOrganizationScanRecovery()).rejects.toThrow('not recorded')
  })
  it('returns a bounded cleanup count even without a runner', async () => {
    configured.mockReturnValue(false)
    abort.mockResolvedValue({ data: 100, error: null })
    expect(await runOrganizationScanMaintenance()).toBe(100)
    expect(rpc).toHaveBeenCalledWith('cleanup_organization_scans', {})
    expect(rpc).toHaveBeenCalledWith('cleanup_merchant_website_baselines', {})
  })
  it('surfaces website retention failure even when scanner cleanup passed', async () => {
    abort.mockResolvedValueOnce({ data: 0, error: null }).mockResolvedValueOnce({ data: null, error: null })
    await expect(runOrganizationScanMaintenance()).rejects.toThrow('Invalid website cleanup response')
  })
  it.each([null, -1, 101, 0.5, '0', { removed: 0 }])('rejects a malformed cleanup response: %j', async (data) => {
    abort.mockResolvedValue({ data, error: null })
    await expect(runOrganizationScanMaintenance()).rejects.toThrow('Invalid scan cleanup response')
  })
  it('degrades health without exposing database errors or falling back to raw table access', async () => {
    abort.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'secret.example token=credential' } })
    const checks = await getOrganizationScanOperationChecks()
    expect(checks.every((check) => check.status === 'unknown' && check.required)).toBe(true)
    expect(JSON.stringify(checks)).not.toMatch(/secret|credential/)
    expect(rpc).toHaveBeenCalledOnce()
    await expect(recordOrganizationScanRecovery()).rejects.toThrow('temporarily unavailable')
  })
  it('does not open a database client when the admin environment is unavailable', async () => {
    hasAdmin.mockReturnValue(false)
    expect((await getOrganizationScanOperationChecks()).every((check) => check.status === 'unknown')).toBe(true)
    expect(rpc).not.toHaveBeenCalled()
  })
})

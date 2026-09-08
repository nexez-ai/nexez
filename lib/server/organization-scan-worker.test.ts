import { beforeEach, describe, expect, it, vi } from 'vitest'
const { rpc, gather, close, done, evaluate } = vi.hoisted(() => ({ rpc: vi.fn(), gather: vi.fn(), close: vi.fn(), done: vi.fn(), evaluate: vi.fn() }))
vi.mock('@/utils/supabase/admin', () => ({ createAdminClient: () => ({ rpc }), hasSupabaseAdminEnv: () => true }))
vi.mock('@/lib/inngest/client', () => ({ hasInngestEnv: () => true }))
vi.mock('./site-scan', () => ({ gatherSiteSignals: gather }))
vi.mock('@/lib/crawlability', () => ({ evaluateCrawlability: evaluate }))
vi.mock('./scan-network', () => ({ createScanNetworkContext: () => ({ options: {}, metrics: { bytesRead: 100, probeCount: 2 }, assertFinished: done, close }), ScanNetworkError: class extends Error {} }))
import { processNextOrganizationScan, organizationScanEventSchema, pendingOrganizationScans } from './organization-scan-worker'
import { SCAN_CHECK_COPY } from '@/lib/organization-scans'

const org = 'c2000000-0000-4000-8000-000000000001', batch = 'c3000000-0000-4000-8000-000000000001'
const claim = { target_id: 'c4000000-0000-4000-8000-000000000001', lease_token: 'c5000000-0000-4000-8000-000000000001', origin: 'https://acme.com', attempt: 1 }
beforeEach(() => {
  vi.clearAllMocks()
  rpc.mockImplementation((name: string) => ({ abortSignal: async () => ({ error: null, data: name === 'claim_organization_scan_target' ? claim : true }) }))
  gather.mockResolvedValue({ signals: { status: 200 }, pageText: 'secret fetched HTML', url: 'https://redirect.com/private?token=secret' })
  evaluate.mockReturnValue({ version: 2, score: 70, checks: Object.keys(SCAN_CHECK_COPY).map((id) => ({ id, status: 'pass', detail: 'raw body', label: '<script>' })) })
})
describe('organization worker persistence boundary', () => {
  it('does no external work when the current claim is denied', async () => {
    rpc.mockImplementation(() => ({ abortSignal: async () => ({ data: null, error: null }) }))
    expect(await processNextOrganizationScan(org, batch)).toBe(false)
    expect(gather).not.toHaveBeenCalled()
  })
  it('keeps authorization, gathering and completion in one call, returning only a boolean', async () => {
    expect(await processNextOrganizationScan(org, batch)).toBe(true)
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['claim_organization_scan_target', 'complete_organization_scan_target'])
    const args = rpc.mock.calls[1][1]
    expect(args).toMatchObject({ p_org_id: org, p_target_id: claim.target_id, p_lease_token: claim.lease_token, p_failure: null, p_result: { version: 2, score: 70 } })
    expect(JSON.stringify(args)).not.toMatch(/secret|raw body|script|redirect.com|acme.com/)
    expect(close).toHaveBeenCalledOnce()
  })
  it('does not retry a write with stale authority after the database discards a result', async () => {
    rpc.mockImplementation((name: string) => ({ abortSignal: async () => ({ error: null, data: name === 'claim_organization_scan_target' ? claim : false }) }))
    expect(await processNextOrganizationScan(org, batch)).toBe(true)
    expect(rpc.mock.calls.filter(([name]) => name === 'complete_organization_scan_target')).toHaveLength(1)
    expect(close).toHaveBeenCalledOnce()
  })
  it('sanitizes transport errors and rejects result extras', async () => {
    gather.mockRejectedValue(new Error('credential secret at acme.com'))
    expect(await processNextOrganizationScan(org, batch)).toBe(true)
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_result: null, p_failure: 'network_error' })
    expect(JSON.stringify(rpc.mock.calls)).not.toContain('secret')
  })
  it('runs retention and outbox recovery without accepting arbitrary event fields', async () => {
    expect(organizationScanEventSchema.safeParse({ orgId: org, batchId: batch, origin: claim.origin }).success).toBe(false)
    rpc.mockImplementation((name: string) => ({ abortSignal: async () => ({ error: null, data: name === 'cleanup_organization_scans' ? 1 : [{ org_id: org, batch_id: batch }] }) }))
    expect(await pendingOrganizationScans()).toEqual([{ orgId: org, batchId: batch }])
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['cleanup_organization_scans', 'dispatch_organization_scan_batches'])
  })
})

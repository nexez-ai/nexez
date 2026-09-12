import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SCAN_CHECK_COPY } from '@/lib/organization-scans'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), gather: vi.fn(), network: vi.fn(), evaluate: vi.fn() }))
vi.mock('@/utils/supabase/admin', () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }))
vi.mock('./site-scan', () => ({ gatherSiteSignals: mocks.gather }))
vi.mock('@/lib/crawlability', () => ({ evaluateCrawlability: mocks.evaluate }))
vi.mock('./scan-network', async importOriginal => ({ ...await importOriginal<typeof import('./scan-network')>(), createScanNetworkContext: mocks.network }))
import { ScanNetworkError } from './scan-network'
import { collectWebsiteBaseline, commandWebsiteBaseline, readWebsiteBaseline, websiteRpc } from './merchant-website-baselines'

const ownerId = 'ad000000-0000-4000-8000-000000000001'
const listingId = 'bd000000-0000-4000-8000-000000000001'
const associationId = 'cd000000-0000-4000-8000-000000000001'
const collectionId = 'dd000000-0000-4000-8000-000000000001'
const token = 'ed000000-0000-4000-8000-000000000001'
const claim = { id: collectionId, ownerId, listingId, associationId, origin: 'https://example.com', leaseToken: token }
const result = { version: 2, score: 75, checks: Object.keys(SCAN_CHECK_COPY).map(id => ({ id, status: 'pass' })) }
const client = { rpc: mocks.rpc } as unknown as SupabaseClient
const close = vi.fn()
const assertFinished = vi.fn()
const options = { beforeRequest: vi.fn() }
const collect = () => collectWebsiteBaseline(collectionId, ownerId, listingId, associationId)
beforeEach(() => {
  vi.clearAllMocks()
  mocks.network.mockReturnValue({ options, assertFinished, close })
  mocks.rpc.mockImplementation(name => ({ abortSignal: vi.fn(async () => ({ data: name === 'claim_merchant_website_collection' ? claim : true, error: null })) }))
  mocks.gather.mockResolvedValue({ origin: claim.origin, signals: { status: 200 }, pageText: 'PRIVATE_FETCHED_TEXT' })
  mocks.evaluate.mockReturnValue({ ...result, checks: result.checks.map(check => ({ ...check, label: 'PRIVATE_LABEL', detail: '<script>untrusted</script>' })) })
})

describe('merchant website collection boundary', () => {
  it('collects only a fresh scoped claim and persists closed result fields through a service-only command', async () => {
    await collect()
    expect(mocks.network).toHaveBeenCalledWith(token, null, client, claim.origin)
    expect(mocks.gather).toHaveBeenCalledExactlyOnceWith(claim.origin, options)
    expect(mocks.rpc).toHaveBeenLastCalledWith('complete_merchant_website_collection', {
      p_collection: collectionId, p_token: token, p_result: result, p_failure: null, p_scanner_version: 'site-scan-2.1',
    })
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toMatch(/PRIVATE|script|pageText|label|orgId/)
    expect(close).toHaveBeenCalledOnce()
  })
  it('does not refetch an already claimed or expired receipt', async () => {
    mocks.rpc.mockReturnValue({ abortSignal: async () => ({ data: null, error: null }) })
    await collect()
    expect(mocks.gather).not.toHaveBeenCalled()
    expect(mocks.network).not.toHaveBeenCalled()
  })
  it.each(['id', 'ownerId', 'listingId', 'associationId'])('rejects mismatched %s before fetching', async field => {
    mocks.rpc.mockReturnValue({ abortSignal: async () => ({ data: { ...claim, [field]: token }, error: null }) })
    await expect(collect()).rejects.toMatchObject({ status: 503 })
    expect(mocks.gather).not.toHaveBeenCalled()
  })
  it.each(['robots_denied', 'pressure_deferred', 'target_unavailable', 'unsafe_target'] as const)('records %s without a fake score', async code => {
    mocks.gather.mockRejectedValue(new ScanNetworkError(code))
    await collect()
    expect(mocks.rpc).toHaveBeenLastCalledWith('complete_merchant_website_collection', expect.objectContaining({ p_failure: code, p_result: null }))
    expect(close).toHaveBeenCalledOnce()
  })
  it('redacts unknown network failures', async () => {
    mocks.gather.mockRejectedValue(new Error('PRIVATE_IP token=secret'))
    await collect()
    expect(mocks.rpc).toHaveBeenLastCalledWith('complete_merchant_website_collection', expect.objectContaining({ p_failure: 'network_error', p_result: null }))
  })
  it.each([403, 404, 500, 0])('does not score an unsuccessful homepage (%s)', async status => {
    mocks.gather.mockResolvedValue({ origin: claim.origin, signals: { status } })
    await collect()
    expect(mocks.evaluate).not.toHaveBeenCalled()
    expect(mocks.rpc).toHaveBeenLastCalledWith('complete_merchant_website_collection', expect.objectContaining({ p_failure: 'network_error', p_result: null }))
  })
  it('refuses a cross-origin result even if a transport adapter returns it', async () => {
    mocks.gather.mockResolvedValue({ origin: 'https://other.com', signals: { status: 200 } })
    await collect()
    expect(mocks.evaluate).not.toHaveBeenCalled()
    expect(mocks.rpc).toHaveBeenLastCalledWith('complete_merchant_website_collection', expect.objectContaining({ p_failure: 'unsafe_target', p_result: null }))
  })
  it('does not return captured results when SQL discards them after authority loss', async () => {
    mocks.rpc.mockImplementation(name => ({ abortSignal: async () => ({ data: name === 'claim_merchant_website_collection' ? claim : false, error: null }) }))
    expect(await collect()).toBeUndefined()
    expect(close).toHaveBeenCalledOnce()
  })
  it('releases network capacity when completion fails', async () => {
    mocks.rpc.mockImplementation(name => ({ abortSignal: async () => name === 'claim_merchant_website_collection'
      ? { data: claim, error: null } : { data: null, error: { code: 'XX000', message: 'PRIVATE' } } }))
    await expect(collect()).rejects.toMatchObject({ status: 503, message: 'Website baselines are temporarily unavailable.' })
    expect(close).toHaveBeenCalledOnce()
  })
  it('passes no caller-supplied owner or provenance into the session approval command', async () => {
    mocks.rpc.mockReturnValue({ abortSignal: async () => ({ data: { id: associationId, ownerId, listingId }, error: null }) })
    expect(await commandWebsiteBaseline(client, ownerId, { action: 'approve', listingId, origin: claim.origin,
      attested: true, approvalVersion: 'merchant-website-v1', idempotencyKey: token })).toBe(associationId)
    expect(mocks.rpc).toHaveBeenCalledWith('command_merchant_website', {
      p_listing: listingId, p_action: 'approve', p_origin: claim.origin, p_association: null, p_request: token,
      p_attested: true, p_approval_version: 'merchant-website-v1',
    })
  })
  it('rejects unrelated or overbroad baseline projections', async () => {
    for (const value of [null, { ownerId, listingId }, { ownerId, listingId, collectionEnabled: true, suggestedOrigin: claim.origin, association: null, latest: null, attempt: null, rawHtml: 'PRIVATE' }]) {
      mocks.rpc.mockReturnValue({ abortSignal: async () => ({ data: value, error: null }) })
      await expect(readWebsiteBaseline(client, ownerId, listingId)).rejects.toMatchObject({ status: value === null ? 404 : 503 })
    }
  })
  it('maps only allowlisted database failures', async () => {
    mocks.rpc.mockReturnValue({ abortSignal: async () => ({ data: null, error: { code: 'PT429', message: 'daily_limit' } }) })
    await expect(websiteRpc(client, 'command_merchant_website')).rejects.toMatchObject({ status: 429 })
    mocks.rpc.mockReturnValue({ abortSignal: async () => ({ data: null, error: { code: 'PT400', message: 'PRIVATE' } }) })
    await expect(websiteRpc(client, 'command_merchant_website')).rejects.toMatchObject({ status: 503, message: 'Website baselines are temporarily unavailable.' })
  })
})

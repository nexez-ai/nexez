import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CrawlabilitySignals } from '@/lib/crawlability'
import type { SiteSignalsResult } from './site-scan'
const { rpc, gather, network, update, admin, capture } = vi.hoisted(() => {
  const update = vi.fn()
  const chain = { eq: vi.fn(), not: vi.fn(), abortSignal: vi.fn() }
  chain.eq.mockReturnValue(chain); chain.not.mockReturnValue(chain); chain.abortSignal.mockResolvedValue({ error: null })
  update.mockReturnValue(chain)
  return { rpc: vi.fn(), gather: vi.fn(), network: vi.fn(), update, admin: { from: vi.fn(() => ({ update })) }, capture: vi.fn() }
})
vi.mock('@/utils/supabase/admin', () => ({ createAdminClient: () => admin }))
vi.mock('./organization-scans', () => ({ scanRpc: rpc }))
vi.mock('./site-scan', () => ({ gatherSiteSignals: gather }))
vi.mock('./scan-network', async (original) => ({ ...await original<typeof import('./scan-network')>(), createScanNetworkContext: network }))
vi.mock('@/lib/observability', () => ({ captureEvent: capture }))
import { buildResearchObservation, researchDomain, runResearchBatch } from './large-readiness-study'
import { ScanNetworkError } from './scan-network'

const signals: CrawlabilitySignals = {
  status: 200, responseMs: 140, https: true, hasJsonLd: false, validJsonLd: false, schemaTypes: [],
  hasTitle: true, hasMetaDescription: false, hasH1: true, hasBusinessIdentity: false,
  hasOfferSchema: false, hasStructuredPrice: false, hasVisiblePrice: true, hasActionPath: true,
  hasStructuredAction: false, hasStructuredAvailability: false, hasVisibleAvailability: true,
  hasOfferDetails: false, hasContact: true, hasPolicies: true, hasFreshnessSignal: false,
  agentJsonOk: false, wellKnownAgentJsonOk: false, wellKnownAgentCardOk: false, mcpJsonOk: false,
  openApiJsonOk: false, llmsTxtOk: false,
  robots: { GPTBot: true, 'OAI-SearchBot': true, 'ChatGPT-User': true, ClaudeBot: true,
    'Claude-SearchBot': true, 'Claude-User': true, PerplexityBot: true, 'Google-Extended': true },
}
const result: SiteSignalsResult = {
  url: 'https://www.example.com', origin: 'https://www.example.com', elapsedMs: 100,
  signals, robots: signals.robots, pageText: 'Private fetched text that must not be persisted',
  researchQuality: { protocolVersion: 4, failure: null },
}
const target = { id: 'target-id', cohort: 'test-cohort', url: 'https://example.com', domain_key: 'example.com', vertical: 'restaurants', lease_token: 'lease-id' }
beforeEach(() => {
  vi.clearAllMocks()
  rpc.mockImplementation(async (_client: unknown, name: string) => name === 'study_run_status' ? { researchProtocolVersion: 4 } : name === 'claim_study_run_batch' ? [target] : true)
  gather.mockResolvedValue(result)
  network.mockImplementation(() => ({ options: {}, assertFinished: vi.fn(), close: vi.fn(async () => {}), metrics: { bytesRead: 100, probeCount: 2 } }))
})
describe('large research runner', () => {
  it('uses registrable domains but preserves private hosting tenants', () => {
    expect(researchDomain('WWW.Example.co.uk')).toBe('example.co.uk')
    expect(researchDomain('shop.example.co.uk')).toBe('example.co.uk')
    expect(researchDomain('one.github.io')).toBe('one.github.io')
    expect(researchDomain('localhost')).toBeNull()
  })
  it('removes all raw identity and page text from the observation', () => {
    const row = buildResearchObservation(result, 'test-cohort', 'restaurants')!
    expect(row.metrics).toMatchObject({ source: 'study', scanner_version: 2, research_protocol_version: 4, http_status: 200, has_visible_price: true })
    expect(row.domainHash).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(row)).not.toMatch(/example.com|Private fetched|domain_hash/)
    expect(buildResearchObservation({ ...result, origin: 'https://example.com' }, 'test-cohort', 'restaurants')?.domainHash).toBe(row.domainHash)
  })
  it.each([0, 301, 403, 404, 429, 503])('never scores HTTP %s as a usable observation', (status) => {
    expect(buildResearchObservation({ ...result, signals: { ...signals, status } }, 'test-cohort', 'restaurants')).toBeNull()
  })
  it('does not accept HTTP 200 without research content validation', () => {
    expect(buildResearchObservation({ ...result, pageText: '', researchQuality: undefined }, 'test-cohort', 'restaurants')).toBeNull()
  })
  it.each(['non_html','insufficient_content','challenge_page','parked_domain','unavailable_page','excluded_destination'] as const)('records %s without scoring or persisting text', async (failure) => {
    gather.mockResolvedValue({ ...result, researchQuality: { protocolVersion: 4, failure } })
    await runResearchBatch('test-cohort', 'dispatch-id')
    expect(rpc).toHaveBeenCalledWith(admin, 'finish_study_run_target', expect.objectContaining({ p_metrics: null, p_failure: failure }))
  })
  it.each([undefined, 1, 2, 3, 5])('does not claim a cohort with incompatible protocol %s', async (researchProtocolVersion) => {
    rpc.mockResolvedValue({ researchProtocolVersion })
    await expect(runResearchBatch('old-cohort', 'dispatch-id')).rejects.toThrow('Incompatible research protocol')
    expect(rpc).not.toHaveBeenCalledWith(admin, 'claim_study_run_batch', expect.anything())
    expect(gather).not.toHaveBeenCalled()
  })
  it('uses research capacity and fenced atomic completion', async () => {
    const response = await runResearchBatch('test-cohort', 'dispatch-id')
    expect(response).toEqual({ ok: true, claimed: 1, persisted: 1, failures: 0 })
    expect(network).toHaveBeenCalledWith('lease-id', null, admin, 'research')
    expect(gather).toHaveBeenCalledWith('https://example.com', expect.objectContaining({ researchProtocolVersion: 4 }))
    expect(rpc).toHaveBeenCalledWith(admin, 'finish_study_run_target', expect.objectContaining({
      p_cohort: 'test-cohort', p_target: 'target-id', p_lease: 'lease-id', p_failure: null, p_bytes: 100,
    }))
    expect(JSON.stringify(capture.mock.calls)).not.toMatch(/example.com|Private fetched/)
  })
  it('does not finalize another invocation on dispatch replay', async () => {
    rpc.mockImplementation(async (_client: unknown, name: string) => name === 'study_run_status' ? { researchProtocolVersion: 4 } : [])
    expect(await runResearchBatch('test-cohort', 'dispatch-id')).toMatchObject({ claimed: 0 })
    expect(update).not.toHaveBeenCalled(); expect(gather).not.toHaveBeenCalled()
  })
  it('persists robots as an exclusion, never metrics', async () => {
    gather.mockRejectedValue(new ScanNetworkError('robots_denied'))
    await runResearchBatch('test-cohort', 'dispatch-id')
    expect(rpc).toHaveBeenCalledWith(admin, 'finish_study_run_target', expect.objectContaining({ p_metrics: null, p_failure: 'robots_denied' }))
  })
  it('leaves unpersisted targets for lease recovery', async () => {
    rpc.mockImplementation(async (_client: unknown, name: string) => {
      if (name === 'study_run_status') return { researchProtocolVersion: 4 }
      if (name === 'claim_study_run_batch') return [target]
      throw new Error('database unavailable')
    })
    expect(await runResearchBatch('test-cohort', 'dispatch-id')).toMatchObject({ ok: false, failures: 1 })
  })
  it('bounds intra-invocation concurrency at three', async () => {
    rpc.mockImplementation(async (_client: unknown, name: string) => name === 'study_run_status' ? { researchProtocolVersion: 4 } : name === 'claim_study_run_batch' ? Array.from({ length: 6 }, (_, i) => ({ ...target, id: String(i) })) : true)
    let active = 0; let peak = 0
    gather.mockImplementation(async () => { active += 1; peak = Math.max(peak, active); await new Promise((resolve) => setTimeout(resolve, 5)); active -= 1; return result })
    expect(await runResearchBatch('test-cohort', 'dispatch-id')).toMatchObject({ claimed: 6, persisted: 6 })
    expect(peak).toBe(3)
  })
})

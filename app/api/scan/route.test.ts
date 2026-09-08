import { describe, it, expect, vi, beforeEach } from 'vitest'

let rateLimited = false
const gatherSiteSignals = vi.fn()
const scheduleScanResultPersist = vi.fn()
const networkFinished = vi.fn()
const networkClose = vi.fn()
vi.mock('@/lib/server/scan-network', async (original) => ({
  ...await original<typeof import('@/lib/server/scan-network')>(),
  createScanNetworkContext: () => ({ options: {}, assertFinished: networkFinished, close: networkClose }),
}))

vi.mock('../../../lib/rate-limit', () => ({
  enforceRateLimit: vi.fn(async () => (rateLimited ? new Response('rate', { status: 429 }) : null)),
}))
vi.mock('../../../lib/server/site-scan', () => ({
  gatherSiteSignals: (...a: unknown[]) => gatherSiteSignals(...a),
  normalizeScanUrl: (value: string) => {
    if (!value) return null
    return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).toString()
  },
}))
vi.mock('../../../lib/observability', () => ({ captureEvent: vi.fn(), captureError: vi.fn() }))
vi.mock('../../../lib/server/log-scan-result', () => ({
  scheduleScanResultPersist: (...a: unknown[]) => scheduleScanResultPersist(...a),
}))

import { POST } from './route'

const post = (body: unknown) =>
  new Request('https://nexez.test/api/scan', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

const allowedRobots = {
  GPTBot: true, 'OAI-SearchBot': true, 'ChatGPT-User': true, ClaudeBot: false,
  'Claude-SearchBot': true, 'Claude-User': true, PerplexityBot: true, 'Google-Extended': true,
}

describe('POST /api/scan (public anonymous scanner)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    networkFinished.mockReset()
    rateLimited = false
  })

  it('fails closed when the shared scanner pressure service is unavailable', async () => {
    const { ScanNetworkError } = await import('@/lib/server/scan-network')
    networkFinished.mockImplementation(() => { throw new ScanNetworkError('network_error') })
    gatherSiteSignals.mockResolvedValue({ error: 'not used' })
    expect((await POST(post({ url: 'acme.com' }))).status).toBe(503)
    expect(scheduleScanResultPersist).not.toHaveBeenCalled()
    expect(networkClose).toHaveBeenCalledOnce()
  })

  it('429 when rate-limited', async () => {
    rateLimited = true
    expect((await POST(post({ url: 'x.com' }))).status).toBe(429)
    expect(gatherSiteSignals).not.toHaveBeenCalled()
    expect(scheduleScanResultPersist).not.toHaveBeenCalled()
  })

  it('400 on invalid JSON', async () => {
    const bad = new Request('https://nexez.test/api/scan', { method: 'POST', body: 'not json' })
    expect((await POST(bad)).status).toBe(400)
  })

  it('400 when the gatherer rejects the URL (SSRF / bad input)', async () => {
    gatherSiteSignals.mockResolvedValue({ error: 'Blocked private host' })
    const res = await POST(post({ url: 'http://169.254.169.254/' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/blocked/i)
    // Failed scans must never be persisted.
    expect(scheduleScanResultPersist).not.toHaveBeenCalled()
  })

  it('returns score + checks + blockedBots and NO raw page body', async () => {
    gatherSiteSignals.mockResolvedValue({
      url: 'https://acme.com/',
      origin: 'https://acme.com',
      elapsedMs: 120,
      robots: allowedRobots,
      signals: {
        status: 200,
        responseMs: 120,
        https: true,
        hasJsonLd: true,
        validJsonLd: true,
        schemaTypes: ['Organization', 'Offer'],
        hasTitle: true,
        hasMetaDescription: true,
        hasH1: true,
        hasBusinessIdentity: true,
        hasOfferSchema: true,
        hasStructuredPrice: true,
        hasVisiblePrice: true,
        hasActionPath: true,
        hasStructuredAction: true,
        hasStructuredAvailability: true,
        hasVisibleAvailability: true,
        hasOfferDetails: true,
        hasContact: true,
        hasPolicies: true,
        hasFreshnessSignal: true,
        agentJsonOk: true,
        wellKnownAgentJsonOk: false,
        wellKnownAgentCardOk: false,
        mcpJsonOk: true,
        openApiJsonOk: true,
        llmsTxtOk: true,
        robots: allowedRobots,
      },
    })
    const res = await POST(post({ url: 'acme.com' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(typeof json.score).toBe('number')
    expect(json.version).toBe(2)
    expect(json.dimensions.transactability.score).toBe(100)
    expect(Array.isArray(json.checks)).toBe(true)
    expect(json.blockedBots).toContain('ClaudeBot')
    // Anti-scraping-relay: never leaks fetched HTML.
    const raw = JSON.stringify(json)
    expect(raw).not.toContain('<html')
    expect(raw).not.toContain('<body')
    // Completed scans schedule exactly one anonymized persistence call.
    expect(scheduleScanResultPersist).toHaveBeenCalledTimes(1)
    expect(scheduleScanResultPersist).toHaveBeenCalledWith(
      expect.objectContaining({ origin: 'https://acme.com', report: expect.objectContaining({ version: 2 }) }),
    )
  })
})

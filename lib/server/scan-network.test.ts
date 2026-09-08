import { beforeEach, describe, expect, it, vi } from 'vitest'

const { safeFetch, rpc, robots, replies, capture } = vi.hoisted(() => ({
  safeFetch: vi.fn(), rpc: vi.fn(), capture: vi.fn(), robots: new Map<string, string | number>(), replies: new Map<string, unknown>(),
}))
vi.mock('@/lib/observability', () => ({ captureEvent: capture }))
vi.mock('@/lib/importer', async (original) => ({
  ...await original<typeof import('@/lib/importer')>(), safeFetch,
  getResolvedImportUrlError: async () => null,
}))
vi.mock('@/utils/supabase/admin', () => ({ createAdminClient: () => ({ rpc }), hasSupabaseAdminEnv: () => true }))
import { createScanNetworkContext, ScanNetworkError } from './scan-network'
import { gatherSiteSignals } from './site-scan'

beforeEach(() => {
  vi.clearAllMocks(); robots.clear(); replies.clear()
  rpc.mockImplementation((name: string) => ({ abortSignal: async () => ({ error: null, data: replies.has(name) ? replies.get(name) : 'allowed' }) }))
  safeFetch.mockImplementation(async (value: string, _init: RequestInit, options: { beforeRequest?: (url: string) => Promise<boolean> }) => {
    if (options.beforeRequest && !await options.beforeRequest(value)) return null
    const url = new URL(value)
    const policy = robots.get(url.origin) ?? ''
    if (url.pathname === '/robots.txt') return typeof policy === 'number' ? new Response(null, { status: policy }) : new Response(policy)
    return new Response('<html><title>Example</title><h1>Example</h1></html>')
  })
})

describe('shared scanner network boundary', () => {
  it('checks the durable limiter before fetching robots or a page, and caches one permit per registrable domain', async () => {
    const context = createScanNetworkContext('token')
    try {
      expect(await context.options.beforeRequest!('https://www.example.co.uk/')).toBe(true)
      expect(await context.options.beforeRequest!('https://shop.example.co.uk/agent.json')).toBe(true)
      expect(rpc.mock.calls.filter(([name]) => name === 'acquire_scan_network_slot')).toEqual([
        ['acquire_scan_network_slot', { p_domain: 'example.co.uk', p_token: 'token', p_org_id: null }],
      ])
      expect(safeFetch.mock.calls.every(([, init, opts]) => opts.pinnedDns && opts.standardPortsOnly && init.signal)).toBe(true)
    } finally { await context.close() }
    expect(rpc).toHaveBeenLastCalledWith('release_scan_network_slot', { p_token: 'token' })
  })
  it('treats hosted tenants as separate pressure domains', async () => {
    const context = createScanNetworkContext('token')
    try {
      await context.options.beforeRequest!('https://one.github.io/')
      await context.options.beforeRequest!('https://two.github.io/')
      expect(rpc.mock.calls.filter(([name]) => name === 'acquire_scan_network_slot').map(([, args]) => args.p_domain)).toEqual(['one.github.io', 'two.github.io'])
    } finally { await context.close() }
  })
  it.each([['busy', 'pressure_deferred'], ['denied', 'target_unavailable'], ['cooldown', 'target_unavailable'], [null, 'network_error']])('fails closed for limiter response %s', async (reply, code) => {
    replies.set('acquire_scan_network_slot', reply)
    const context = createScanNetworkContext('token')
    try {
      await expect(context.options.beforeRequest!('https://example.com/')).rejects.toMatchObject({ code })
      expect(safeFetch).not.toHaveBeenCalled()
      expect(() => context.assertFinished()).toThrow(ScanNetworkError)
    } finally { await context.close() }
  })
  it('fails closed on database outage and never leaks its error', async () => {
    rpc.mockImplementation(() => ({ abortSignal: async () => { throw new Error('credential secret') } }))
    const context = createScanNetworkContext('token')
    await expect(context.options.beforeRequest!('https://example.com/')).rejects.toMatchObject({ message: 'network_error' })
    expect(safeFetch).not.toHaveBeenCalled()
    expect(capture).toHaveBeenCalledWith('scanner.limiter_unavailable', { scope: 'public' })
    expect(JSON.stringify(capture.mock.calls)).not.toMatch(/secret|example.com/)
    await context.close()
  })
  it('refuses private redirects, credentials and ports before even acquiring pressure', async () => {
    for (const url of ['http://169.254.169.254/', 'https://user:secret@example.com/', 'https://example.com:8443/']) {
      const context = createScanNetworkContext('token')
      await expect(context.options.beforeRequest!(url)).rejects.toMatchObject({ code: 'unsafe_target' })
      await context.close()
    }
    expect(rpc.mock.calls.some(([name]) => name === 'acquire_scan_network_slot')).toBe(false)
    expect(safeFetch).not.toHaveBeenCalled()
  })
  it.each(['User-agent: *\nDisallow: /', 403, 500, 'x'.repeat(65537), 'User-agent: *\nDisallow: /' + 'a'.repeat(600)])('does not fetch a denied or indeterminate homepage', async (policy) => {
    robots.set('https://example.com', policy)
    const context = createScanNetworkContext('token')
    await expect(context.options.beforeRequest!('https://example.com/')).rejects.toBeInstanceOf(ScanNetworkError)
    expect(safeFetch.mock.calls).toHaveLength(1)
    expect(safeFetch.mock.calls[0][0]).toBe('https://example.com/robots.txt')
    await context.close()
  })
  it('permits a missing robots file and skips only disallowed auxiliary paths', async () => {
    robots.set('https://example.com', 404)
    const missing = createScanNetworkContext('token')
    expect(await missing.options.beforeRequest!('https://example.com/')).toBe(true)
    await missing.close()
    robots.set('https://example.com', 'User-agent: NexezBot\nDisallow: /agent.json')
    const context = createScanNetworkContext('token')
    expect(await context.options.beforeRequest!('https://example.com/')).toBe(true)
    expect(await context.options.beforeRequest!('https://example.com/agent.json')).toBe(false)
    expect(() => context.assertFinished()).not.toThrow()
    await context.close()
  })
  it('does not let a robots redirect fetch arbitrary paths or unrelated domains', async () => {
    for (const redirect of ['https://other.com/robots.txt', 'https://example.com/private', 'https://example.com/robots.txt?secret=1']) {
      const context = createScanNetworkContext('token')
      safeFetch.mockImplementationOnce(async (_value, _init, opts) => opts.beforeRequest(redirect))
      await expect(context.options.beforeRequest!('https://example.com/')).rejects.toMatchObject({ code: 'robots_denied' })
      await context.close()
    }
  })
  it('bounds total body processing and attempts across redirects and probes', async () => {
    const context = createScanNetworkContext('token')
    context.options.onBodyBytes!(3145728)
    expect(() => context.options.onBodyBytes!(1)).toThrow(ScanNetworkError)
    await context.close()
    const probes = createScanNetworkContext('token')
    for (let i = 0; i < 31; i++) await probes.options.beforeRequest!('https://example.com/agent.json')
    await expect(probes.options.beforeRequest!('https://example.com/agent.json')).rejects.toMatchObject({ code: 'target_unavailable' })
    await probes.close()
  })
  it('guards every existing gather caller by default, including anonymous and deep scans', async () => {
    replies.set('acquire_scan_network_slot', 'busy')
    await expect(gatherSiteSignals('https://example.com')).rejects.toMatchObject({ code: 'pressure_deferred' })
    expect(rpc.mock.calls.some(([name]) => name === 'release_scan_network_slot')).toBe(true)
    // Transport stubs call policy first; the denied request never receives a body.
    expect(safeFetch.mock.calls.every(([url]) => url !== 'https://example.com/robots.txt')).toBe(true)
  })
})

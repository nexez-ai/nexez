import 'server-only'
import { getDomain } from 'tldts'
import type { SupabaseClient } from '@supabase/supabase-js'
import { safeFetch, getImportUrlError } from '@/lib/importer'
import { isRobotPathAllowed } from '@/lib/crawlability'
import { readBodyCapped } from './read-body-capped'
import { ROBOTS_BYTE_CAP, SCAN_UA, type SiteScanOptions } from './site-scan'
import { createAdminClient } from '@/utils/supabase/admin'
import { scanRpc } from './organization-scans'
import { captureEvent } from '@/lib/observability'

export class ScanNetworkError extends Error {
  constructor(readonly code: 'robots_denied' | 'network_error' | 'target_unavailable' | 'pressure_deferred' | 'unsafe_target') {
    super(code)
  }
}

/** One bounded scan, including every redirect and auxiliary request. Nothing
 * returned by this context belongs in an event payload or durable step result.
 */
export function createScanNetworkContext(token: string, orgId: string | null = null, client?: SupabaseClient) {
  let admin: SupabaseClient
  try { admin = client ?? createAdminClient() } catch { throw new ScanNetworkError('network_error') }
  // Anonymous routes have a 30-second invocation budget. Leave room for
  // validation and the bounded lease-release request after collection stops.
  const deadline = AbortSignal.timeout(orgId ? 28_000 : 20_000)
  const stop = new AbortController()
  const signal = AbortSignal.any([deadline, stop.signal])
  const domains = new Map<string, Promise<void>>()
  const robots = new Map<string, Promise<string>>()
  const metrics = { bytesRead: 0, probeCount: 0 }
  let stopped: ScanNetworkError | null = null
  function fail(code: ScanNetworkError['code']): never {
    stopped ??= new ScanNetworkError(code)
    stop.abort()
    throw stopped
  }
  async function pressure(url: URL) {
    const domain = getDomain(url.hostname, { allowPrivateDomains: true }) ?? url.hostname
    let permit = domains.get(domain)
    if (!permit) {
      permit = (async () => {
        let status: unknown
        try { status = await scanRpc(admin, 'acquire_scan_network_slot', { p_domain: domain, p_token: token, p_org_id: orgId }) }
        catch {
          captureEvent('scanner.limiter_unavailable', { scope: orgId ? 'organization' : 'public', ...(orgId ? { orgId } : {}) })
          fail('network_error')
        }
        if (status === 'busy') fail('pressure_deferred')
        if (status === 'cooldown' || status === 'denied') fail('target_unavailable')
        if (status !== 'allowed') {
          captureEvent('scanner.limiter_unavailable', { scope: orgId ? 'organization' : 'public', ...(orgId ? { orgId } : {}) })
          fail('network_error')
        }
      })()
      domains.set(domain, permit)
    }
    await permit
  }
  function onBodyBytes(bytes: number) {
    metrics.bytesRead += bytes
    if (metrics.bytesRead > 3 * 1024 * 1024) fail('target_unavailable')
  }
  async function beforeTransport(value: string) {
    if (signal.aborted) throw stopped ?? new ScanNetworkError('network_error')
    if (value.length > 2048 || getImportUrlError(value)) fail('unsafe_target')
    const url = new URL(value)
    if (url.port) fail('unsafe_target')
    await pressure(url)
    metrics.probeCount += 1
    if (metrics.probeCount > 32) fail('target_unavailable')
    return true
  }
  async function readRobots(origin: string): Promise<string> {
    const domain = getDomain(new URL(origin).hostname, { allowPrivateDomains: true }) ?? new URL(origin).hostname
    const response = await safeFetch(`${origin}/robots.txt`, { signal, headers: { 'User-Agent': SCAN_UA } }, {
      pinnedDns: true, standardPortsOnly: true, timeoutMs: 4500, maxRedirects: 2,
      beforeRequest: async (value) => {
        const url = new URL(value)
        // A robots redirect cannot turn the exemption into an arbitrary fetch.
        if (url.pathname !== '/robots.txt' || url.search || (getDomain(url.hostname, { allowPrivateDomains: true }) ?? url.hostname) !== domain) fail('robots_denied')
        return beforeTransport(value)
      },
    })
    if (!response) fail('network_error')
    if (response.status === 404 || response.status === 410) { await response.body?.cancel(); return '' }
    if (response.status === 401 || response.status === 403) { await response.body?.cancel(); fail('robots_denied') }
    if (!response.ok) { await response.body?.cancel(); fail('network_error') }
    const text = await readBodyCapped(response, ROBOTS_BYTE_CAP + 1, onBodyBytes)
    if (text === null) fail('network_error')
    if (new TextEncoder().encode(text).byteLength >= ROBOTS_BYTE_CAP || text.split(/\r?\n/).some((line) => /^(allow|disallow)\s*:/i.test(line.trim()) && line.length > 512)) fail('robots_denied')
    return text
  }
  const options: SiteScanOptions = {
    signal, onBodyBytes,
    beforeRequest: async (value) => {
      await beforeTransport(value)
      const url = new URL(value)
      let policy = robots.get(url.origin)
      if (!policy) { policy = readRobots(url.origin); robots.set(url.origin, policy) }
      const text = await policy
      if (!isRobotPathAllowed(text, 'NexezBot', url.pathname + url.search)) {
        // Auxiliary files may be disallowed independently of the homepage.
        if (url.pathname === '/') fail('robots_denied')
        return false
      }
      return true
    },
  }
  return {
    options, metrics,
    assertFinished() { if (stopped) throw stopped; if (signal.aborted) throw new ScanNetworkError('network_error') },
    async close() {
      stop.abort()
      // The finite DB lease still releases capacity if this cleanup request fails.
      try { await scanRpc(admin, 'release_scan_network_slot', { p_token: token }) } catch { /* bounded expiry */ }
    },
  }
}

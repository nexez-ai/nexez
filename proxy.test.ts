import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { NextResponse } from 'next/server'

const { supabaseRef } = vi.hoisted(() => ({
  // What the pages_public lookup resolves (or rejects) with, per test.
  supabaseRef: {
    respond: async (): Promise<{ data: unknown; error: unknown }> => ({ data: [], error: null }),
  },
}))

// updateSession is only reached on platform hosts; mocking it keeps the module
// graph hermetic and makes "was any work done?" observable.
vi.mock('./utils/supabase/middleware', () => ({
  updateSession: vi.fn(async () => NextResponse.next()),
}))

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({
    from: () => {
      const builder: any = {
        select: () => builder,
        in: () => builder,
        eq: () => builder,
        not: () => builder,
        returns: () => supabaseRef.respond(),
      }
      return builder
    },
  })),
}))

import { NextRequest } from 'next/server'
import { proxy } from './proxy'
import { updateSession } from './utils/supabase/middleware'
import { createServerClient } from '@supabase/ssr'

const request = (url: string, host: string) => new NextRequest(url, { headers: { host } })

/** Next signals a middleware rewrite with this header; null means no rewrite happened. */
const rewriteTarget = (res: Response) => res.headers.get('x-middleware-rewrite')

const rows = (data: Array<{ slug: string; domain_path: string | null }>) => async () => ({
  data,
  error: null,
})

// Seven production runtime error groups came from a trailing encoded backslash:
//   /agent.json%5C -> Cannot find module './.next/server/pages/agent.json%5C.js'
// The path reached the Next.js launcher, which threw MODULE_NOT_FOUND instead of
// answering 404. Nothing in this repo emits these URLs, so the fix is to fail
// gracefully at the edge rather than to stop producing them.
describe('proxy: malformed artifact paths', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    supabaseRef.respond = rows([])
  })

  const malformed = [
    'https://nexez.app/agent.json%5C',
    'https://nexez.app/agent-pages.json%5C',
    'https://nexez.app/.well-known/nexez.json%5C',
  ]

  it.each(malformed)('404s %s cleanly, without throwing', async (url) => {
    const res = await proxy(request(url, 'nexez.app'))
    expect(res.status).toBe(404)
  })

  it('does no work before rejecting: no session refresh, no domain lookup', async () => {
    await proxy(request('https://nexez.app/agent.json%5C', 'nexez.app'))
    expect(updateSession).not.toHaveBeenCalled()
    expect(createServerClient).not.toHaveBeenCalled()
  })

  it('404s on a custom domain too, rather than redirecting to the canonical host', async () => {
    const res = await proxy(request('https://malformed.example.com/agent.json%5C', 'malformed.example.com'))
    expect(res.status).toBe(404)
    expect(createServerClient).not.toHaveBeenCalled()
  })

  it('rejects encoded control characters and undecodable sequences', async () => {
    expect((await proxy(request('https://nexez.app/agent.json%00', 'nexez.app'))).status).toBe(404)
    expect((await proxy(request('https://nexez.app/agent.json%ZZ', 'nexez.app'))).status).toBe(404)
  })

  it('leaves a clean path alone: the guard is not over-broad', async () => {
    // An unmapped custom domain 308s to the canonical host. What matters is that
    // this is NOT the guard's 404.
    const res = await proxy(request('https://clean.example.com/agent.json', 'clean.example.com'))
    expect(res.status).not.toBe(404)
    expect(createServerClient).toHaveBeenCalled()
  })
})

describe('proxy: legacy Shopify linking route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    supabaseRef.respond = rows([])
  })

  it('redirects to the free connector before dashboard auth', async () => {
    const res = await proxy(
      request('https://app.nexez.ai/dashboard/shopify?error=stale', 'app.nexez.ai'),
    )

    expect(res.status).toBe(308)
    expect(res.headers.get('location')).toBe('https://app.nexez.ai/shopify/link')
    expect(updateSession).not.toHaveBeenCalled()
    expect(createServerClient).not.toHaveBeenCalled()
  })
})

// A Supabase blip (observed: TypeError: fetch failed / ECONNRESET) used to
// produce an empty path map that was then cached for the full 60s TTL. Every
// custom-domain request on that edge instance served nothing for a minute, with
// nothing logged. A hostname's mapping changes rarely, so stale routing beats no
// routing.
describe('proxy: custom-domain lookup failures', () => {
  let warn: ReturnType<typeof vi.spyOn>
  let dateNow: ReturnType<typeof vi.spyOn>
  let now: number

  beforeEach(() => {
    vi.clearAllMocks()
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    now = 1_760_000_000_000
    dateNow = vi.spyOn(Date, 'now').mockImplementation(() => now)
  })

  // Restore only these two spies. vi.restoreAllMocks() would also reset the
  // module mocks defined above, taking createServerClient's implementation with it.
  afterEach(() => {
    warn.mockRestore()
    dateNow.mockRestore()
  })

  // Each test uses its own host: the cache is module state shared across the file.
  const prime = async (host: string, slug: string) => {
    supabaseRef.respond = rows([{ slug, domain_path: '/' }])
    const res = await proxy(request(`https://${host}/`, host))
    expect(rewriteTarget(res)).toContain(`/${slug}`)
  }

  const failWith = (err: unknown) => {
    supabaseRef.respond = async () => {
      throw err
    }
  }

  it('keeps serving the stale map when the refresh fails', async () => {
    const host = 'stale.example.com'
    await prime(host, 'acme')

    now += 61_000 // past the 60s TTL, so the next request refreshes
    failWith(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }))

    const res = await proxy(request(`https://${host}/`, host))
    expect(rewriteTarget(res)).toContain('/acme')
  })

  it('logs the host and error code instead of failing silently', async () => {
    const host = 'logged.example.com'
    await prime(host, 'acme')

    now += 61_000
    failWith(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }))
    await proxy(request(`https://${host}/`, host))

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('custom-domain lookup failed'),
      host,
      'ECONNRESET',
    )
  })

  it('does not cache the failure: it retries once the backoff clears', async () => {
    const host = 'retry.example.com'
    await prime(host, 'acme')

    now += 61_000
    failWith(new Error('boom'))
    await proxy(request(`https://${host}/`, host))

    // Past the retry window but still well inside what would have been the failed
    // entry's 60s TTL. A cached failure would serve an empty map from here on.
    now += 3_100
    vi.mocked(createServerClient).mockClear()
    supabaseRef.respond = rows([{ slug: 'acme-v2', domain_path: '/' }])
    const res = await proxy(request(`https://${host}/`, host))

    expect(createServerClient).toHaveBeenCalled()
    expect(rewriteTarget(res)).toContain('/acme-v2')
  })

  // Removing the negative cache outright made a SUSTAINED outage worse than the bug
  // it replaced: every request paid the full failure latency and logged. The backoff
  // bounds both while the stale map keeps serving.
  it('does not re-query on every request during a sustained outage', async () => {
    const host = 'storm.example.com'
    await prime(host, 'acme')

    now += 61_000
    failWith(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ETIMEDOUT' } }))
    await proxy(request(`https://${host}/`, host))

    vi.mocked(createServerClient).mockClear()
    warn.mockClear()
    for (let i = 0; i < 5; i += 1) {
      const res = await proxy(request(`https://${host}/`, host))
      // Still routing correctly the whole time.
      expect(rewriteTarget(res)).toContain('/acme')
    }

    expect(createServerClient).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  })

  it('clears the backoff as soon as a query succeeds', async () => {
    const host = 'recover.example.com'
    await prime(host, 'acme')

    now += 61_000
    failWith(new Error('boom'))
    await proxy(request(`https://${host}/`, host))

    now += 3_100
    supabaseRef.respond = rows([{ slug: 'acme', domain_path: '/' }])
    await proxy(request(`https://${host}/`, host))

    // Recovered, so the fresh entry is cached normally: no query, no backoff.
    vi.mocked(createServerClient).mockClear()
    now += 1_000
    const res = await proxy(request(`https://${host}/`, host))
    expect(createServerClient).not.toHaveBeenCalled()
    expect(rewriteTarget(res)).toContain('/acme')
  })

  it('treats a PostgREST error payload as a failure, not as an empty domain', async () => {
    const host = 'pgerror.example.com'
    await prime(host, 'acme')

    now += 61_000
    supabaseRef.respond = async () => ({ data: null, error: { code: '42501', message: 'permission denied' } })

    const res = await proxy(request(`https://${host}/`, host))
    expect(rewriteTarget(res)).toContain('/acme')
    expect(warn).toHaveBeenCalledWith(expect.any(String), host, '42501')
  })

  it('serves nothing routable, but does not throw, when the first ever lookup fails', async () => {
    const host = 'cold.example.com'
    failWith(new Error('boom'))

    // No stale map exists, so this host has nothing to route: it falls through to
    // the canonical-host redirect rather than erroring.
    const res = await proxy(request(`https://${host}/`, host))
    expect(res.status).toBe(308)
    expect(warn).toHaveBeenCalled()
  })

  it('still serves a healthy lookup from cache without re-querying', async () => {
    const host = 'cached.example.com'
    await prime(host, 'acme')

    vi.mocked(createServerClient).mockClear()
    now += 1_000 // well inside the TTL
    const res = await proxy(request(`https://${host}/`, host))

    expect(createServerClient).not.toHaveBeenCalled()
    expect(rewriteTarget(res)).toContain('/acme')
  })
})

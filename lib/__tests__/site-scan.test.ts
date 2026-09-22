import { beforeEach, describe, expect, it, vi } from 'vitest'

const safeFetch = vi.fn()
let importUrlError: string | null = null
let resolvedUrlError: string | null = null

vi.mock('../importer', () => ({
  safeFetch: (...args: unknown[]) => safeFetch(...args),
  getImportUrlError: () => importUrlError,
  getResolvedImportUrlError: async () => resolvedUrlError,
}))

import { extractStructuredEvidence, gatherSiteSignals, normalizeScanUrl, readBodyCapped } from '../server/site-scan'

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let index = 0
  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) controller.enqueue(chunks[index++])
      else controller.close()
    },
  })
}

function bodyResponse(body: string, init: ResponseInit = {}): Response {
  return new Response(streamOf([new TextEncoder().encode(body)]), { status: 200, ...init })
}

describe('normalizeScanUrl', () => {
  it('prepends HTTPS for bare domains and rejects empty input', () => {
    expect(normalizeScanUrl('acme.com')).toBe('https://acme.com/')
    expect(normalizeScanUrl('https://x.io/p')).toBe('https://x.io/p')
    expect(normalizeScanUrl('')).toBeNull()
  })
})

describe('readBodyCapped', () => {
  it('truncates across stream chunks at the byte cap', async () => {
    const encode = (value: string) => new TextEncoder().encode(value)
    const response = new Response(streamOf([encode('aaaa'), encode('bbbb'), encode('cccc')]))
    expect(await readBodyCapped(response, 6)).toBe('aaaabb')
  })

  it('returns a complete body below the cap', async () => {
    expect(await readBodyCapped(bodyResponse('hello'), 1024)).toBe('hello')
  })
})

describe('extractStructuredEvidence', () => {
  it('requires parseable, concrete business and offer schema', () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'Organization', name: 'Acme', contactPoint: { '@type': 'ContactPoint', url: '/support' } },
        {
          '@type': 'Service',
          name: 'Strategy session',
          description: 'A 60-minute planning session.',
          offers: {
            '@type': 'Offer',
            price: 299,
            priceCurrency: 'USD',
            availability: 'https://schema.org/InStock',
            url: '/checkout',
          },
        },
      ],
    })}</script>`
    const evidence = extractStructuredEvidence(html)
    expect(evidence.validJsonLd).toBe(true)
    expect(evidence.hasBusinessIdentity).toBe(true)
    expect(evidence.hasOfferSchema).toBe(true)
    expect(evidence.hasStructuredPrice).toBe(true)
    expect(evidence.hasStructuredAction).toBe(true)
    expect(evidence.hasStructuredAvailability).toBe(true)
    expect(evidence.hasOfferDetails).toBe(true)
  })

  it('reports invalid JSON-LD separately from presence', () => {
    const evidence = extractStructuredEvidence('<script type="application/ld+json">not-json</script>')
    expect(evidence.hasJsonLd).toBe(true)
    expect(evidence.validJsonLd).toBe(false)
    expect(evidence.hasOfferSchema).toBe(false)
  })
})

describe('gatherSiteSignals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    importUrlError = null
    resolvedUrlError = null
  })

  it('rejects unsafe literal and resolved hosts without fetching', async () => {
    importUrlError = 'Blocked private host'
    expect(await gatherSiteSignals('http://169.254.169.254/', {})).toEqual({ error: 'Blocked private host' })
    expect(safeFetch).not.toHaveBeenCalled()

    importUrlError = null
    resolvedUrlError = 'Resolves to a private IP'
    expect(await gatherSiteSignals('http://localtest.me/', {})).toEqual({ error: 'Resolves to a private IP' })
    expect(safeFetch).not.toHaveBeenCalled()
  })

  it('derives concrete V2 evidence from one page fetch and bounded probes', async () => {
    const pageHtml = [
      '<html><head><title>Acme</title><meta name="description" content="Strategy">',
      '<meta property="article:modified_time" content="2026-07-01">',
      '<script type="application/ld+json">',
      JSON.stringify({
        '@context': 'https://schema.org',
        '@graph': [
          { '@type': 'Organization', name: 'Acme', contactPoint: { '@type': 'ContactPoint', url: '/support' }, termsOfService: '/terms' },
          { '@type': 'Service', name: 'Strategy session', description: 'Planning service', offers: { '@type': 'Offer', price: 299, priceCurrency: 'USD', availability: 'https://schema.org/InStock', url: '/checkout' } },
        ],
      }),
      '</script></head><body><h1>Strategy sessions</h1><a href="/book">Book now</a><a href="/privacy">Privacy</a></body></html>',
    ].join('')

    safeFetch.mockImplementation(async (url: string) => {
      if (url.endsWith('/agent.json') && !url.includes('.well-known')) {
        return bodyResponse('{"name":"Acme","offers":[]}')
      }
      if (url.endsWith('/.well-known/mcp.json')) return bodyResponse('{"servers":[]}')
      if (url.endsWith('/openapi.json')) return bodyResponse('{"openapi":"3.1.0","paths":{}}')
      if (url.endsWith('/llms.txt')) return bodyResponse('# Acme\nStructured offers and booking details.')
      if (url.endsWith('/robots.txt')) return new Response('', { status: 404 })
      if (url.includes('/.well-known/')) return new Response('', { status: 404 })
      return bodyResponse(pageHtml, { headers: { 'Last-Modified': 'Wed, 01 Jul 2026 12:00:00 GMT' } })
    })

    const output = await gatherSiteSignals('acme.com', {})
    expect('error' in output).toBe(false)
    if ('error' in output) return
    expect(output.origin).toBe('https://acme.com')
    expect(output.signals.validJsonLd).toBe(true)
    expect(output.signals.hasBusinessIdentity).toBe(true)
    expect(output.signals.hasOfferSchema).toBe(true)
    expect(output.signals.hasStructuredPrice).toBe(true)
    expect(output.signals.hasActionPath).toBe(true)
    expect(output.signals.hasPolicies).toBe(true)
    expect(output.signals.hasFreshnessSignal).toBe(true)
    expect(output.signals.agentJsonOk).toBe(true)
    expect(output.signals.mcpJsonOk).toBe(true)
    expect(output.signals.openApiJsonOk).toBe(true)
    expect(output.signals.llmsTxtOk).toBe(true)
    expect(safeFetch).toHaveBeenCalledTimes(8)
    expect(safeFetch.mock.calls.every((call) => call[2]?.pinnedDns === true)).toBe(true)
  })

  it('probes discovery files on the final canonical origin after redirects', async () => {
    safeFetch.mockImplementation(async (url: string) => {
      if (url === 'https://acme.com/') {
        const response = bodyResponse('<html><head><title>Acme</title></head><body><h1>Acme</h1></body></html>')
        Object.defineProperty(response, 'url', { value: 'https://www.acme.com/welcome' })
        return response
      }
      return new Response('', { status: 404 })
    })

    const output = await gatherSiteSignals('acme.com', {})
    expect('error' in output).toBe(false)
    if ('error' in output) return
    expect(output.url).toBe('https://www.acme.com/welcome')
    expect(output.origin).toBe('https://www.acme.com')
    expect(safeFetch.mock.calls.slice(1).every((call) => String(call[0]).startsWith('https://www.acme.com/'))).toBe(true)
  })

  it('does not count an HTML soft-404 as llms.txt in research mode', async () => {
    safeFetch.mockImplementation(async () => bodyResponse(
      '<html><head><title>Page not found</title></head><body>Sorry, this page does not exist.</body></html>',
      { headers: { 'Content-Type': 'text/html' } },
    ))
    const output = await gatherSiteSignals('acme.com', { researchProtocolVersion: 4 })
    if ('error' in output) throw new Error('Unexpected URL error')
    expect(output.signals.llmsTxtOk).toBe(false)
    expect(output.researchQuality).toEqual({ protocolVersion: 4, failure: 'unavailable_page' })
    const legacy = await gatherSiteSignals('acme.com', {})
    if ('error' in legacy) throw new Error('Unexpected URL error')
    expect(legacy.signals.llmsTxtOk).toBe(true)
    expect(legacy).not.toHaveProperty('researchQuality')
  })

  it('excludes readable expired-domain boilerplate only in research mode', async () => {
    safeFetch.mockImplementation(async () => bodyResponse(
      '<html><body>Domain registration has expired. Renewal instructions: sign in to your registrar account, open your domain list and choose Renew. Browse domain auctions and renewal help.</body></html>',
      { headers: { 'Content-Type': 'text/html' } },
    ))
    const output = await gatherSiteSignals('acme.com', { researchProtocolVersion: 4 })
    if ('error' in output) throw new Error('Unexpected URL error')
    expect(output.signals.status).toBe(200)
    expect(output.researchQuality).toEqual({ protocolVersion: 4, failure: 'parked_domain' })
    const customer = await gatherSiteSignals('acme.com', {})
    expect(customer).not.toHaveProperty('researchQuality')
  })

  it.each([
    ['This Townsquare Interactive website is no longer available. If you have any questions please contact our support team.', 'unavailable_page'],
    ['has been recently registered with Namecheap. Want a domain name like this? Discover domains on auction now.', 'parked_domain'],
  ])('excludes research placeholders without changing customer results', async (text, failure) => {
    safeFetch.mockImplementation(async () => bodyResponse(`<html><body>${text}</body></html>`,
      { headers: { 'Content-Type': 'text/html' } }))
    const research = await gatherSiteSignals('acme.com', { researchProtocolVersion: 4 })
    if ('error' in research) throw new Error('Unexpected URL error')
    expect(research.researchQuality).toEqual({ protocolVersion: 4, failure })
    const customer = await gatherSiteSignals('acme.com', {})
    expect(customer).not.toHaveProperty('researchQuality')
  })

  it('accepts readable research HTML and a short valid llms.txt without extra requests', async () => {
    safeFetch.mockImplementation(async (url: string) => {
      if (url.endsWith('/llms.txt')) return bodyResponse('# Acme', { headers: { 'Content-Type': 'text/markdown' } })
      if (url.endsWith('/')) return bodyResponse(
        '<html><head><title>Acme Plumbing</title></head><body><p>Acme Plumbing provides installation and repairs throughout the local area. Contact our team to schedule service.</p></body></html>',
        { headers: { 'Content-Type': 'text/html' } },
      )
      return new Response('', { status: 404 })
    })
    const output = await gatherSiteSignals('acme.com', { researchProtocolVersion: 4 })
    if ('error' in output) throw new Error('Unexpected URL error')
    expect(output.researchQuality).toEqual({ protocolVersion: 4, failure: null })
    expect(output.signals.llmsTxtOk).toBe(true)
    expect(safeFetch).toHaveBeenCalledTimes(8)
  })

  it('does not use a long HTML title to qualify an empty research page', async () => {
    safeFetch.mockImplementation(async () => bodyResponse(
      `<html><head><title>${'Business title '.repeat(20)}</title></head><body></body></html>`,
      { headers: { 'Content-Type': 'text/html' } },
    ))
    const output = await gatherSiteSignals('acme.com', { researchProtocolVersion: 4 })
    if ('error' in output) throw new Error('Unexpected URL error')
    expect(output.researchQuality?.failure).toBe('insufficient_content')
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { handlePlatformMcpRequest } from '../mcp-platform'
import { MCP_LEGACY_PROTOCOL_VERSION, MCP_PROTOCOL_VERSION } from '../mcp-transport'

const calls: { url: string; init?: RequestInit }[] = []

beforeEach(() => {
  calls.length = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      if (String(url).includes('/unknown-slug/agent.json')) return new Response(JSON.stringify({ error: 'nf' }), { status: 404 })
      return new Response(JSON.stringify({ ok: true, echo: String(url) }), { status: 200 })
    }),
  )
})

const base = 'https://nexez.app'
const call = (method: string, params?: Record<string, unknown>) =>
  handlePlatformMcpRequest({ id: 1, method, params }, base, { clientIp: '1.2.3.4' })
const chatGptCall = (method: string, params?: Record<string, unknown>) =>
  handlePlatformMcpRequest(
    { id: 1, method, params },
    base,
    { clientIp: '1.2.3.4', surface: 'chatgpt' },
  )

describe('handlePlatformMcpRequest', () => {
  it('initialize → nexez:platform serverInfo', async () => {
    const r = await call('initialize')
    const result = r.result as {
      protocolVersion: string
      serverInfo: { name: string; title: string; description: string; websiteUrl: string; icons: { src: string }[] }
    }
    const info = result.serverInfo
    expect(result.protocolVersion).toBe(MCP_LEGACY_PROTOCOL_VERSION)
    expect(info.name).toBe('nexez:platform')
    expect(info.title).toBe('Nexez Agentic Commerce')
    expect(info.description).toContain('structured offers')
    expect(info.websiteUrl).toBe('https://nexez.ai/agents')
    expect(info.icons[0].src).toBe('https://nexez.ai/icon.svg')
  })

  it('negotiates a supported 2025-era protocol version', async () => {
    const response = await call('initialize', { protocolVersion: '2025-06-18' })
    expect((response.result as { protocolVersion: string }).protocolVersion).toBe('2025-06-18')
  })

  it('server/discover advertises the current stateless contract', async () => {
    const response = await handlePlatformMcpRequest(
      { id: 1, method: 'server/discover', params: {} },
      base,
      { modern: true, clientFamily: 'claude' },
    )
    expect(response.result).toMatchObject({
      resultType: 'complete',
      supportedVersions: [MCP_PROTOCOL_VERSION],
      capabilities: { tools: {}, resources: {} },
      cacheScope: 'public',
    })
  })

  it('tools/list exposes ONLY the 5 read/dry-run tools (no start_checkout / submit_negotiation)', async () => {
    const tools = ((await call('tools/list')).result as {
      tools: {
        name: string
        title: string
        annotations: { readOnlyHint: boolean; destructiveHint: boolean; openWorldHint: boolean }
      }[]
    }).tools
    const names = tools.map((tool) => tool.name)
    expect(names.sort()).toEqual(['nexez_directory', 'nexez_get_page', 'nexez_search', 'nexez_validate_checkout', 'nexez_validate_negotiation'])
    expect(names).not.toContain('nexez_start_checkout')
    expect(names).not.toContain('nexez_submit_negotiation')
    expect(tools.every((tool) => tool.title.length > 0)).toBe(true)
    expect(tools.every((tool) => tool.annotations.readOnlyHint)).toBe(true)
    expect(tools.every((tool) => tool.annotations.destructiveHint === false)).toBe(true)
    expect(tools.every((tool) => tool.annotations.openWorldHint)).toBe(true)
  })

  it.each(['platform', 'chatgpt'] as const)('documents every advertised input on the %s surface without making browse filters required', async (surface) => {
    const response = await handlePlatformMcpRequest({ id: 1, method: 'tools/list' }, base, { surface })
    const tools = (response.result as { tools: Array<{
      name: string
      inputSchema: { properties: Record<string, { description?: string }>; required?: string[] }
    }> }).tools
    for (const tool of tools) {
      for (const [name, property] of Object.entries(tool.inputSchema.properties)) {
        expect(property.description?.trim().length, `${tool.name}.${name}`).toBeGreaterThan(15)
      }
    }
    expect(tools.find((tool) => tool.name === 'nexez_directory')?.inputSchema.required ?? []).toEqual([])
    expect(tools.find((tool) => tool.name === 'nexez_search')?.inputSchema.properties.lat.description).toContain('Does not filter or rerank')
    expect(tools.find((tool) => tool.name === 'nexez_validate_negotiation')?.inputSchema.properties.requestedTerms.description).toContain('projectWeeks')
  })

  it('advertises five discovery-only tools on the ChatGPT surface', async () => {
    const tools = ((await chatGptCall('tools/list')).result as {
      tools: Array<{
        name: string
        title: string
        description: string
        inputSchema: { properties: Record<string, unknown> }
      }>
    }).tools
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'nexez_directory',
      'nexez_get_page',
      'nexez_search',
      'nexez_validate_checkout',
      'nexez_validate_negotiation',
    ])
    expect(tools.find((tool) => tool.name === 'nexez_validate_checkout')?.title).toBe('Check offer readiness')
    expect(tools.find((tool) => tool.name === 'nexez_validate_checkout')?.inputSchema.properties).not.toHaveProperty('buyerEmail')
    expect(tools.find((tool) => tool.name === 'nexez_validate_checkout')?.inputSchema.properties).not.toHaveProperty('buyerReference')
    expect(tools.find((tool) => tool.name === 'nexez_validate_negotiation')?.inputSchema.properties).not.toHaveProperty('contact')
    expect(JSON.stringify(tools)).not.toContain('agent.json URLs')
    expect(JSON.stringify(tools)).not.toContain('provider handoff')
  })

  it('does not expose MCP resources on the ChatGPT surface', async () => {
    expect((await chatGptCall('resources/list')).result).toEqual({ resources: [] })
    expect((await chatGptCall('resources/read', { uri: 'https://nexez.app/agent-pages.json' })).error?.code).toBe(-32602)
  })

  it('nexez_search forwards to agent-search with the caller IP', async () => {
    const r = await call('tools/call', {
      name: 'nexez_search',
      arguments: {
        q: 'plumber',
        limit: 5,
        verified: true,
        supports_checkout: true,
        min_trust: 70,
      },
    })
    expect(calls[0].url).toContain('/api/agent-search')
    expect(calls[0].url).toContain('q=plumber')
    expect(calls[0].url).toContain('verified=true')
    expect(calls[0].url).toContain('supports_checkout=true')
    expect(calls[0].url).toContain('min_trust=70')
    expect((calls[0].init?.headers as Record<string, string>)['x-forwarded-for']).toBe('1.2.3.4')
    expect((calls[0].init?.headers as Record<string, string>)['x-nexez-client']).toBe('platform-mcp/1.1.0')
    expect((r.result as { content: { type: string }[] }).content[0].type).toBe('text')
  })

  it('nexez_get_page requires slug and maps a 404 → -32602', async () => {
    expect((await call('tools/call', { name: 'nexez_get_page', arguments: {} })).error?.code).toBe(-32602)
    expect((await call('tools/call', { name: 'nexez_get_page', arguments: { slug: 'unknown-slug' } })).error?.code).toBe(-32602)
    const good = await call('tools/call', { name: 'nexez_get_page', arguments: { slug: 'acme' } })
    expect((good.result as { content: unknown }).content).toBeTruthy()
  })

  it('validate_checkout ALWAYS forces dryRun:true (can never be turned into a real charge)', async () => {
    await call('tools/call', { name: 'nexez_validate_checkout', arguments: { slug: 'acme', offer: 'services-0', dryRun: false } })
    expect(calls[0].url).toContain('/api/checkout')
    expect(JSON.parse(String(calls[0].init?.body)).dryRun).toBe(true)
  })

  it('routes resource-backed validation through the production hold resolver', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      if (String(url).endsWith('/api/checkout')) {
        return new Response(JSON.stringify({ code: 'reservable_resource_checkout_required' }), { status: 409 })
      }
      return new Response(JSON.stringify({ ok: true, resources: { status: 'held', holdId: 'hold-1' } }), { status: 200 })
    }))
    const result = await call('tools/call', {
      name: 'nexez_validate_checkout',
      arguments: { slug: 'dinner', offer: 'services-0', offerConfiguration: { guest_count: 12 } },
    })
    expect(calls).toHaveLength(2)
    expect(calls[1].url).toContain('/api/reservable-resources/checkout')
    expect((calls[1].init?.headers as Record<string, string>)['idempotency-key']).toMatch(/^mcp-resource:/)
    expect(JSON.parse(String(calls[1].init?.body))).toMatchObject({ dryRun: true, buyerAgent: 'Nexez MCP/other' })
    expect((result.result as any).content[0].text).toContain('"status":"held"')
  })

  it('validate_negotiation forces dryRun:true', async () => {
    await call('tools/call', { name: 'nexez_validate_negotiation', arguments: { slug: 'acme', offer: 'services-0', dryRun: false } })
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({
      dryRun: true,
      buyerAgent: 'Nexez MCP/other',
    })
  })

  it('sanitizes discovery output on the ChatGPT surface', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      return new Response(JSON.stringify({
        page: {
          name: 'Kismet Pros',
          slug: 'kismetpros',
          url: 'https://nexez.app/kismetpros',
          contact_email: 'service@example.com',
          description: 'Published details at https://example.com.',
        },
        offers: [{
          key: 'services-0',
          name: 'Routine Cleaning',
          price: 'Custom quote',
          checkout_url: 'https://example.com/book',
          provider_url: 'https://example.com/book',
          action: { method: 'POST', endpoint: 'https://nexez.app/api/checkout' },
        }],
        recommended_actions: ['Contact the seller.'],
      }), { status: 200 })
    }))

    const response = await chatGptCall('tools/call', {
      name: 'nexez_get_page',
      arguments: { slug: 'kismetpros' },
    })
    const text = (response.result as { content: Array<{ text: string }> }).content[0].text
    const body = JSON.parse(text)
    expect(JSON.stringify(body)).not.toMatch(/https?:\/\//)
    expect(JSON.stringify(body)).not.toContain('service@example.com')
    expect(JSON.stringify(body)).not.toContain('checkout_url')
    expect(JSON.stringify(body)).not.toContain('provider_url')
    expect(JSON.stringify(body)).not.toContain('recommended_actions')
    expect(body).toMatchObject({
      page: { name: 'Kismet Pros', slug: 'kismetpros' },
      offers: [{ key: 'services-0', name: 'Routine Cleaning', price: 'Custom quote' }],
      nexez_policy: {
        mode: 'discovery_and_validation_only',
        purchase_routes_returned: false,
        approval_credentials_returned: false,
        action_execution_available: false,
      },
    })
  })

  it('strips live-action inputs and outputs from ChatGPT dry-run validation', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      return new Response(JSON.stringify({
        ok: true,
        dryRun: true,
        amount: 25000,
        currency: 'usd',
        checkoutUrl: 'https://nexez.app/checkout/acme',
        actionUrl: 'https://nexez.app/api/checkout',
        approvalToken: 'approval-secret',
        approvalExpiresAt: '2026-09-01T12:00:00.000Z',
        mcpHandoff: { method: 'POST', body: { approvalToken: 'approval-secret' } },
      }), { status: 200 })
    }))

    const response = await chatGptCall('tools/call', {
      name: 'nexez_validate_checkout',
      arguments: {
        slug: 'acme',
        offer: 'services-0',
        buyerEmail: 'buyer@example.com',
        buyerReference: 'buyer-order-1',
        contact: 'buyer@example.com',
        approvalToken: 'caller-token',
        actionUrl: 'https://nexez.app/api/checkout',
        dryRun: false,
      },
    })

    const requestBody = JSON.parse(String(calls[0].init?.body))
    expect(requestBody).toMatchObject({
      slug: 'acme',
      offer: 'services-0',
      dryRun: true,
      buyerAgent: 'Nexez MCP/other',
    })
    expect(requestBody).not.toHaveProperty('buyerEmail')
    expect(requestBody).not.toHaveProperty('buyerReference')
    expect(requestBody).not.toHaveProperty('contact')
    expect(requestBody).not.toHaveProperty('approvalToken')
    expect(requestBody).not.toHaveProperty('actionUrl')

    const text = (response.result as { content: Array<{ text: string }> }).content[0].text
    const result = JSON.parse(text)
    expect(JSON.stringify(result)).not.toMatch(/https?:\/\//)
    expect(JSON.stringify(result)).not.toContain('approval-secret')
    expect(JSON.stringify(result)).not.toContain('mcpHandoff')
    expect(JSON.stringify(result)).not.toContain('checkoutUrl')
    expect(result).toMatchObject({
      ok: true,
      dryRun: true,
      amount: 25000,
      currency: 'usd',
      nexez_policy: {
        mode: 'discovery_and_validation_only',
        action_execution_available: false,
      },
    })
  })

  it('returns an exact buyer-approved handoff without submitting it', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      return new Response(JSON.stringify({
        ok: true,
        dryRun: true,
        approvalToken: 'approval-token',
        approvalExpiresAt: '2026-08-25T01:00:00.000Z',
      }), { status: 200 })
    }))
    const response = await handlePlatformMcpRequest(
      {
        id: 1,
        method: 'tools/call',
        params: {
          name: 'nexez_validate_checkout',
          arguments: { slug: 'acme', offer: 'services-0' },
        },
      },
      base,
      {
        modern: true,
        clientFamily: 'claude',
        buyerAgent: 'Nexez MCP/claude/b6bbf40d-79cb-4e3b-9065-88ae5d52687e',
        attributionId: 'b6bbf40d-79cb-4e3b-9065-88ae5d52687e',
      },
    )
    const text = (response.result as { content: Array<{ text: string }>; resultType: string }).content[0].text
    const body = JSON.parse(text)
    expect(body.mcpHandoff).toMatchObject({
      kind: 'checkout',
      source: 'platform_mcp',
      actionUrl: 'https://nexez.test/api/checkout',
      requiresBuyerApproval: true,
      body: {
        slug: 'acme',
        offer: 'services-0',
        dryRun: false,
        approvalToken: 'approval-token',
        buyerAgent: 'Nexez MCP/claude/b6bbf40d-79cb-4e3b-9065-88ae5d52687e',
      },
    })
    expect((response.result as { resultType: string }).resultType).toBe('complete')
    expect(calls).toHaveLength(1)
    expect(JSON.parse(String(calls[0].init?.body)).dryRun).toBe(true)
  })

  it('unknown tool → -32602, unknown method → -32601', async () => {
    expect((await call('tools/call', { name: 'nope' })).error?.code).toBe(-32602)
    expect((await call('bogus')).error?.code).toBe(-32601)
  })
})

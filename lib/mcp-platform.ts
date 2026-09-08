// Canonical PLATFORM MCP endpoint (nexez.app/mcp): a JSON-RPC 2.0 facade over
// Nexez's existing PUBLIC REST surface, so an MCP-native agent can discover and
// evaluate the whole cross-merchant catalog from one stable URL. It is a thin
// server-side mirror of the OpenClaw plugin: each tool forwards to the real
// public endpoint (no logic duplicated → no drift), forwarding the caller's IP
// so those endpoints' own rate limits key correctly.
//
// v1 exposes only READ + DRY-RUN tools (all already unauthenticated + safe). The
// mutating/charging tools (start_checkout, submit_negotiation) are deliberately
// NOT here - they need a human-approval gate an anonymous endpoint can't enforce;
// the two validate_* tools always force dryRun:true so they never charge or write.
import { MCP_PROTOCOL_VERSION, negotiateLegacyMcpProtocolVersion } from './mcp-transport'
import type { McpClientFamily } from './mcp-demand'
import { sanitizeChatGptToolArguments, sanitizeChatGptToolResult } from './chatgpt-mcp'
import { agentRuntimeUrl, marketingUrl } from './site'

export type PlatformMcpSurface = 'platform' | 'chatgpt'

type JsonRpcRequest = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> }
type JsonRpcResponse = {
  jsonrpc: '2.0'
  id: string | number | null
  result?: unknown
  error?: { code: number; message: string }
}

const ok = (id: string | number | null, result: unknown, modern = false): JsonRpcResponse => ({
  jsonrpc: '2.0',
  id,
  result: modern && result && typeof result === 'object' && !Array.isArray(result)
    ? { ...result as Record<string, unknown>, resultType: 'complete' }
    : result,
})
const err = (id: string | number | null, code: number, message: string): JsonRpcResponse => ({ jsonrpc: '2.0', id, error: { code, message } })
const textResult = (id: string | number | null, obj: unknown, modern = false, isError = false): JsonRpcResponse =>
  ok(id, {
    content: [{ type: 'text', text: JSON.stringify(obj) }],
    ...(isError ? { isError: true } : {}),
  }, modern)

const TOOLS = [
  {
    name: 'nexez_search',
    title: 'Search Nexez offers',
    description: 'Find services or products for a specific buyer request. Returns JSON text with ranked results, structured offers, listing slugs, agent.json URLs, and applied filters. Use nexez_directory for broad browsing, then nexez_get_page to inspect an exact offer before a dry run.',
    annotations: {
      title: 'Search Nexez offers',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'What the buyer is looking for' },
        location: { type: 'string', description: 'Optional city/region filter' },
        limit: { type: 'number', description: 'Maximum results; defaults to 10 and is rounded down and clamped to 1-50.' },
        lat: { type: 'number', description: 'Optional latitude context metadata. Does not filter or rerank results; use location for geographic filtering.' },
        lng: { type: 'number', description: 'Optional longitude context metadata. Does not filter or rerank results; use location for geographic filtering.' },
        category: { type: 'string', enum: ['all', 'professional', 'consumer'], description: 'Marketplace category; omit or use all to include both professional and consumer listings.' },
        industry: { type: 'string', description: 'Case-insensitive substring filter on the published industry, for example plumbing.' },
        min_readiness: { type: 'integer', minimum: 0, maximum: 100, description: 'Minimum listing readiness score (0-100); omit for no readiness threshold.' },
        min_trust: { type: 'integer', minimum: 0, maximum: 100, description: 'Minimum marketplace trust score (0-100); omit for no trust threshold. Not a guarantee of seller performance.' },
        verified: { type: 'boolean', description: 'Filter by seller verification signal: true requires a signal, false requires its absence; omit to include both.' },
        nexez_checkout_ready: { type: 'boolean', description: 'Owner payout state confirms Nexez-settled checkout readiness' },
        supports_checkout: { type: 'boolean', description: 'Deprecated compatibility filter: any actionable offer or provider handoff' },
        supports_negotiation: { type: 'boolean', description: 'Filter by negotiation availability: true for eligible listings, false for non-negotiable listings; omit to include both.' },
        price_band: { type: 'string', enum: ['free', 'under_100', '100_500', '500_2000', '2000_plus', 'custom'], description: 'Filter by the listing marketplace price band. Inspect the exact offer for its price and currency; this is not a checkout quote.' },
      },
      required: ['q'],
    },
  },
  {
    name: 'nexez_directory',
    title: 'Browse the Nexez directory',
    description: 'Browse published Nexez listings without requiring a buyer query. All filters are optional. Returns directory JSON text with listing summaries and readiness information. Use nexez_search when you need ranked matches for a specific buyer request.',
    annotations: {
      title: 'Browse the Nexez directory',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: ['all', 'professional', 'consumer'], description: 'Marketplace category; defaults to all.' },
        q: { type: 'string', description: 'Optional case-insensitive text filter across listing name, description, audience, and location.' },
        min_readiness: { type: 'number', description: 'Minimum listing readiness score, normally 0-100; defaults to 0 (no threshold).' },
        location: { type: 'string', description: 'Optional city or region filter matched against published location and service-area information.' },
      },
    },
  },
  {
    name: 'nexez_get_page',
    title: 'Inspect a Nexez listing',
    description: "Fetch one listing's structured agent manifest as JSON text, including seller profile, offers, configuration requirements, and published actions. Use a slug returned by search or directory; inspect exact offer identifiers and requirements before validation.",
    annotations: {
      title: 'Inspect a Nexez listing',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: { slug: { type: 'string', description: 'Exact published listing slug returned by nexez_search or nexez_directory, not a full URL.' } },
      required: ['slug'],
    },
  },
  {
    name: 'nexez_validate_checkout',
    title: 'Validate Nexez checkout',
    description: 'Dry-run checkout for an exact published offer. Returns validation JSON text with offer readiness or errors and missing requirements. Inspect the offer with nexez_get_page first. Never charges or creates an order; a successful check is not a completed purchase.',
    annotations: {
      title: 'Validate Nexez checkout',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'Exact published listing slug returned by discovery, not a full URL.' },
        offer: { type: 'string', description: 'Exact offer key from the listing manifest, for example services-0 or products-1. Do not invent an index.' },
        query: { type: 'string', description: 'Optional buyer context' },
        offerConfiguration: { type: 'object', description: 'Buyer-selected configuration values keyed exactly as defined by the target offer configuration schema from nexez_get_page. Supply required fields for that offer; do not invent values or use a generic schema.' },
        buyerEmail: { type: 'string', description: 'Optional buyer-provided email for checkout context. Omit when unnecessary; never invent personal details.' },
        buyerReference: { type: 'string', description: 'Optional buyer-provided reference for checkout context; omit if none was supplied.' },
      },
      required: ['slug', 'offer'],
    },
  },
  {
    name: 'nexez_validate_negotiation',
    title: 'Validate Nexez negotiation',
    description: 'Evaluate proposed terms against an exact offer and the seller\'s published rules in a forced dry run. Returns rules-evaluation JSON text or validation errors. Inspect the offer first and supply its required terms. Never submits a proposal, contacts a seller, or writes a negotiation.',
    annotations: {
      title: 'Validate Nexez negotiation',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'Exact published listing slug returned by discovery, not a full URL.' },
        offer: { type: 'string', description: 'Exact offer key from the listing manifest, for example services-0 or products-1.' },
        query: { type: 'string', description: 'Buyer request describing the desired work or product and relevant context.' },
        budget: { type: 'string', description: 'Buyer-proposed budget or range as text, using the offer currency, for example USD 500. Do not invent a budget.' },
        timeline: { type: 'string', description: 'Buyer-proposed delivery timing as text, for example within 4 weeks. Use requestedTerms.projectWeeks for a numeric duration rule.' },
        requestedTerms: { type: 'object', description: 'Structured buyer proposal. Published seller rules may require scope (text or list of deliverables), revisionCount (whole number 0-1000), and projectWeeks (whole number 1-1000). Example: {"scope":"Logo and brand guide","revisionCount":2,"projectWeeks":4}. Inspect the offer rules; omit unknown terms rather than inventing them.' },
        contact: { type: 'string', description: 'Optional buyer contact route.' },
      },
      required: ['slug', 'offer'],
    },
  },
]

const CHATGPT_TOOL_COPY: Record<string, { title: string; description: string }> = {
  nexez_search: {
    title: 'Search Nexez offers',
    description: 'Search public Nexez listings for products or services matching a request. Returns ranked published facts without purchase, booking, seller-contact, or action routes.',
  },
  nexez_directory: {
    title: 'Browse the Nexez directory',
    description: 'Browse public Nexez listings by category, query, readiness, or location. Returns discovery facts without purchase, booking, seller-contact, or action routes.',
  },
  nexez_get_page: {
    title: 'Inspect published offer facts',
    description: 'Fetch one public listing and its structured offer facts by slug. Purchase, booking, contact, and executable action details are removed.',
  },
  nexez_validate_checkout: {
    title: 'Check offer readiness',
    description: 'Run a forced dry-run check for one exact offer. Reports current price, currency, requirements, and readiness without charging, creating an order, or returning a purchase route.',
  },
  nexez_validate_negotiation: {
    title: 'Check proposed terms',
    description: 'Evaluate proposed budget, timeline, or terms against published seller rules in a forced dry run. Never submits terms, contacts a seller, or returns a submission route.',
  },
}

const CHATGPT_TOOLS = TOOLS.map((tool) => {
  const copy = CHATGPT_TOOL_COPY[tool.name]
  const properties = { ...tool.inputSchema.properties } as Record<string, unknown>
  if (tool.name === 'nexez_search') {
    delete properties.nexez_checkout_ready
    delete properties.supports_checkout
  }
  if (tool.name === 'nexez_validate_checkout') {
    delete properties.buyerEmail
    delete properties.buyerReference
  }
  if (tool.name === 'nexez_validate_negotiation') delete properties.contact

  return {
    ...tool,
    title: copy.title,
    description: copy.description,
    annotations: { ...tool.annotations, title: copy.title },
    inputSchema: { ...tool.inputSchema, properties },
  }
})

function platformResources(baseUrl: string) {
  return [
    { uri: `${baseUrl}/agent-pages.json`, name: 'Nexez agent index', description: 'Every published agent-ready listing.', mimeType: 'application/json' },
    { uri: `${baseUrl}/.well-known/mcp.json`, name: 'MCP discovery catalog', description: 'Per-listing + per-storefront MCP endpoints.', mimeType: 'application/json' },
    { uri: marketingUrl('/api/directory'), name: 'Nexez directory', description: 'Cross-merchant directory.', mimeType: 'application/json' },
  ]
}

async function fetchJson(url: string, init: RequestInit | undefined, clientIp: string | undefined): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    'x-nexez-client': 'platform-mcp/1.1.0',
    ...(init?.headers as Record<string, string> | undefined),
  }
  // Forward the real caller IP so the underlying endpoint's rate limit keys on the
  // buyer-agent, not this server (Vercel would otherwise share one bucket).
  if (clientIp) headers['x-forwarded-for'] = clientIp
  const res = await fetch(url, { ...init, headers })
  const body = await res.json().catch(() => ({}))
  return { status: res.status, body }
}

/**
 * Handle one JSON-RPC MCP request against the platform surface. tools/call is
 * async (it forwards to the public REST endpoints); everything else is immediate.
 */
export async function handlePlatformMcpRequest(
  req: JsonRpcRequest,
  baseUrl: string,
  opts: {
    clientIp?: string
    modern?: boolean
    clientFamily?: McpClientFamily
    buyerAgent?: string
    attributionId?: string
    surface?: PlatformMcpSurface
  } = {},
): Promise<JsonRpcResponse> {
  const id = req.id ?? null
  const method = req.method || ''
  const modern = opts.modern === true
  const chatGpt = opts.surface === 'chatgpt'

  switch (method) {
    case 'server/discover':
      return ok(id, {
        supportedVersions: [MCP_PROTOCOL_VERSION],
        capabilities: chatGpt ? { tools: {} } : { tools: {}, resources: {} },
        _meta: {
          'io.modelcontextprotocol/serverInfo': platformServerInfo(opts.surface),
        },
        instructions: chatGpt
          ? 'Search and compare published Nexez offers or evaluate an exact offer in a forced dry run. This surface returns no purchase, booking, contact, approval, or submission route.'
          : 'Search Nexez merchants, inspect published offers, and validate an exact checkout or negotiation before a buyer-approved handoff.',
        ttlMs: 3_600_000,
        cacheScope: 'public',
      }, true)
    case 'initialize':
      if (modern) return err(id, -32601, 'Method not found: initialize')
      return ok(id, {
        protocolVersion: negotiateLegacyMcpProtocolVersion(req.params?.protocolVersion),
        capabilities: chatGpt ? { tools: {} } : { tools: {}, resources: {} },
        serverInfo: platformServerInfo(opts.surface),
      })
    case 'ping':
      return ok(id, {}, modern)
    case 'tools/list':
      return ok(id, {
        tools: chatGpt ? CHATGPT_TOOLS : TOOLS,
        ...(modern ? { ttlMs: 3_600_000, cacheScope: 'public' } : {}),
      }, modern)
    case 'resources/list':
      return ok(id, {
        resources: chatGpt ? [] : platformResources(baseUrl),
        ...(modern ? { ttlMs: 300_000, cacheScope: 'public' } : {}),
      }, modern)
    case 'resources/read': {
      const uri = String(req.params?.uri || '')
      if (chatGpt) return err(id, -32602, 'Resources are not exposed on the ChatGPT discovery surface.')
      const match = platformResources(baseUrl).find((r) => r.uri === uri)
      if (!match) return err(id, -32602, `Unknown resource: ${uri}`)
      return ok(id, {
        contents: [{ uri, mimeType: match.mimeType, text: `See ${uri}` }],
        ...(modern ? { ttlMs: 300_000, cacheScope: 'public' } : {}),
      }, modern)
    }
    case 'tools/call': {
      const name = String(req.params?.name || '')
      if (req.params?.arguments !== undefined && !isRecord(req.params.arguments)) {
        return err(id, -32602, 'Tool arguments must be an object.')
      }
      const rawArgs = isRecord(req.params?.arguments) ? req.params.arguments : {}
      const args = chatGpt ? sanitizeChatGptToolArguments(name, rawArgs) : rawArgs
      const output = (value: unknown) => chatGpt ? sanitizeChatGptToolResult(name, value) : value
      const ip = opts.clientIp
      try {
        if (name === 'nexez_search') {
          if (typeof args.q !== 'string' || !args.q.trim()) return err(id, -32602, 'q is required')
          const u = new URL(marketingUrl('/api/agent-search'))
          for (const k of [
            'q',
            'location',
            'limit',
            'lat',
            'lng',
            'category',
            'industry',
            'min_readiness',
            'min_trust',
            'verified',
            'nexez_checkout_ready',
            'supports_checkout',
            'supports_negotiation',
            'price_band',
          ]) if (args[k] != null) u.searchParams.set(k, String(args[k]))
          const result = await fetchJson(u.toString(), undefined, ip)
          return textResult(id, output(result.body), modern, result.status >= 400)
        }
        if (name === 'nexez_directory') {
          const u = new URL(marketingUrl('/api/directory'))
          for (const k of ['category', 'q', 'min_readiness', 'location', 'lat', 'lng']) if (args[k] != null) u.searchParams.set(k, String(args[k]))
          const result = await fetchJson(u.toString(), undefined, ip)
          return textResult(id, output(result.body), modern, result.status >= 400)
        }
        if (name === 'nexez_get_page') {
          const slug = String(args.slug || '')
          if (!slug) return err(id, -32602, 'slug is required')
          const { status, body } = await fetchJson(agentRuntimeUrl(`/${encodeURIComponent(slug)}/agent.json`), undefined, ip)
          if (status === 404) return err(id, -32602, `Unknown listing: ${slug}`)
          return textResult(id, output(body), modern, status >= 400)
        }
        if (name === 'nexez_validate_checkout') {
          if (typeof args.slug !== 'string' || !args.slug || typeof args.offer !== 'string' || !args.offer) {
            return err(id, -32602, 'slug and offer are required')
          }
          // dryRun forced last → a caller can NEVER turn this into a real charge.
          const buyerAgent = opts.buyerAgent || 'Nexez MCP/other'
          const initial = await fetchJson(
            agentRuntimeUrl('/api/checkout'),
            { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...args, dryRun: true, buyerAgent }) },
            ip,
          )
          const initialBody = initial.body && typeof initial.body === 'object' && !Array.isArray(initial.body)
            ? initial.body as Record<string, unknown>
            : {}
          if (initial.status === 409 && initialBody.code === 'reservable_resource_checkout_required') {
            const resource = await fetchJson(
              agentRuntimeUrl('/api/reservable-resources/checkout'),
              {
                method: 'POST',
                headers: {
                  'content-type': 'application/json',
                  'idempotency-key': `mcp-resource:${globalThis.crypto.randomUUID()}`,
                },
                body: JSON.stringify({ ...args, dryRun: true, buyerAgent }),
              },
              ip,
            )
            return textResult(
              id,
              chatGpt
                ? output(resource.body)
                : withMcpHandoff(resource.body, 'checkout', args, buyerAgent, opts.attributionId),
              modern,
              resource.status >= 400,
            )
          }
          return textResult(
            id,
            chatGpt
              ? output(initial.body)
              : withMcpHandoff(initial.body, 'checkout', args, buyerAgent, opts.attributionId),
            modern,
            initial.status >= 400,
          )
        }
        if (name === 'nexez_validate_negotiation') {
          if (typeof args.slug !== 'string' || !args.slug || typeof args.offer !== 'string' || !args.offer) {
            return err(id, -32602, 'slug and offer are required')
          }
          const buyerAgent = opts.buyerAgent || 'Nexez MCP/other'
          const { body, status } = await fetchJson(
            agentRuntimeUrl('/api/negotiations'),
            { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...args, dryRun: true, buyerAgent }) },
            ip,
          )
          return textResult(
            id,
            chatGpt
              ? output(body)
              : withMcpHandoff(body, 'negotiation', args, buyerAgent, opts.attributionId),
            modern,
            status >= 400,
          )
        }
        return err(id, -32602, `Unknown tool: ${name}`)
      } catch {
        return err(id, -32603, 'Tool execution failed.')
      }
    }
    default:
      return err(id, -32601, `Method not found: ${method}`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function platformServerInfo(surface: PlatformMcpSurface = 'platform') {
  if (surface === 'chatgpt') {
    return {
      name: 'nexez:buyer-chatgpt',
      title: 'Nexez Buyer',
      version: '0.1.0',
      websiteUrl: 'https://nexez.ai/agents',
      description: 'Discover, compare, and dry-run validate published offer facts without purchase or seller-contact routes.',
      icons: [{ src: 'https://nexez.ai/icon.svg', mimeType: 'image/svg+xml', sizes: ['any'] }],
    }
  }
  return {
    name: 'nexez:platform',
    title: 'Nexez Agentic Commerce',
    version: '1.1.0',
    websiteUrl: 'https://nexez.ai/agents',
    description: 'Search merchants, inspect structured offers, and validate checkout or negotiation before buying.',
    icons: [{ src: 'https://nexez.ai/icon.svg', mimeType: 'image/svg+xml', sizes: ['any'] }],
  }
}

function withMcpHandoff(
  value: unknown,
  kind: 'checkout' | 'negotiation',
  args: Record<string, unknown>,
  buyerAgent: string,
  attributionId: string | undefined,
): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const body = value as Record<string, unknown>
  const approvalToken = typeof body.approvalToken === 'string' ? body.approvalToken : null
  if (body.ok !== true || !approvalToken || !attributionId) return value

  const fallbackUrl = kind === 'checkout'
    ? agentRuntimeUrl('/api/checkout')
    : agentRuntimeUrl('/api/negotiations')
  const actionUrl = typeof body.actionUrl === 'string' && body.actionUrl
    ? body.actionUrl
    : fallbackUrl
  const finalBody = {
    ...args,
    buyerAgent,
    dryRun: false,
    approvalToken,
  }

  return {
    ...body,
    mcpHandoff: {
      kind,
      source: 'platform_mcp',
      attributionId,
      actionUrl,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'Generate a unique 16 to 255 character key for the buyer-approved action.',
      },
      body: finalBody,
      requiresBuyerApproval: true,
      note: 'Nexez validated this exact action but did not submit it. Use the approval token before it expires only after the buyer approves.',
    },
  }
}

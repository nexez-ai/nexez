export const STRIPE_REFUND_WEBHOOK_EVENTS = [
  'charge.refunded',
  'refund.created',
  'refund.updated',
  'refund.failed',
] as const

export type StripeWebhookEndpointRole = 'account' | 'connected-account'

export type StripeWebhookEndpointInput = {
  id?: unknown
  url?: unknown
  status?: unknown
  enabled_events?: unknown
  application?: unknown
}

export type StripeWebhookEndpointReadiness = {
  matchingEndpointCount: number
  endpointsEnabled: boolean | null
  endpointRolesCovered: boolean | null
  refundEventsCovered: boolean | null
  missingEndpointRoles: StripeWebhookEndpointRole[]
  missingRefundEvents: string[]
}

type ReadinessOptions = {
  allowedHosts: string[]
  expectedRoles: {
    account: boolean
    connectedAccount: boolean
  }
  webhookPath?: string
}

type StripeWebhookEndpointFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

type StripeWebhookEndpointListOptions = {
  fetchImpl?: StripeWebhookEndpointFetch
  timeoutMs?: number
  maxPages?: number
}

const STRIPE_WEBHOOK_ENDPOINTS_URL = 'https://api.stripe.com/v1/webhook_endpoints'
const STRIPE_WEBHOOK_ENDPOINT_PAGE_LIMIT = 100
const STRIPE_WEBHOOK_ENDPOINT_MAX_PAGES = 10

/**
 * Reads every classic Stripe webhook endpoint page within one bounded timeout.
 * Returning null after the page cap or on malformed pagination keeps an unseen
 * endpoint from being treated as healthy.
 */
export async function listStripeWebhookEndpoints(
  secretKey: string,
  options: StripeWebhookEndpointListOptions = {},
): Promise<StripeWebhookEndpointInput[] | null> {
  if (!secretKey) return null
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? 5_000
  const maxPages = options.maxPages ?? STRIPE_WEBHOOK_ENDPOINT_MAX_PAGES
  if (!Number.isSafeInteger(maxPages) || maxPages < 1) return null

  const endpoints: StripeWebhookEndpointInput[] = []
  const cursors = new Set<string>()
  const signal = AbortSignal.timeout(timeoutMs)
  let startingAfter: string | null = null

  for (let page = 0; page < maxPages; page += 1) {
    const url = new URL(STRIPE_WEBHOOK_ENDPOINTS_URL)
    url.searchParams.set('limit', String(STRIPE_WEBHOOK_ENDPOINT_PAGE_LIMIT))
    if (startingAfter) url.searchParams.set('starting_after', startingAfter)

    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${secretKey}` },
      cache: 'no-store',
      signal,
    })
    if (!response.ok) return null

    const body: unknown = await response.json()
    if (!isStripeWebhookEndpointPage(body)) return null
    endpoints.push(...body.data)
    if (!body.has_more) return endpoints

    const nextCursor = body.data.at(-1)?.id
    if (typeof nextCursor !== 'string' || !nextCursor || cursors.has(nextCursor)) return null
    cursors.add(nextCursor)
    startingAfter = nextCursor
  }

  return null
}

/**
 * Evaluates Stripe's redacted endpoint list without relying on endpoint IDs or
 * signing secrets. Stripe identifies a connected-account destination through
 * its associated Connect application; account destinations have no application.
 */
export function evaluateStripeWebhookEndpointReadiness(
  endpoints: StripeWebhookEndpointInput[],
  options: ReadinessOptions,
): StripeWebhookEndpointReadiness {
  const webhookPath = options.webhookPath ?? '/api/webhooks/stripe'
  const matching = endpoints.filter((endpoint) => isExpectedWebhookUrl(
    endpoint.url,
    options.allowedHosts,
    webhookPath,
  ))

  if (matching.length === 0) {
    return {
      matchingEndpointCount: 0,
      endpointsEnabled: null,
      endpointRolesCovered: null,
      refundEventsCovered: null,
      missingEndpointRoles: [],
      missingRefundEvents: [],
    }
  }

  const hasAccountEndpoint = matching.some((endpoint) => endpoint.application === null)
  const hasConnectedAccountEndpoint = matching.some(
    (endpoint) => typeof endpoint.application === 'string' && endpoint.application.length > 0,
  )
  const hasUnknownRole = matching.some(
    (endpoint) => endpoint.application !== null && typeof endpoint.application !== 'string',
  )
  const missingEndpointRoles: StripeWebhookEndpointRole[] = []
  if (options.expectedRoles.account && !hasAccountEndpoint) missingEndpointRoles.push('account')
  if (options.expectedRoles.connectedAccount && !hasConnectedAccountEndpoint) {
    missingEndpointRoles.push('connected-account')
  }
  const endpointRolesCovered = missingEndpointRoles.length === 0
    ? true
    : hasUnknownRole
      ? null
      : false

  const eventLists = matching.map((endpoint) => (
    Array.isArray(endpoint.enabled_events)
      && endpoint.enabled_events.every((event) => typeof event === 'string')
      ? endpoint.enabled_events as string[]
      : null
  ))
  const eventListsKnown = eventLists.every((events): events is string[] => events !== null)
  const missingRefundEvents = eventListsKnown
    ? STRIPE_REFUND_WEBHOOK_EVENTS.filter((requiredEvent) => eventLists.some(
      (events) => !events.includes('*') && !events.includes(requiredEvent),
    ))
    : []

  return {
    matchingEndpointCount: matching.length,
    endpointsEnabled: matching.every((endpoint) => endpoint.status === 'enabled'),
    endpointRolesCovered,
    refundEventsCovered: eventListsKnown ? missingRefundEvents.length === 0 : null,
    missingEndpointRoles,
    missingRefundEvents,
  }
}

function isExpectedWebhookUrl(value: unknown, allowedHosts: string[], webhookPath: string): boolean {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    const hosts = new Set(allowedHosts.map((host) => host.toLowerCase()))
    return url.protocol === 'https:'
      && url.username === ''
      && url.password === ''
      && url.port === ''
      && hosts.has(url.hostname.toLowerCase())
      && url.pathname === webhookPath
      && url.search === ''
      && url.hash === ''
  } catch {
    return false
  }
}

function isStripeWebhookEndpointPage(value: unknown): value is {
  data: StripeWebhookEndpointInput[]
  has_more: boolean
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const page = value as Record<string, unknown>
  return Array.isArray(page.data)
    && page.data.every((endpoint) => Boolean(endpoint)
      && typeof endpoint === 'object'
      && !Array.isArray(endpoint))
    && typeof page.has_more === 'boolean'
}

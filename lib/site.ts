// Host/canonical helpers for the nexez.ai marketing/app split and the nexez.app
// public agent runtime.
//
// One Next.js app serves both domains; the proxy middleware canonicalizes each
// route to its host. Marketing/discovery lives on nexez.ai, the authenticated
// product lives on app.nexez.ai, and public agent pages/artifacts live on
// nexez.app. Pure + side-effect free so it is unit-testable and safe to import
// from the edge middleware.

function hostOf(url: string | undefined | null, fallback: string): string {
  if (!url) return fallback
  try {
    return new URL(url).host.toLowerCase()
  } catch {
    return (url.replace(/^https?:\/\//, '').split('/')[0] || fallback).toLowerCase()
  }
}

/** The marketing host. Defaults to nexez.ai so the split works even without the env. */
export const MARKETING_HOST = hostOf(process.env.NEXT_PUBLIC_MARKETING_URL, 'nexez.ai')
/** The authenticated app host. */
export const APP_HOST = hostOf(process.env.NEXT_PUBLIC_APP_URL, 'app.nexez.ai')
/** The isolated platform administration host. */
export const ADMIN_HOST = hostOf(process.env.NEXT_PUBLIC_ADMIN_URL, 'admin.nexez.ai')
/** The public, crawlable agent-page runtime host. */
export const AGENT_RUNTIME_HOST = hostOf(
  process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL ?? process.env.NEXT_PUBLIC_SITE_URL,
  'nexez.app',
)

// Routes that belong on the marketing host (nexez.ai): the exact homepage plus a
// set of discovery/education prefixes.
const MARKETING_PREFIXES = [
  '/agents',
  '/agent-readiness',
  '/compare',
  '/developers',
  '/enterprise',
  '/examples',
  '/how-it-works',
  '/integrations',
  '/pricing',
  '/privacy',
  '/scan',
  '/security',
  '/sms-notifications',
  '/terms',
  '/design',
  '/discovery',
  '/leaderboard',
  '/simulator',
  '/support',
  '/use-cases',
  '/learn', // guides + content hub
  '/tools', // free lead-magnet tools (llms.txt generator, …)
  '/blog', // future content
  '/docs', // future docs
] as const

// Discovery/community surfaces that exist in BOTH contexts: marketing chrome for
// anonymous visitors (nexez.ai) and the in-app dashboard chrome for signed-in
// users (app host). A subset of MARKETING_PREFIXES - the proxy keeps a signed-in
// visitor on the app host for these, and PlatformFrame picks the matching shell.
const DUAL_PREFIXES = ['/discovery', '/leaderboard', '/simulator', '/support'] as const

const ADMIN_PREFIXES = ['/admin'] as const
const ADMIN_API_PREFIXES = ['/api/admin'] as const
const APP_PREFIXES = ['/dashboard', '/console', '/create', '/login', '/auth', '/onboard', '/invite', '/nexxi', '/team', '/shopify'] as const

const MARKETING_API_PREFIXES = [
  '/api/directory',
  '/api/public-simulate',
  '/api/scan',
  // The public llms.txt generator belongs to the marketing host. Do not claim
  // the broader /api/tools prefix here: the authenticated website importer is
  // called same-origin from /create on the app host and must retain its session.
  '/api/tools/llms-txt',
  '/api/simulate-llm',
  '/api/simulate-url',
  '/api/support',
] as const

const APP_API_PREFIXES = [
  '/api/account',
  '/api/ai',
  '/api/analytics',
  '/api/analyze-competitor',
  '/api/auth',
  '/api/billing',
  '/api/crawlability',
  '/api/custom-domain',
  '/api/dashboard',
  '/api/integrations',
  '/api/growth-invites',
  // Owner-only negotiation actions are called from the dashboard (app host) where
  // the session cookie lives - NOT by agents. They must resolve to APP_HOST even
  // though they sit under /api/negotiations (an agent-runtime prefix); listed here
  // because the app check runs before the agent-runtime check in canonicalHostFor.
  // (The agent/buyer-facing /api/negotiations, /pay, /status stay on the runtime.)
  '/api/negotiations/escrow',
  '/api/negotiations/transition',
  // Readiness is an owner action authenticated by the app-host session. Keep this
  // more-specific prefix ahead of the public staged-settlement runtime prefix.
  '/api/staged-settlements/agreements',
  '/api/onboarding',
  '/api/organizations',
  '/api/pages',
  '/api/payment-method',
  '/api/readiness',
  '/api/settings',
  // Shopify Admin embeds the app at /shopify and App Bridge authenticates its
  // same-origin /api/shopify requests. Both surfaces must stay on APP_HOST;
  // redirecting the frame to the agent runtime prevents App Bridge from issuing
  // a session token and leaves the embedded app waiting indefinitely.
  '/api/shopify',
  '/api/subscription',
  '/api/test-outbound',
  '/api/tools',
  '/api/trust-report',
  '/api/usage',
  '/api/verify-custom-domain',
  // The Shopify app is configured (OAuth, App Proxy, webhooks) entirely on the app
  // host, so Shopify's webhook deliveries must resolve to APP_HOST - otherwise the
  // canonical /api/webhooks prefix (agent runtime) 308s them, and Shopify does NOT
  // follow redirects (mandatory app/uninstalled + GDPR webhooks would fail). Listed
  // here so the app check wins over the /api/webhooks agent-runtime prefix; the
  // Stripe + other /api/webhooks stay on the runtime host.
  '/api/webhooks/shopify',
] as const

// `/orders` is the public buyer order portal - buyer-facing, cookie-isolated, lives
// on the agent runtime next to `/checkout` (where the buyer already is).
// `/acp` + `/ucp` = the OpenAI ACP + Google UCP product feeds (agent-ingested flat
// files); they belong on the agent runtime next to /checkout, canonical on nexez.app.
const AGENT_RUNTIME_PREFIXES = ['/checkout', '/negotiate', '/orders', '/store', '/acp', '/ucp', '/nexxi', '/.well-known'] as const

const AGENT_RUNTIME_API_PREFIXES = [
  '/api/agent-search',
  // ACP + UCP agentic-commerce protocol endpoints (merchant-hosted checkout sessions,
  // called by OpenAI/Google) live on the agent runtime alongside /api/checkout.
  '/api/acp',
  '/api/ucp',
  '/api/checkout',
  '/api/reservable-resources',
  // Buyer and agent staged-settlement creation, status, and checkout are public,
  // bearer-gated commerce surfaces. The owner readiness route is pinned above.
  '/api/staged-settlements',
  '/api/cron',
  '/api/negotiations',
  // The buyer-portal recourse API. Deliberately NOT `/api/orders` - that prefix
  // holds the OWNER refund action (/api/orders/refund), which must stay on the app
  // host with the owner session (see APP_API_PREFIXES); routing it here would 308 it
  // cross-origin. Buyer (token-gated) routes get their own namespace.
  '/api/order-portal',
  '/api/v1',
  '/api/webhooks',
] as const

const AGENT_RUNTIME_EXACT = new Set(['/agent-pages.json', '/llms.txt', '/openapi.json', '/widget.js'])

// Paths that must be served on BOTH hosts (each domain has its own copy) and
// therefore must NOT be canonical-redirected - otherwise e.g. the marketing
// sitemap/robots on nexez.ai would bounce to nexez.app.
const HOST_NEUTRAL = new Set(['/sitemap.xml', '/robots.txt'])

// Public, stateless API routes that BACK dual surfaces (the simulator, support,
// and discovery click-tracking). A dual page renders on the marketing host for
// anonymous visitors and on the app host for signed-in ones, so the APIs its
// client code calls must be reachable SAME-ORIGIN on both. Canonical-redirecting
// them (to the marketing host) breaks the signed-in/app-host case two ways: the
// cross-domain hop is blocked by CORS, and for the session-bearing support routes
// it also drops the auth cookie (different registrable domain). So - like
// sitemap/robots - these skip the canonical-host redirect and are served on
// whichever first-party host requests them. They remain marketing-canonical for
// SEO/link purposes (see canonicalHostFor); this only suppresses the redirect.
const HOST_NEUTRAL_API_PREFIXES = [
  // Agent Lab is a dual surface: anonymous runs originate on nexez.ai while
  // owner runs and history originate on app.nexez.ai. Keep both same-origin so
  // POST bodies and session cookies never cross a canonical-host redirect.
  '/api/simulator/runs',
  '/api/simulate-llm',
  '/api/simulate-url',
  '/api/support',
  '/api/directory',
  // The gated deep scan: reachable same-origin from the marketing /scan page,
  // authed via the shared .nexez.ai session cookie.
  '/api/scan/deep',
] as const

/** True when a path is served per-host and must skip canonical-host redirects. */
export function isHostNeutralPath(pathname: string): boolean {
  const p = pathname.replace(/\/+$/, '') || '/'
  if (HOST_NEUTRAL.has(p)) return true
  return HOST_NEUTRAL_API_PREFIXES.some((pre) => p === pre || p.startsWith(`${pre}/`))
}

/** True when `pathname` should be served on the marketing host (nexez.ai). */
export function isMarketingPath(pathname: string): boolean {
  const p = pathname.replace(/\/+$/, '') || '/'
  if (p === '/') return true
  // Match a prefix exactly or as a path segment (so `/design` matches but `/designs` does not).
  return MARKETING_PREFIXES.some((pre) => p === pre || p.startsWith(`${pre}/`))
}

/**
 * True when `pathname` is a discovery surface rendered in BOTH the marketing and
 * the in-app chrome (directory, leaderboard, marketplace, simulator, support).
 * The proxy routes signed-in visitors to the app host for these; PlatformFrame
 * then shows the dashboard nav instead of the marketing nav.
 */
export function isDualPath(pathname: string): boolean {
  return matchesPrefix(pathname, DUAL_PREFIXES)
}

/** True when `pathname` should be served on the authenticated app host. */
export function isAppPath(pathname: string): boolean {
  const p = pathname.replace(/\/+$/, '') || '/'
  return APP_PREFIXES.some((pre) => p === pre || p.startsWith(`${pre}/`))
}

/** True when `pathname` belongs to platform administration. */
export function isAdminPath(pathname: string): boolean {
  return matchesPrefix(pathname, ADMIN_PREFIXES)
}

/** True for the dedicated admin host, including its local-development alias. */
export function isAdminHost(host: string | null | undefined): boolean {
  const normalized = (host ?? '').split(':')[0]!.toLowerCase()
  return normalized === ADMIN_HOST || normalized === 'admin.localhost'
}

/** Login and callback paths that may remain on the admin host. */
export function isAdminAuthPath(pathname: string): boolean {
  return pathname === '/login' || pathname.startsWith('/auth/')
}

/** True when `pathname` should be served on the public agent runtime host. */
export function isAgentRuntimePath(pathname: string): boolean {
  const p = pathname.replace(/\/+$/, '') || '/'
  if (AGENT_RUNTIME_EXACT.has(p)) return true
  return AGENT_RUNTIME_PREFIXES.some((pre) => p === pre || p.startsWith(`${pre}/`))
}

function matchesPrefix(pathname: string, prefixes: readonly string[]): boolean {
  const p = pathname.replace(/\/+$/, '') || '/'
  return prefixes.some((pre) => p === pre || p.startsWith(`${pre}/`))
}

/** The host a given path is canonical to. */
export function canonicalHostFor(pathname: string): string {
  if (isAdminPath(pathname) || matchesPrefix(pathname, ADMIN_API_PREFIXES)) {
    return ADMIN_HOST
  }
  if (isMarketingPath(pathname) || matchesPrefix(pathname, MARKETING_API_PREFIXES)) {
    return MARKETING_HOST
  }
  if (isAppPath(pathname) || matchesPrefix(pathname, APP_API_PREFIXES)) {
    return APP_HOST
  }
  if (isAgentRuntimePath(pathname) || matchesPrefix(pathname, AGENT_RUNTIME_API_PREFIXES)) {
    return AGENT_RUNTIME_HOST
  }
  // Fail safe for UNLISTED routes: an unrecognized API is private-by-default (app
  // host) so a future app-only /api/* added without a prefix entry isn't exposed on
  // the public agent runtime; everything else (e.g. /[slug] agent pages) is runtime.
  if (pathname.startsWith('/api/')) return APP_HOST
  return AGENT_RUNTIME_HOST
}

function urlFor(host: string, path: string): string {
  const proto = host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https'
  return `${proto}://${host}${path.startsWith('/') ? path : `/${path}`}`
}

/** Absolute URL on the authenticated product host. */
export function appUrl(path = '/'): string {
  return urlFor(APP_HOST, path)
}

/** Absolute URL on the platform administration host. */
export function adminUrl(path = '/'): string {
  return urlFor(ADMIN_HOST, path)
}

/** Absolute URL on the marketing host. */
export function marketingUrl(path = '/'): string {
  return urlFor(MARKETING_HOST, path)
}

/** Absolute URL on the public agent runtime host. */
export function agentRuntimeUrl(path = '/'): string {
  return urlFor(AGENT_RUNTIME_HOST, path)
}

import { describe, it, expect } from 'vitest'
import {
  AGENT_RUNTIME_HOST,
  ADMIN_HOST,
  APP_HOST,
  MARKETING_HOST,
  agentRuntimeUrl,
  adminUrl,
  appUrl,
  canonicalHostFor,
  isAppPath,
  isAdminPath,
  isDualPath,
  isHostNeutralPath,
  isMarketingPath,
  marketingUrl,
} from '../site'

describe('isMarketingPath', () => {
  it('treats the homepage + marketing prefixes as marketing', () => {
    for (const p of ['/', '/pricing', '/pricing/teams', '/discovery', '/leaderboard', '/simulator', '/support', '/privacy', '/security', '/sms-notifications', '/terms', '/design', '/blog/x', '/docs']) {
      expect(isMarketingPath(p), p).toBe(true)
    }
  })

  it('keeps /security on the marketing host (it is in the marketing sitemap)', () => {
    // Regression: /security was missing from MARKETING_PREFIXES, so nexez.ai/security
    // 308-bounced to nexez.app while the sitemap advertised the nexez.ai URL.
    expect(isMarketingPath('/security')).toBe(true)
    expect(canonicalHostFor('/security')).toBe(MARKETING_HOST)
  })

  it('treats app/runtime routes as NOT marketing', () => {
    for (const p of ['/admin', '/admin/launch', '/dashboard', '/dashboard/x', '/negotiate/abc', '/checkout/foo', '/api/negotiations', '/login', '/onboard', '/create', '/some-agent-slug', '/agent.json']) {
      expect(isMarketingPath(p), p).toBe(false)
    }
  })

  it('matches prefixes only at a path-segment boundary', () => {
    expect(isMarketingPath('/design')).toBe(true)
    expect(isMarketingPath('/designs')).toBe(false) // an agent page slug, not the /design route
    expect(isMarketingPath('/supporters')).toBe(false)
  })

  it('ignores trailing slashes', () => {
    expect(isMarketingPath('/pricing/')).toBe(true)
    expect(isMarketingPath('/dashboard/')).toBe(false)
  })
})

describe('isHostNeutralPath', () => {
  it('flags per-host SEO files (served on both domains, never redirected)', () => {
    expect(isHostNeutralPath('/sitemap.xml')).toBe(true)
    expect(isHostNeutralPath('/robots.txt')).toBe(true)
  })
  it('does not flag normal routes', () => {
    expect(isHostNeutralPath('/pricing')).toBe(false)
    expect(isHostNeutralPath('/dashboard')).toBe(false)
    expect(isHostNeutralPath('/')).toBe(false)
  })
  it('flags public APIs that back dual surfaces, so they serve same-origin on both hosts', () => {
    // Simulator (signed-in users browse it on the app host).
    expect(isHostNeutralPath('/api/simulate-llm')).toBe(true)
    expect(isHostNeutralPath('/api/simulate-url')).toBe(true)
    expect(isHostNeutralPath('/api/simulator/runs')).toBe(true)
    // Support routes carry the session - must not be redirected cross-domain.
    expect(isHostNeutralPath('/api/support/assist')).toBe(true)
    expect(isHostNeutralPath('/api/support/tickets')).toBe(true)
    // Discovery click-tracking + listing.
    expect(isHostNeutralPath('/api/directory')).toBe(true)
    expect(isHostNeutralPath('/api/directory/click')).toBe(true)
  })
  it('does NOT flag other API routes (they stay canonical to their host)', () => {
    expect(isHostNeutralPath('/api/public-simulate')).toBe(false) // homepage-only, marketing
    expect(isHostNeutralPath('/api/billing')).toBe(false)
    expect(isHostNeutralPath('/api/checkout')).toBe(false)
    expect(isHostNeutralPath('/api/agent-search')).toBe(false)
  })
})

describe('canonicalHostFor', () => {
  it('routes marketing, app, and public runtime paths to their canonical hosts', () => {
    expect(canonicalHostFor('/')).toBe(MARKETING_HOST)
    expect(canonicalHostFor('/pricing')).toBe(MARKETING_HOST)
    expect(canonicalHostFor('/sms-notifications')).toBe(MARKETING_HOST)
    expect(canonicalHostFor('/api/directory')).toBe(MARKETING_HOST)
    expect(canonicalHostFor('/api/simulate-url')).toBe(MARKETING_HOST)
    expect(canonicalHostFor('/api/tools/llms-txt')).toBe(MARKETING_HOST)

    expect(canonicalHostFor('/dashboard')).toBe(APP_HOST)
    expect(canonicalHostFor('/console')).toBe(APP_HOST)
    expect(canonicalHostFor('/console/agency-one/scans')).toBe(APP_HOST)
    expect(canonicalHostFor('/api/organizations')).toBe(APP_HOST)
    expect(canonicalHostFor('/api/organizations/one/context')).toBe(APP_HOST)
    expect(canonicalHostFor('/consoles')).toBe(AGENT_RUNTIME_HOST)
    expect(canonicalHostFor('/admin')).toBe(ADMIN_HOST)
    expect(canonicalHostFor('/admin/growth')).toBe(ADMIN_HOST)
    expect(canonicalHostFor('/api/admin/session')).toBe(ADMIN_HOST)
    expect(canonicalHostFor('/create')).toBe(APP_HOST)
    expect(canonicalHostFor('/api/billing')).toBe(APP_HOST)
    expect(canonicalHostFor('/shopify')).toBe(APP_HOST)
    expect(canonicalHostFor('/api/shopify/session')).toBe(APP_HOST)
    expect(canonicalHostFor('/invite/claim')).toBe(APP_HOST)
    expect(canonicalHostFor('/api/growth-invites/claim')).toBe(APP_HOST)
    expect(canonicalHostFor('/api/tools/import-site')).toBe(APP_HOST)

    expect(canonicalHostFor('/some-slug')).toBe(AGENT_RUNTIME_HOST)
    expect(canonicalHostFor('/agent-pages.json')).toBe(AGENT_RUNTIME_HOST)
    expect(canonicalHostFor('/api/negotiations')).toBe(AGENT_RUNTIME_HOST)
    expect(canonicalHostFor('/api/webhooks/twilio/inbound')).toBe(AGENT_RUNTIME_HOST)
    expect(canonicalHostFor('/api/webhooks/twilio/status')).toBe(AGENT_RUNTIME_HOST)
  })

  it('keeps agent/buyer negotiation routes on the runtime but OWNER actions on the app host', () => {
    // The proposal (agents), pay link (buyer), and status poll (agents) are public
    // agent-runtime surfaces. escrow/transition are owner actions fired from the
    // dashboard (app host) where the session cookie lives - canonicalizing them to
    // the runtime made the dashboard POST a cross-origin 308 ("Load failed").
    expect(canonicalHostFor('/api/negotiations')).toBe(AGENT_RUNTIME_HOST)
    expect(canonicalHostFor('/api/negotiations/pay')).toBe(AGENT_RUNTIME_HOST)
    expect(canonicalHostFor('/api/negotiations/status')).toBe(AGENT_RUNTIME_HOST)
    expect(canonicalHostFor('/api/negotiations/escrow')).toBe(APP_HOST)
    expect(canonicalHostFor('/api/negotiations/transition')).toBe(APP_HOST)
  })

  it('keeps staged buyer actions on the runtime but owner readiness on the app host', () => {
    expect(canonicalHostFor('/api/staged-settlements/checkout')).toBe(AGENT_RUNTIME_HOST)
    expect(canonicalHostFor('/api/staged-settlements/token-1')).toBe(AGENT_RUNTIME_HOST)
    expect(canonicalHostFor('/api/staged-settlements/token-1/checkout')).toBe(AGENT_RUNTIME_HOST)
    expect(canonicalHostFor('/api/staged-settlements/agreements/agreement-1/ready')).toBe(APP_HOST)
  })

  it('keeps the money + webhook + checkout/negotiate routes on the agent runtime host', () => {
    // These are buyer/Stripe/agent surfaces; pinning them guards against an
    // accidental prefix-list reshuffle that would break escrow links or webhook delivery.
    expect(canonicalHostFor('/api/checkout')).toBe(AGENT_RUNTIME_HOST)
    expect(canonicalHostFor('/api/reservable-resources/checkout')).toBe(AGENT_RUNTIME_HOST)
    expect(canonicalHostFor('/api/webhooks/stripe')).toBe(AGENT_RUNTIME_HOST)
    // The Shopify app is hosted on app.nexez.ai, so ITS webhook is the deliberate
    // exception - Shopify won't follow the 308 the runtime prefix would issue.
    expect(canonicalHostFor('/api/webhooks/shopify')).toBe(APP_HOST)
    expect(canonicalHostFor('/api/cron/reconcile-escrow')).toBe(AGENT_RUNTIME_HOST)
    expect(canonicalHostFor('/api/v1/pages')).toBe(AGENT_RUNTIME_HOST)
    expect(canonicalHostFor('/checkout/acme')).toBe(AGENT_RUNTIME_HOST)
    expect(canonicalHostFor('/negotiate/abc-123')).toBe(AGENT_RUNTIME_HOST)
  })

  it('routes the ACP/UCP agentic-commerce surfaces to the agent runtime host', () => {
    // The product feed + the merchant-hosted checkout-session endpoints (called by
    // OpenAI/Google) belong on nexez.app next to /api/checkout.
    expect(canonicalHostFor('/acp/feed.json')).toBe(AGENT_RUNTIME_HOST)
    expect(canonicalHostFor('/ucp/feed.json')).toBe(AGENT_RUNTIME_HOST)
    expect(canonicalHostFor('/api/acp/checkout_sessions')).toBe(AGENT_RUNTIME_HOST)
    expect(canonicalHostFor('/api/ucp/checkout-sessions')).toBe(AGENT_RUNTIME_HOST)
  })

  it('routes the buyer order portal to the runtime, but keeps owner /api/orders/* on the app host', () => {
    // The buyer portal (public, token-gated) lives on the agent runtime…
    expect(canonicalHostFor('/orders')).toBe(AGENT_RUNTIME_HOST)
    expect(canonicalHostFor('/orders/tok_abc123')).toBe(AGENT_RUNTIME_HOST)
    expect(canonicalHostFor('/api/order-portal/request')).toBe(AGENT_RUNTIME_HOST)
    // …but the OWNER actions under /api/orders/* must stay on the app host (owner
    // session). The /api/order-portal prefix must NOT capture them - a 308 here would
    // push the owner refund/triage cross-origin and drop the session.
    expect(canonicalHostFor('/api/orders/refund')).toBe(APP_HOST)
    expect(canonicalHostFor('/api/orders/request-status')).toBe(APP_HOST)
  })

  it('defaults an UNLISTED /api/* route to the private app host (fail-safe), but a slug to the runtime', () => {
    expect(canonicalHostFor('/api/some-future-private-route')).toBe(APP_HOST)
    expect(canonicalHostFor('/totally-unknown-slug')).toBe(AGENT_RUNTIME_HOST)
  })
})

describe('isDualPath', () => {
  it('flags the discovery surfaces that exist in both marketing + app chrome', () => {
    for (const p of ['/discovery', '/leaderboard', '/simulator', '/support', '/discovery/foo', '/support/']) {
      expect(isDualPath(p), p).toBe(true)
    }
  })

  it('does NOT flag marketing-only or app/runtime routes', () => {
    for (const p of ['/pricing', '/privacy', '/terms', '/design', '/blog/x', '/docs', '/', '/dashboard', '/create', '/some-slug', '/supporters']) {
      expect(isDualPath(p), p).toBe(false)
    }
  })

  it('stays canonical to the marketing host (the per-visitor app-host override lives in the proxy)', () => {
    expect(canonicalHostFor('/simulator')).toBe(MARKETING_HOST)
    expect(canonicalHostFor('/discovery')).toBe(MARKETING_HOST)
  })
})

describe('isAppPath', () => {
  it('only flags human product routes', () => {
    expect(isAppPath('/dashboard')).toBe(true)
    expect(isAppPath('/dashboard/settings')).toBe(true)
    expect(isAppPath('/admin')).toBe(false)
    expect(isAppPath('/admin/audit')).toBe(false)
    expect(isAppPath('/create')).toBe(true)
    expect(isAppPath('/shopify')).toBe(true)
    expect(isAppPath('/invite/claim')).toBe(true)
    expect(isAppPath('/some-slug')).toBe(false)
  })
})

describe('isAdminPath', () => {
  it('keeps platform operations separate from the merchant app', () => {
    expect(isAdminPath('/admin')).toBe(true)
    expect(isAdminPath('/admin/support/ticket-1')).toBe(true)
    expect(isAdminPath('/dashboard')).toBe(false)
  })
})

describe('appUrl / marketingUrl / agentRuntimeUrl', () => {
  it('build absolute cross-domain URLs and add a leading slash', () => {
    expect(appUrl('/login')).toBe(`https://${APP_HOST}/login`)
    expect(adminUrl('/login')).toBe(`https://${ADMIN_HOST}/login`)
    expect(appUrl('onboard')).toBe(`https://${APP_HOST}/onboard`)
    expect(marketingUrl('/pricing')).toBe(`https://${MARKETING_HOST}/pricing`)
    expect(marketingUrl()).toBe(`https://${MARKETING_HOST}/`)
    expect(agentRuntimeUrl('/acme')).toBe(`https://${AGENT_RUNTIME_HOST}/acme`)
  })

  it('the hosts are distinct', () => {
    expect(APP_HOST).not.toBe(MARKETING_HOST)
    expect(AGENT_RUNTIME_HOST).not.toBe(MARKETING_HOST)
    expect(AGENT_RUNTIME_HOST).not.toBe(APP_HOST)
    expect(ADMIN_HOST).not.toBe(APP_HOST)
    expect(ADMIN_HOST).not.toBe(MARKETING_HOST)
  })
})

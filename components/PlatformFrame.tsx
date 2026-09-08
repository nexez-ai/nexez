'use client'

import { ReactNode, useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { NexezLogo } from './NexezLogo'
import { hasSupabaseAuthCookieInDocument } from '../lib/auth-cookie'
import { fetchCommerceAttention } from '../lib/commerce-attention-client'
import type { CommerceAttentionSummary } from '../lib/commerce-attention'
import { isDualPath, isMarketingPath } from '../lib/site'

// The heavy chrome is code-split and only loaded where it's used:
//  - PlatformShell: the in-app product nav (app.nexez.ai: dashboard, page builder).
//  - MarketingShell: the marketing nav/footer (nexez.ai: homepage, discovery,
//    pricing, simulator, …).
// Agent/public pages, auth, and the API render children directly - keeping those
// surfaces (esp. the agent pages) lean.
const PlatformShell = dynamic(() => import('./PlatformShell'))
const MobilePlatformNav = dynamic(() => import('./MobilePlatformNav').then((m) => m.MobilePlatformNav))
const MarketingShell = dynamic(() => import('./MarketingShell').then((m) => m.MarketingShell))
const OrganizationSignOut = dynamic(() => import('./organizations/OrganizationSignOut'))

// Product routes that get the in-app shell. The discovery/simulator/support
// surfaces moved to MarketingShell as part of the nexez.ai / app.nexez.ai split.
const platformPrefixes = ['/dashboard', '/create']

function PlatformChrome({ children }: { children: ReactNode }) {
  const [commerceAttention, setCommerceAttention] = useState<CommerceAttentionSummary | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetchCommerceAttention().then((attention) => {
      if (!cancelled) setCommerceAttention(attention)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="pb-16 md:pb-0 max-md:[&_.dashboard-sidebar]:hidden">
      <PlatformShell commerceAttention={commerceAttention}>{children}</PlatformShell>
      <MobilePlatformNav commerceAttention={commerceAttention} />
    </div>
  )
}

// The session is detected CLIENT-side (document.cookie) after hydration. It only
// affects the 4 dual discovery surfaces' chrome; resolving it in the root layout
// via cookies() - the previous design - forced the ENTIRE route tree dynamic and
// blocked static prerendering of the marketing site. Trade-off: a signed-in
// visitor on a dual page sees the marketing chrome for one paint before the
// dashboard nav swaps in (anonymous visitors - the overwhelming majority on
// these public surfaces - see no flash at all).
export function PlatformFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const [hasSession, setHasSession] = useState(false)
  useEffect(() => {
    // Post-hydration on purpose: reading the cookie in a state initializer would
    // mismatch the (static, anonymous) server HTML and break hydration.
    setHasSession(hasSupabaseAuthCookieInDocument())
  }, [])

  // Organization context has its own navigation. Mounting seller chrome here
  // would fetch merchant attention and imply merchant controls apply to the org.
  if (pathname === '/console' || pathname.startsWith('/console/')) {
    return (
      <div className="nx-dash min-h-screen bg-[var(--bg)] text-[var(--fg)]">
        <header className="border-b border-[var(--bd-10)]">
          <nav aria-label="Workspace navigation" className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-4">
            <Link href="/console" prefetch={false} aria-label="Nexez workspaces" className="flex items-center gap-3 font-semibold"><NexezLogo tone="theme" /><span>Workspaces</span></Link>
            <div className="flex items-center gap-5">
              <Link href="/dashboard" prefetch={false} className="text-sm text-[var(--fg-muted)] hover:text-[var(--fg)]">Merchant dashboard</Link>
              <OrganizationSignOut />
            </div>
          </nav>
        </header>
        {children}
      </div>
    )
  }

  // Dual discovery surfaces: signed-in visitors get the in-app dashboard nav
  // (and the proxy keeps them on the app host); anonymous visitors get the
  // marketing chrome. Checked before isMarketingPath, which also matches these.
  if (isDualPath(pathname)) {
    return hasSession ? (
      <PlatformChrome>{children}</PlatformChrome>
    ) : (
      <MarketingShell>{children}</MarketingShell>
    )
  }

  // Marketing surfaces (nexez.ai), including the homepage.
  if (isMarketingPath(pathname)) {
    return <MarketingShell>{children}</MarketingShell>
  }

  const shouldFrame = platformPrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
  if (shouldFrame) return <PlatformChrome>{children}</PlatformChrome>

  return <>{children}</>
}

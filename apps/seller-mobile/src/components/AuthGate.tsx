import { Redirect, useGlobalSearchParams, useIsFocused, usePathname } from 'expo-router'
import { useState, type ReactNode } from 'react'
import { LoadingState } from './ui'
import { useSession } from '@/src/hooks/useSession'
import { authReturnPath } from '@/src/lib/auth-routing'

const PUBLIC_SCREENS = new Set(['index', 'login', 'onboarding', '+not-found'])

/** Tabs resolve their child route before applying the same gate to each screen. */
export function renderAuthScreen({ children, route }: { children: ReactNode; route: { name: string } }) {
  if (PUBLIC_SCREENS.has(route.name) || route.name === '(tabs)') return <>{children}</>
  return renderProtectedScreen({ children })
}

export function renderProtectedScreen({ children }: { children: ReactNode }) {
  return <AuthGate>{children}</AuthGate>
}

function SignInRedirect({ destination }: { destination: string }) {
  // The pathname changes during navigation. Preserve the destination that opened login.
  const [href] = useState(() => ({ pathname: '/login' as const, params: { returnTo: authReturnPath(destination) } }))
  return <Redirect href={href} />
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { loading, session } = useSession()
  const focused = useIsFocused()
  const pathname = usePathname()
  const { pageId } = useGlobalSearchParams<{ pageId?: string | string[] }>()
  const destination = pathname === '/intake' && typeof pageId === 'string'
    ? `${pathname}?pageId=${encodeURIComponent(pageId)}`
    : pathname

  if (loading) return <LoadingState label="Checking session" />
  if (!session) return focused ? <SignInRedirect destination={destination} /> : null

  return children
}

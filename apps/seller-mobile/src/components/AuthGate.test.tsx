import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderAuthScreen, renderProtectedScreen } from './AuthGate'
import { LoginScreen } from '../screens/LoginScreen'

const auth = vi.hoisted(() => ({
  loading: false,
  focused: true,
  session: null as null | { user: { id: string } },
  pathname: '/inbox/orders/order_123',
  pageId: undefined as undefined | string | string[],
  returnTo: undefined as unknown,
}))

vi.mock('expo-router', () => ({
  usePathname: () => auth.pathname,
  useIsFocused: () => auth.focused,
  useLocalSearchParams: () => ({ returnTo: auth.returnTo }),
  useGlobalSearchParams: () => ({ pageId: auth.pageId }),
  Redirect: ({ href }: { href: unknown }) => createElement('output', null, JSON.stringify(href)),
}))

vi.mock('@/src/hooks/useSession', () => ({ useSession: () => auth }))
vi.mock('@/src/lib/supabase', () => ({ isSupabaseConfigured: true }))
vi.mock('lucide-react-native', () => ({ Lock: () => null, Mail: () => null, UserPlus: () => null }))
vi.mock('react-native', () => ({
  KeyboardAvoidingView: ({ children }: { children: ReactNode }) => children,
  Platform: { OS: 'web' },
  StyleSheet: { create: (styles: unknown) => styles },
  Text: ({ children }: { children: ReactNode }) => children,
  View: ({ children }: { children: ReactNode }) => children,
}))
vi.mock('@/src/components/ui', () => ({
  LoadingState: ({ label }: { label: string }) => createElement('output', null, label),
  AppButton: () => null,
  Card: ({ children }: { children: ReactNode }) => children,
  Header: () => null,
  Screen: ({ children }: { children: ReactNode }) => children,
  SegmentedControl: () => null,
  TextField: () => null,
}))

beforeEach(() => {
  auth.loading = false
  auth.focused = true
  auth.session = null
  auth.pathname = '/inbox/orders/order_123'
  auth.pageId = undefined
  auth.returnTo = undefined
})

describe('root screen authentication', () => {
  it.each(['inbox/orders/[id]', 'listing/[id]/edit', 'tools/finance', 'notifications/index', 'intake', 'future-private-screen'])(
    'does not mount %s before sign-in and preserves the destination', (name) => {
      const privateScreen = vi.fn(() => createElement('p', null, 'Private data'))
      const html = renderToStaticMarkup(renderAuthScreen({ route: { name }, children: createElement(privateScreen) }))

      expect(privateScreen).not.toHaveBeenCalled()
      expect(html).toContain('&quot;pathname&quot;:&quot;/login&quot;')
      expect(html).toContain('&quot;returnTo&quot;:&quot;/inbox/orders/order_123&quot;')
    },
  )

  it('gates a resolved tab before mounting its private screen', () => {
    auth.pathname = '/settings'
    const privateScreen = vi.fn(() => createElement('p', null, 'Private settings'))
    const tab = renderProtectedScreen({ children: createElement(privateScreen) })
    const html = renderToStaticMarkup(renderAuthScreen({ route: { name: '(tabs)' }, children: tab }))
    expect(privateScreen).not.toHaveBeenCalled()
    expect(html).toContain('&quot;returnTo&quot;:&quot;/settings&quot;')
  })

  it('waits for restoration before mounting private content or redirecting', () => {
    auth.loading = true
    auth.session = { user: { id: 'seller_123' } }
    const privateScreen = vi.fn(() => createElement('p', null, 'Private data'))
    const html = renderToStaticMarkup(renderAuthScreen({ route: { name: 'tools/finance' }, children: createElement(privateScreen) }))

    expect(html).toContain('Checking session')
    expect(html).not.toContain('/login')
    expect(privateScreen).not.toHaveBeenCalled()
  })

  it('does not let a background screen mount private content or capture another screen\'s destination', () => {
    auth.focused = false
    const privateScreen = vi.fn(() => createElement('p', null, 'Private data'))
    const html = renderToStaticMarkup(renderProtectedScreen({ children: createElement(privateScreen) }))
    expect(html).toBe('')
    expect(privateScreen).not.toHaveBeenCalled()
  })

  it.each(['index', 'login', 'onboarding', '+not-found'])('leaves the public %s screen accessible', (name) => {
    const html = renderToStaticMarkup(renderAuthScreen({ route: { name }, children: createElement('p', null, 'Public content') }))
    expect(html).toContain('Public content')
  })

  it('mounts private content once a session is ready', () => {
    auth.session = { user: { id: 'seller_123' } }
    const html = renderToStaticMarkup(renderAuthScreen({ route: { name: 'tools/finance' }, children: createElement('p', null, 'Private content') }))
    expect(html).toContain('Private content')
  })

  it('preserves the existing listing for an intake sign-in return', () => {
    auth.pathname = '/intake'
    auth.pageId = 'page_123'
    const html = renderToStaticMarkup(renderAuthScreen({ route: { name: 'intake' }, children: createElement('p', null, 'Intake') }))
    expect(html).toContain('&quot;returnTo&quot;:&quot;/intake?pageId=page_123&quot;')
  })
})

describe('login destination after authentication', () => {
  it('returns to the order instead of Overview when sign-in succeeds', () => {
    auth.session = { user: { id: 'seller_123' } }
    auth.returnTo = '/inbox/orders/order_123'
    expect(renderToStaticMarkup(createElement(LoginScreen))).toContain('&quot;/inbox/orders/order_123&quot;')
  })

  it.each([undefined, 'https://attacker.example', ['/tools/finance'], '/login'])('uses Overview for invalid destination %j', (returnTo) => {
    auth.session = { user: { id: 'seller_123' } }
    auth.returnTo = returnTo
    expect(renderToStaticMarkup(createElement(LoginScreen))).toContain('&quot;/overview&quot;')
  })

  it('does not redirect an unauthenticated visitor to their requested private screen', () => {
    auth.returnTo = '/tools/finance'
    expect(renderToStaticMarkup(createElement(LoginScreen))).not.toContain('/tools/finance')
  })
})

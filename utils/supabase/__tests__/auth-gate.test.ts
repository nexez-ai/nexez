import { describe, expect, it } from 'vitest'
import { isProtectedPath, resolveAuthGate } from '../auth-gate'

describe('isProtectedPath', () => {
  it('protects seller and admin workspaces', () => {
    expect(isProtectedPath('/dashboard')).toBe(true)
    expect(isProtectedPath('/dashboard/abc-123')).toBe(true)
    expect(isProtectedPath('/dashboard/abc/settings')).toBe(true)
    expect(isProtectedPath('/admin')).toBe(true)
    expect(isProtectedPath('/admin/support/ticket-1')).toBe(true)
    expect(isProtectedPath('/console')).toBe(true)
    expect(isProtectedPath('/console/agency-one/scans')).toBe(true)
    expect(isProtectedPath('/consoles')).toBe(false)
  })

  it('leaves public surfaces open', () => {
    for (const p of ['/', '/create', '/marketplace', '/directory', '/leaderboard', '/simulator', '/support', '/login', '/some-public-slug']) {
      expect(isProtectedPath(p)).toBe(false)
    }
  })

  it('does not treat a /dashboard-prefixed sibling as protected', () => {
    // guards against `startsWith('/dashboard')` false positives
    expect(isProtectedPath('/dashboardfoo')).toBe(false)
    expect(isProtectedPath('/dashboards')).toBe(false)
  })
})

describe('resolveAuthGate', () => {
  it('preserves the organization destination through sign-in', () => {
    expect(resolveAuthGate('/console/agency-one/scans', '?cursor=next', false)).toEqual({ next: '/console/agency-one/scans?cursor=next' })
    expect(resolveAuthGate('/console/agency-one/scans', '', true)).toBeNull()
  })
  it('redirects an unauthenticated user off a protected route, preserving the path as next', () => {
    expect(resolveAuthGate('/dashboard', '', false)).toEqual({ next: '/dashboard' })
    expect(resolveAuthGate('/dashboard/4b6f000e', '', false)).toEqual({ next: '/dashboard/4b6f000e' })
    expect(resolveAuthGate('/admin/support', '', false)).toEqual({ next: '/admin/support' })
  })

  it('preserves the query string in next', () => {
    expect(resolveAuthGate('/dashboard/abc', '?tab=offers', false)).toEqual({ next: '/dashboard/abc?tab=offers' })
  })

  it('lets an authenticated user through to a protected route', () => {
    expect(resolveAuthGate('/dashboard', '', true)).toBeNull()
    expect(resolveAuthGate('/dashboard/abc', '?x=1', true)).toBeNull()
  })

  it('lets anyone through to public routes regardless of auth', () => {
    expect(resolveAuthGate('/', '', false)).toBeNull()
    expect(resolveAuthGate('/create', '?from=home', false)).toBeNull()
    expect(resolveAuthGate('/login', '?next=/dashboard', false)).toBeNull()
    expect(resolveAuthGate('/dashboardfoo', '', false)).toBeNull()
  })
})

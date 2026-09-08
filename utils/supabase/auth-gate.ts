// Pure auth-gate decision shared by the Supabase middleware (updateSession).
// Kept framework-free (no next/server, no @supabase/ssr) so the gate's routing
// rules are unit-testable in isolation.

/** Routes that require an authenticated account: seller, organization, and admin workspaces. */
export function isProtectedPath(pathname: string): boolean {
  return ['/dashboard', '/console', '/admin'].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

/**
 * Decide whether an incoming request should be bounced to /login.
 * Returns the `next` value to round-trip the user back to after sign-in, or
 * null to let the request through. Public surfaces (/, /create, /marketplace,
 * /directory, /leaderboard, /simulator, /support, public pages) are never gated.
 */
export function resolveAuthGate(
  pathname: string,
  search: string,
  hasUser: boolean,
): { next: string } | null {
  if (isProtectedPath(pathname) && !hasUser) {
    return { next: pathname + (search || '') }
  }
  return null
}

export const PUBLIC_IDENTIFIER_MIN = 5
export const PUBLIC_IDENTIFIER_MAX = 63

export const RESERVED_PUBLIC_IDENTIFIERS = new Set([
  'acp', 'agent-readiness', 'agents', 'api', 'auth', 'checkout', 'compare', 'console',
  'create', 'dashboard', 'design', 'developers', 'discovery', 'enterprise',
  'examples', 'growth-control-preview', 'how-it-works', 'integrations',
  'invite', 'leaderboard', 'learn', 'login', 'mcp', 'negotiate', 'nexxi', 'nexxi',
  'onboard', 'orders', 'pricing', 'privacy', 'scan', 'security', 'sms-notifications',
  'service-agreements', 'shopify', 'simulator', 'store', 'support', 'team',
  'terms', 'tools', 'ucp', 'use-cases',
  'directory', 'marketplace', 'competitors', 'blog', 'docs', 'admin',
  'settings', 'account', 'billing', 'help', 'status', 'app', 'www', 'assets',
  'static', 'well-known',
  'nexez', 'nexez-ai', 'nexezai', 'official', 'verified', 'trust', 'payments',
  'legal', 'abuse', 'notifications', 'no-reply', 'noreply', 'postmaster',
])

export type PublicIdentifierIssue =
  | 'too_short'
  | 'too_long'
  | 'invalid_format'
  | 'reserved'

export type PublicIdentifierValidation =
  | { ok: true; value: string; grandfathered: boolean }
  | { ok: false; value: string; issue: PublicIdentifierIssue; message: string }

export function normalizePublicIdentifier(input: unknown): string {
  if (typeof input !== 'string') return ''
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function isReservedPublicIdentifier(identifier: string): boolean {
  return RESERVED_PUBLIC_IDENTIFIERS.has(identifier)
    || identifier.startsWith('xn--')
    || identifier.startsWith('nexez-')
    || identifier.endsWith('-nexez')
}

export function validatePublicIdentifier(
  input: unknown,
  options: { current?: string | null } = {},
): PublicIdentifierValidation {
  const raw = typeof input === 'string' ? input.trim() : ''
  const value = normalizePublicIdentifier(raw)
  const current = options.current?.trim().toLowerCase() ?? null
  if (current && raw.toLowerCase() === current && value === current) {
    return { ok: true, value, grandfathered: value.length < PUBLIC_IDENTIFIER_MIN }
  }
  if (value.length < PUBLIC_IDENTIFIER_MIN) {
    return {
      ok: false,
      value,
      issue: 'too_short',
      message: `Use at least ${PUBLIC_IDENTIFIER_MIN} characters.`,
    }
  }
  if (raw.length > PUBLIC_IDENTIFIER_MAX) {
    return {
      ok: false,
      value,
      issue: 'too_long',
      message: `Use no more than ${PUBLIC_IDENTIFIER_MAX} characters.`,
    }
  }
  if (raw.toLowerCase().startsWith('xn--') || isReservedPublicIdentifier(value)) {
    return {
      ok: false,
      value,
      issue: 'reserved',
      message: 'That public name is reserved. Choose another.',
    }
  }
  if (raw !== value || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    return {
      ok: false,
      value,
      issue: 'invalid_format',
      message: 'Use lowercase letters, numbers, and single hyphens only.',
    }
  }
  return { ok: true, value, grandfathered: false }
}

export function publicIdentifierDatabaseMessage(
  error: { message?: string | null; code?: string | null } | null | undefined,
): string | null {
  const message = error?.message ?? ''
  if (/public_identifier_required/i.test(message)) return 'Choose a public name before publishing.'
  if (/public_identifier_too_short/i.test(message)) return 'Use at least 5 characters.'
  if (/public_identifier_too_long/i.test(message)) return 'Use no more than 63 characters.'
  if (/public_identifier_invalid_format/i.test(message)) return 'Use lowercase letters, numbers, and single hyphens only.'
  if (/public_identifier_reserved/i.test(message)) return 'That public name is reserved. Choose another.'
  if (
    /public_identifier_taken/i.test(message)
    || (error?.code === '23505' && /(public_identifier|slug|handle)/i.test(message))
  ) return 'That public name is already taken. Try another.'
  return null
}

/** Tracks one latest-only async check. Stale responses cannot replace state for
 * a newer public name, and cleanup can invalidate an in-flight request. */
export class PublicIdentifierRequestGuard {
  private sequence = 0

  begin(): number {
    this.sequence += 1
    return this.sequence
  }

  invalidate(): void {
    this.sequence += 1
  }

  accepts(requestId: number): boolean {
    return requestId === this.sequence
  }
}

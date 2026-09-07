import { normalizeSellerDeepLink, type SellerRoute } from './notification-routing'

type AuthReturnPath = SellerRoute | '/settings' | '/intake' | `/intake?pageId=${string}`

/** Keep sign-in returns inside known seller screens and validated intake context. */
export function authReturnPath(value: unknown): AuthReturnPath {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) {
    return '/overview'
  }

  const withoutFragment = value.split('#', 1)[0]
  const path = withoutFragment.split('?', 1)[0].replace(/\/+$/, '')
  if (path === '/settings') return path
  if (path === '/intake') {
    const queryStart = withoutFragment.indexOf('?')
    const query = queryStart < 0 ? '' : withoutFragment.slice(queryStart + 1)
    const pageIds = new URLSearchParams(query).getAll('pageId')
    if (pageIds.length === 1 && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(pageIds[0])) {
      return `/intake?pageId=${pageIds[0]}`
    }
    return '/intake'
  }
  if (path === '/create') return '/listing/create'
  return normalizeSellerDeepLink(path) ?? '/overview'
}

const MAX_QUERY_URL_LENGTH = 2_048

export type ScanSource = 'hero' | 'scan-page' | 'unknown'

export function scanUrlPrefill(search: string): string {
  const value = new URLSearchParams(search).get('url')?.trim() ?? ''
  return value.slice(0, MAX_QUERY_URL_LENGTH)
}

export function resolveScanSource(
  requestedSource: unknown,
  referer: string | null,
  requestUrl: string,
): ScanSource {
  if (requestedSource === 'hero' || requestedSource === 'scan-page') {
    return requestedSource
  }

  if (!referer) return 'unknown'
  try {
    const requestOrigin = new URL(requestUrl).origin
    const referrerUrl = new URL(referer)
    const pathname = referrerUrl.pathname.replace(/\/+$/, '') || '/'
    return referrerUrl.origin === requestOrigin && pathname === '/scan'
      ? 'scan-page'
      : 'unknown'
  } catch {
    return 'unknown'
  }
}

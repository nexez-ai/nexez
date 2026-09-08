import 'server-only'

/**
 * Read at most `maxBytes` from an upstream response, then cancel the stream.
 * External-site scanners must use this instead of `Response.text()` so one
 * unexpectedly large page cannot consume an unbounded amount of memory.
 */
export async function readBodyCapped(res: Response, maxBytes: number, onBytes?: (bytes: number) => void): Promise<string | null> {
  const body = res.body
  if (!body) {
    try {
      const text = await res.text()
      onBytes?.(Math.min(new TextEncoder().encode(text).byteLength, maxBytes))
      return text.length > maxBytes ? text.slice(0, maxBytes) : text
    } catch {
      return null
    }
  }

  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: false })
  let out = ''
  let bytes = 0
  try {
    while (bytes < maxBytes) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      const remaining = maxBytes - bytes
      const chunk = value.byteLength > remaining ? value.subarray(0, remaining) : value
      bytes += chunk.byteLength
      onBytes?.(chunk.byteLength)
      out += decoder.decode(chunk, { stream: true })
    }
    out += decoder.decode()
    return out
  } catch {
    return null
  } finally {
    try {
      await reader.cancel()
    } catch {
      // The stream may already be closed.
    }
  }
}

import { describe, expect, it } from 'vitest'
import { resolveScanSource, scanUrlPrefill } from '../scan-funnel'

const scanEndpoint = 'https://nexez.ai/api/scan'

describe('scan funnel attribution', () => {
  it('prefills the homepage scanner from the url query parameter', () => {
    expect(scanUrlPrefill('?url=https%3A%2F%2Fexample.com%2Fservices')).toBe(
      'https://example.com/services',
    )
    expect(scanUrlPrefill('?other=value')).toBe('')
  })

  it('bounds and trims homepage prefill input', () => {
    expect(scanUrlPrefill(`?url=${encodeURIComponent(`  ${'x'.repeat(3_000)}  `)}`))
      .toHaveLength(2_048)
  })

  it('keeps explicit source labels and infers the same-origin scan page', () => {
    expect(resolveScanSource('hero', null, scanEndpoint)).toBe('hero')
    expect(resolveScanSource('scan-page', null, scanEndpoint)).toBe('scan-page')
    expect(resolveScanSource(
      undefined,
      'https://nexez.ai/scan?url=example.com',
      scanEndpoint,
    )).toBe('scan-page')
  })

  it('does not turn arbitrary or foreign callers into scan-page traffic', () => {
    expect(resolveScanSource('invented', 'https://nexez.ai/pricing', scanEndpoint))
      .toBe('unknown')
    expect(resolveScanSource(undefined, 'https://example.com/scan', scanEndpoint))
      .toBe('unknown')
    expect(resolveScanSource(undefined, 'not a url', scanEndpoint)).toBe('unknown')
    expect(resolveScanSource(undefined, null, scanEndpoint)).toBe('unknown')
  })
})

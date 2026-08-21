import { describe, expect, it } from 'vitest'
import { formatCurrency } from './format'

describe('formatCurrency', () => {
  it('formats ordinary currencies from hundredths', () => {
    expect(formatCurrency(1234, 'usd')).toMatch(/12\.34/)
  })

  it('keeps zero-decimal Stripe units unchanged', () => {
    const formatted = formatCurrency(1000, 'jpy')
    expect(formatted).toMatch(/1,?000/)
    expect(formatted).not.toContain('.00')
  })
})

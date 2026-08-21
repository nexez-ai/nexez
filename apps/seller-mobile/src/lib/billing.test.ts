import { describe, expect, it } from 'vitest'
import { commissionPercentForPlan } from './billing'

describe('commissionPercentForPlan', () => {
  it('matches the platform plan schedule', () => {
    expect(commissionPercentForPlan('free')).toBe(9)
    expect(commissionPercentForPlan('pro')).toBe(5)
    expect(commissionPercentForPlan('enterprise')).toBe(2)
  })

  it('fails closed to the highest standard rate', () => {
    expect(commissionPercentForPlan(null)).toBe(9)
    expect(commissionPercentForPlan('unknown')).toBe(9)
  })
})

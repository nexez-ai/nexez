import { describe, expect, it } from 'vitest'
import { isPublicLaunchVisiblePage, publicLaunchVisiblePages } from '../public-page-visibility'

describe('public marketplace visibility', () => {
  it('keeps ordinary and unreviewed listings discoverable by default', () => {
    expect(isPublicLaunchVisiblePage({ slug: 'northstar-strategy' })).toBe(true)
    expect(isPublicLaunchVisiblePage({ slug: 'northstar-strategy', marketplace_discoverable: true })).toBe(true)
  })

  it('honors explicit curation exclusions without affecting the slug itself', () => {
    expect(isPublicLaunchVisiblePage({ slug: 'northstar-strategy', marketplace_discoverable: false })).toBe(false)
    expect(publicLaunchVisiblePages([
      { slug: 'visible', marketplace_discoverable: true },
      { slug: 'direct-only', marketplace_discoverable: false },
    ])).toEqual([{ slug: 'visible', marketplace_discoverable: true }])
  })

  it('keeps unmistakable internal fixtures out as defense in depth', () => {
    expect(isPublicLaunchVisiblePage({ slug: 'qa12-42' })).toBe(false)
    expect(isPublicLaunchVisiblePage({ slug: 'gauntlet-negotiation-lab' })).toBe(false)
    expect(isPublicLaunchVisiblePage({ slug: 'simulation-northstar-strategy' })).toBe(false)
    expect(isPublicLaunchVisiblePage({ slug: 'nexez-agent-negotiation-lab' })).toBe(false)
    expect(isPublicLaunchVisiblePage({ slug: 'nexez-party-rentals-certification' })).toBe(false)
    expect(isPublicLaunchVisiblePage({ slug: 'shopify-review-catalog' })).toBe(false)
    expect(isPublicLaunchVisiblePage({ slug: 'shopify-review-rehearsal-20260908', marketplace_discoverable: true })).toBe(false)
    expect(isPublicLaunchVisiblePage({ slug: ' Shopify-Review-Rehearsal-20260908 ' })).toBe(false)
  })

  it('does not hide similarly named real merchants or mutate direct-access records', () => {
    const merchant = { slug: 'shopify-review-rehearsal-studio', marketplace_discoverable: true }
    const fixture = { slug: 'shopify-review-rehearsal-20260908', marketplace_discoverable: true }
    expect(publicLaunchVisiblePages([fixture, merchant])).toEqual([merchant])
    expect(fixture).toEqual({ slug: 'shopify-review-rehearsal-20260908', marketplace_discoverable: true })
  })
})

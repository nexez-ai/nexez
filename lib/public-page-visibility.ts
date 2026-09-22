import type { AgentPage } from './agent-page'

const INTERNAL_SEED_SLUGS = [
  /^qa\d{1,4}[-_]\d{1,4}$/i,
  /^(qa|test|seed|gauntlet|red[-_]?team|adversarial)([-_]|$)/i,
  /^(simulation|simulated|synthetic)([-_]|$)/i,
  /^nexez-agent-negotiation-lab$/i,
  /^nexez-party-rentals-certification$/i,
  /^shopify-review-catalog$/i,
  /^shopify-review-rehearsal-\d{8}$/i,
]

/**
 * Keeps internal QA/gauntlet seed pages out of discovery surfaces without
 * blocking their direct public URLs. Real published customer pages still render
 * normally when linked directly.
 */
export function isPublicLaunchVisiblePage(page: Pick<AgentPage, 'slug' | 'marketplace_discoverable'>): boolean {
  const slug = page.slug?.trim() || ''
  if (!slug) return false
  if (page.marketplace_discoverable === false) return false
  return !INTERNAL_SEED_SLUGS.some((pattern) => pattern.test(slug))
}

export function publicLaunchVisiblePages<T extends Pick<AgentPage, 'slug' | 'marketplace_discoverable'>>(pages: T[] | null | undefined): T[] {
  return (pages ?? []).filter(isPublicLaunchVisiblePage)
}

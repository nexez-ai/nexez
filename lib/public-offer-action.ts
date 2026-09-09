import {
  type AgentPage,
  type CheckoutOffer,
  getCheckoutPath,
  getPreferredOriginalOfferUrl,
  isOfferActionAvailable,
  sanitizePublicUrl,
} from './agent-page'

/** Use the same provider preference as product cards and the checkout API.
 * Callers pass only offers visible to this visitor, preserving their indices. */
export function getPrimaryOfferAction(
  page: Pick<AgentPage, 'slug' | 'prefer_original_site' | 'cta_url' | 'website_url' | 'cta_label'>,
  visibleOffers: readonly CheckoutOffer[],
) {
  const offer = visibleOffers.find(isOfferActionAvailable)
  const originalUrl = getPreferredOriginalOfferUrl(page, offer)
  if (originalUrl) {
    return { href: originalUrl, label: 'View on original site', external: true }
  }
  if (offer && !page.prefer_original_site) {
    return {
      href: getCheckoutPath(page.slug, offer.kind, offer.index),
      label: 'Book Now',
      external: false,
    }
  }
  return {
    href: sanitizePublicUrl(page.cta_url) || sanitizePublicUrl(page.website_url) || '#',
    label: page.cta_label || (page.prefer_original_site ? 'Book on our website' : 'Visit website'),
    external: true,
  }
}

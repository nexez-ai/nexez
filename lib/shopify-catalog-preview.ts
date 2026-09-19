import { sanitizePublicUrl, type OfferItem } from './agent-page'

/** Only the current store's imported product fields belong in its embedded UI. */
export function shopifyCatalogPreview(
  page: { products?: OfferItem[] | null; services?: OfferItem[] | null },
  shop: string,
  generation: number | null | undefined,
) {
  if (!generation) return []
  return [...(page.products ?? []), ...(page.services ?? [])]
    .filter((offer) => offer.source === 'shopify'
      && offer.metadata?.shopify_shop === shop
      && offer.metadata?.shopify_mapping_generation === generation)
    .map((offer) => ({
      name: offer.name,
      description: offer.description ?? '',
      price: offer.price ?? '',
      availability: offer.availability ?? 'available',
      url: sanitizePublicUrl(offer.url),
      variants: (offer.tiers ?? []).map((tier) => ({ name: tier.name, price: tier.price })),
    }))
}

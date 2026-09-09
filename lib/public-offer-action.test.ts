import { describe, expect, it } from 'vitest'
import { getCheckoutOffers, type AgentPage } from './agent-page'
import { getPrimaryOfferAction } from './public-offer-action'

const product = {
  name: 'Test product', description: '', price: '$25',
  url: 'https://test.myshopify.com/products/test-product',
  source: 'shopify', prefer_original_for_this: true,
}
const page = {
  slug: 'test-catalog', prefer_original_site: false,
  cta_url: 'https://example.com/book', website_url: 'https://example.com',
  cta_label: 'Visit provider', services: [], products: [product],
} as unknown as AgentPage

describe('public listing primary action', () => {
  it('uses the Shopify product URL even when the page preference is false', () => {
    expect(getPrimaryOfferAction(page, getCheckoutOffers(page))).toEqual({
      href: product.url, label: 'View on original site', external: true,
    })
  })

  it('skips sold-out offers instead of linking checkout for the first array item', () => {
    const offers = getCheckoutOffers({ products: [
      { ...product, availability: 'sold_out' },
      { ...product, url: 'https://test.myshopify.com/products/available' },
    ], services: [] })
    expect(getPrimaryOfferAction(page, offers).href).toBe(offers[1].url)
  })

  it('honors caller-filtered A/B visibility and preserves checkout indices', () => {
    const offers = getCheckoutOffers({ products: [product, {
      ...product, url: '', prefer_original_for_this: false,
    }], services: [] })
    expect(getPrimaryOfferAction(page, offers.slice(1))).toEqual({
      href: '/checkout/test-catalog?offer=products-1', label: 'Book Now', external: false,
    })
  })

  it('retains Nexez checkout for ordinary offers', () => {
    const offers = getCheckoutOffers({ products: [{ ...product, prefer_original_for_this: false }], services: [] })
    expect(getPrimaryOfferAction(page, offers).external).toBe(false)
  })

  it('honors the page-level original-site preference', () => {
    const offers = getCheckoutOffers({ products: [{ ...product, prefer_original_for_this: false }], services: [] })
    expect(getPrimaryOfferAction({ ...page, prefer_original_site: true }, offers).href).toBe(product.url)
  })

  it('keeps legacy Shopify offers stored as services on their original site', () => {
    expect(getPrimaryOfferAction(page, getCheckoutOffers({ products: [], services: [product] })).href).toBe(product.url)
  })

  it('falls back to the page CTA when no available offers remain', () => {
    const offers = getCheckoutOffers({ products: [{ ...product, availability: 'sold_out' }], services: [] })
    expect(getPrimaryOfferAction(page, offers)).toEqual({ href: page.cta_url, label: 'Visit provider', external: true })
  })

  it('never emits an unsafe original-site URL', () => {
    const offers = getCheckoutOffers({ products: [{ ...product, url: 'javascript:alert(1)' }], services: [] })
    expect(getPrimaryOfferAction(page, offers).href).toBe('/checkout/test-catalog?offer=products-0')
  })
})

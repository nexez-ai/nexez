import { describe, expect, it } from 'vitest'
import type { OfferItem } from './agent-page'
import { shopifyCatalogPreview } from './shopify-catalog-preview'

const product: OfferItem = {
  name: 'Review mug', price: '$18.00', description: 'Ceramic mug',
  url: 'https://review.myshopify.com/products/mug', source: 'shopify',
  availability: 'available', tiers: [{ name: 'Blue', price: '$18.00' }],
  metadata: { shopify_shop: 'review.myshopify.com', shopify_mapping_generation: 3, private_note: 'private' },
  rules: { minPrice: '$1.00' },
}

describe('Shopify catalog preview', () => {
  it('includes only the current store and mapping, including legacy service-column products', () => {
    const preview = shopifyCatalogPreview({
      products: [product,
        { ...product, metadata: { ...product.metadata, shopify_shop: 'other.myshopify.com' } },
        { ...product, metadata: { ...product.metadata, shopify_mapping_generation: 2 } },
        { ...product, source: 'stripe' },
      ],
      services: [{ ...product, name: 'Legacy product' }],
    }, 'review.myshopify.com', 3)
    expect(preview.map((item) => item.name)).toEqual(['Review mug', 'Legacy product'])
    expect(preview[0]).toEqual({
      name: 'Review mug', price: '$18.00', description: 'Ceramic mug',
      url: product.url, availability: 'available', variants: [{ name: 'Blue', price: '$18.00' }],
    })
    expect(JSON.stringify(preview)).not.toContain('private')
    expect(JSON.stringify(preview)).not.toContain('minPrice')
  })

  it('does not create a checkout link from an unsafe product URL', () => {
    const preview = shopifyCatalogPreview({ products: [{ ...product, url: 'javascript:alert(1)' }] }, 'review.myshopify.com', 3)
    expect(preview[0].url).toBe('')
  })

  it('does not expose products without a valid current mapping', () => {
    expect(shopifyCatalogPreview({ products: [product] }, 'review.myshopify.com', null)).toEqual([])
  })
})

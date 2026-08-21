import { describe, expect, it } from 'vitest'
import { isShopifyLinkPath, SHOPIFY_LINK_PATH } from './shopify-link-flow'

describe('Shopify free connector routing', () => {
  it('recognizes only the isolated Shopify linking surface', () => {
    expect(isShopifyLinkPath(SHOPIFY_LINK_PATH)).toBe(true)
    expect(isShopifyLinkPath(`${SHOPIFY_LINK_PATH}?error=expired`)).toBe(true)
    expect(isShopifyLinkPath('/dashboard/shopify')).toBe(false)
    expect(isShopifyLinkPath('/dashboard/billing')).toBe(false)
    expect(isShopifyLinkPath('/shopify/linking')).toBe(false)
  })
})

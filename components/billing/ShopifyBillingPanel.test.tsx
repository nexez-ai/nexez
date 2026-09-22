// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { render, screen } from '../../test/dom'
import { ShopifyBillingPanel } from './ShopifyBillingPanel'
it('offers only Shopify app-plan management for linked merchants', () => {
  render(<ShopifyBillingPanel billing={{ provider: 'shopify', shop: 'review.myshopify.com', pricingUrl: 'https://admin.shopify.com/store/review/charges/nexez-agent-ready/pricing_plans', planHandle: 'free', status: 'free', verifiedAt: null }} />)
  expect(screen.getByRole('link', { name: 'Manage plan in Shopify' })).toHaveAttribute('href', 'https://admin.shopify.com/store/review/charges/nexez-agent-ready/pricing_plans')
  expect(screen.queryByText(/pay with card|Stripe|Scale/i)).toBeNull()
})
it('offers reconnection when an account retains Shopify origin without an install', () => {
  render(<ShopifyBillingPanel billing={{ provider: 'shopify', shop: null, pricingUrl: '/dashboard/shopify', planHandle: null, status: 'connection_required', verifiedAt: null }} />)
  expect(screen.getByRole('link', { name: 'Connect your Shopify store' })).toHaveAttribute('href', '/dashboard/shopify')
  expect(screen.getByText(/reinstall it from Shopify/)).toBeInTheDocument()
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  page: null as Record<string, unknown> | null,
  redirect: vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`) }),
  headers: vi.fn(async () => new Headers()),
  log: vi.fn(),
}))

vi.mock('../../../lib/supabase', async () => {
  const { createSupabaseMock } = await import('../../../test/supabase-mock')
  return { supabase: createSupabaseMock(() => ({ data: mocks.page, error: null })) }
})
vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
  permanentRedirect: mocks.redirect,
  notFound: () => { throw new Error('NOT_FOUND') },
}))
vi.mock('next/headers', () => ({ headers: mocks.headers }))
vi.mock('next/server', () => ({ after: vi.fn() }))
vi.mock('../../../lib/server/log-checkout-event', () => ({ logCheckoutEvent: mocks.log }))
vi.mock('../../../lib/server/public-identifier', () => ({ resolveRenamedPageSlug: vi.fn(async () => null) }))
vi.mock('../../../components/ApprovedActionForm', () => ({ ApprovedActionForm: () => null }))

import CheckoutPage from './page'

const product = {
  name: 'Test Shopify product', description: '', price: '$25',
  url: 'https://test.myshopify.com/products/test-product',
  prefer_original_for_this: true, source: 'shopify',
}

describe('checkout page original-site handoff', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.page = {
      id: 'test-page', slug: 'test-catalog', name: 'Test catalog',
      is_published: true, currency: 'usd', prefer_original_site: false,
      products: [product], services: [],
    }
  })

  it('redirects an imported Shopify offer before rendering Stripe checkout or logging a checkout view', async () => {
    await expect(CheckoutPage({ params: Promise.resolve({ slug: 'test-catalog' }),
      searchParams: Promise.resolve({ offer: 'products-0' }) })).rejects.toThrow(`REDIRECT:${product.url}`)
    expect(mocks.redirect).toHaveBeenCalledWith(product.url)
    expect(mocks.headers).not.toHaveBeenCalled()
    expect(mocks.log).not.toHaveBeenCalled()
  })

  it('also protects legacy Shopify offers stored as services', async () => {
    mocks.page = { ...mocks.page, products: [], services: [product] }
    await expect(CheckoutPage({ params: Promise.resolve({ slug: 'test-catalog' }),
      searchParams: Promise.resolve({ offer: 'services-0' }) })).rejects.toThrow(`REDIRECT:${product.url}`)
  })

  it('does not redirect to an unsafe provider URL', async () => {
    mocks.page = { ...mocks.page, products: [{ ...product, url: 'javascript:alert(1)' }] }
    mocks.headers.mockRejectedValueOnce(new Error('NORMAL_CHECKOUT_RENDER'))
    await expect(CheckoutPage({ params: Promise.resolve({ slug: 'test-catalog' }),
      searchParams: Promise.resolve({ offer: 'products-0' }) })).rejects.toThrow('NORMAL_CHECKOUT_RENDER')
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it('preserves normal checkout for offers without an original-site preference', async () => {
    mocks.page = { ...mocks.page, products: [{ ...product, prefer_original_for_this: false }] }
    mocks.headers.mockRejectedValueOnce(new Error('NORMAL_CHECKOUT_RENDER'))
    await expect(CheckoutPage({ params: Promise.resolve({ slug: 'test-catalog' }),
      searchParams: Promise.resolve({ offer: 'products-0' }) })).rejects.toThrow('NORMAL_CHECKOUT_RENDER')
    expect(mocks.redirect).not.toHaveBeenCalled()
  })
})

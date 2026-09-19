// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('../../lib/server/shopify', () => ({
  shopifyConfigured: () => true,
  shopifyApiKey: () => 'client-id',
}))
import { GET } from './route'

const linked = {
  state: 'linked', shop: 'review.myshopify.com',
  listing: { name: 'Review Catalog', slug: 'review-catalog' },
  channel: { id: 'channel-1', accountName: 'Review Catalog' },
  sync: { lastSyncedAt: '2026-09-19T12:00:00Z' },
  billing: { status: 'free', pricingUrl: 'https://admin.shopify.com/pricing' },
  storefrontArtifactUrl: 'https://review.myshopify.com/apps/nexez/agent.json',
  catalog: { published: true, products: [{
    name: 'Review mug <script>bad()</script>', price: '$18.00', description: 'Blue & white',
    availability: 'available', url: 'https://review.myshopify.com/products/mug',
    variants: [{ name: 'Blue', price: '$18.00' }],
  }] },
}

async function openApp(data: unknown) {
  vi.stubEnv('SHOPIFY_API_KEY', 'client-id')
  vi.stubEnv('SHOPIFY_API_SECRET', 'secret')
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => data })))
  document.documentElement.innerHTML = await (await GET()).text()
  const code = document.querySelector('body > script')!.textContent!
  window.eval(code)
  await vi.waitFor(() => expect(document.getElementById('preview')).not.toBeNull())
}

describe('Shopify merchant catalog preview', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); document.body.innerHTML = '' })

  it('opens readable products inside the app and preserves their Shopify checkout destination', async () => {
    await openApp(linked)
    expect(document.body.textContent).not.toContain('Open endpoint')
    const raw = document.querySelector('details a') as HTMLAnchorElement
    expect(raw.textContent).toBe('View raw agent JSON')
    expect(raw.href).toBe(linked.storefrontArtifactUrl)
    expect(document.querySelector('details')!.textContent).toContain('machine-readable JSON')
    document.getElementById('preview')!.click()
    expect(document.getElementById('catalog-title')!.textContent).toBe('Catalog preview')
    expect(document.activeElement?.id).toBe('catalog-title')
    expect(document.querySelector('.product h2')!.textContent).toBe(linked.catalog.products[0].name)
    expect(document.querySelector('.product script')).toBeNull()
    expect(document.querySelector('.product')!.textContent).toContain('Blue: $18.00')
    const productLink = document.querySelector('.product a') as HTMLAnchorElement
    expect(productLink.href).toBe(linked.catalog.products[0].url)
    expect(productLink.textContent).toBe('View product on Shopify')
    expect(document.body.textContent).toContain('Shopify handles payment and the order')
    document.getElementById('back')!.click()
    expect(document.activeElement?.id).toBe('preview')
  })

  it('gives actionable instructions for unpublished listings and empty catalogs', async () => {
    await openApp({ ...linked, catalog: { published: false, products: [] } })
    document.getElementById('preview')!.click()
    expect(document.body.textContent).toContain('This Nexez listing is not published')
    expect(document.body.textContent).toContain('No products have been synced')
    expect(document.querySelector('.product')).toBeNull()
    expect(document.getElementById('back')).not.toBeNull()
  })
})

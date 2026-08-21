# Nexez Agent-Ready: App Store listing

Prepared against Shopify's public App Store guidance on 2026-08-20.

## Submission status

Shopify paused review under requirement 1.2.1 on 2026-08-20 after the account-link
journey exposed Nexez's unrelated off-platform subscription UI. The App Store
connector remains free; resubmit after the isolated `/shopify/link` remediation
is deployed and the automated checks have been rerun. Sales Channel classification
remains a separate follow-up risk because Nexez publishes Shopify products to an
external agent-discovery network.

References:

- https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements
- https://shopify.dev/docs/apps/launch/shopify-app-store/best-practices
- https://shopify.dev/docs/apps/launch/app-store-review/app-listing-categories

## Configuration fields

- App name: `Nexez Agent-Ready`
- Primary language: `English`
- Pricing method: `Free to install`
- App charges: `None`
- Online Store required: `Yes`
- Protected customer data: `Not required`
- Geographic requirements: `None`
- Privacy policy: `https://nexez.ai/privacy`
- Terms of service: `https://nexez.ai/terms`
- Support URL: `https://nexez.ai/support`
- Developer website: `https://nexez.ai`
- Demo store URL: add the direct storefront URL after the review store is ready

The emergency developer contact email and phone number must be entered in the
Partner account settings. Confirm that the inbox and phone are actively monitored.

## Public listing copy

### App card subtitle

Make your catalog legible to AI agents while checkout stays on your store.

### App introduction

Publish an agent-readable catalog while keeping every product checkout on your Shopify store.

Character count: 93 of 100.

### App details

Nexez syncs active products into an agent-readable listing, keeps catalog details current after product changes, and serves signed discovery artifacts from your storefront. Connect a listing, refresh products, enable a lightweight theme app embed, and inspect the endpoint AI agents receive. Product links return buyers to your Shopify storefront for checkout. The connector reads products only and does not access customer or order data.

Character count: 438 of 500.

### Feature list

1. Sync active products, variants, prices, and availability into one listing
2. Refresh catalog details automatically after product changes
3. Add agent discovery links with a lightweight theme app embed
4. Serve signed agent-readable artifacts from your storefront domain
5. Inspect and refresh the catalog inside Shopify admin
6. Keep imported product checkout on your Shopify storefront

Each feature is 80 characters or fewer.

### Integrations

Leave the integrations field empty for the initial listing. The connector uses
Shopify directly and the listing should not imply that unrelated Nexez
integrations are included in this app.

### Search terms

Use up to five terms, one idea per term:

1. `AI discovery`
2. `product feeds`
3. `catalog sync`
4. `agent commerce`
5. `machine readable`

## Category decision

Most likely classification if Shopify confirms Sales Channel requirements:

- Primary: `Sales channels > Selling online > Product feeds`
- Secondary: `Sales channels > Selling online > Marketplaces`

Do not select a regular-app category solely to avoid Sales Channel requirements.
If Shopify confirms in writing that Nexez can remain a regular app, ask Shopify
which of `SEO`, `Product content`, or `Advertising - Other` best represents the
agent-discovery use case before submitting.

## Media package

### App icon

- 1200 x 1200 PNG or JPEG
- Square corners; Shopify applies rounding
- Nexez mark only, with generous edge padding
- No text, pricing, screenshots, claims, or Shopify trademarks

### Feature image

- 1600 x 900, 16:9
- One focal point: a product catalog becoming a structured agent endpoint
- Solid, high-contrast background
- No statistics, guarantees, pricing, reviews, or Shopify trademarks
- Suggested alt text: `Product catalog connected to an agent-readable storefront endpoint`

### Desktop screenshots

Capture 3-6 unique 1600 x 900 screenshots without browser chrome or personal data:

1. Embedded app home with the connected listing and catalog status
2. Account-link screen with the listing selector
3. Successful catalog sync with imported product count
4. Theme editor with the Agent-ready discovery app embed selected
5. Storefront agent endpoint showing structured product data
6. Nexez listing showing imported products and links back to the store

Suggested alt text:

1. `Connected Nexez listing and Shopify catalog status in the embedded app`
2. `Choose the Nexez listing that receives the Shopify catalog`
3. `Catalog sync confirmation for active Shopify products`
4. `Agent-ready discovery app embed in the Shopify theme editor`
5. `Agent-readable product manifest served from the storefront domain`
6. `Imported Shopify products with storefront checkout links`

## Listing guardrails

- Do not include rankings, percentages, merchant counts, or performance claims.
- Do not use `best`, `first`, `only`, `guaranteed`, or equivalent claims.
- Do not mention prices outside the designated pricing section.
- Do not include reviews or testimonials in copy or images.
- Do not claim access to customer, order, or checkout data.
- Do not imply that Nexez replaces Shopify checkout.
- Keep the app name aligned with `Nexez Agent-Ready` in `shopify.app.toml`.

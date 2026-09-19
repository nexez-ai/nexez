# Nexez Agent-Ready: reviewer guide

This document is the source for the private testing instructions and screencast
submitted to Shopify. Replace every angle-bracket placeholder before submission.

## Do not submit until

- The current Nexez server release and Shopify app version are both live.
- The sales-channel and billing migration is applied.
- Shopify App Pricing plans and Partner API billing verification are live.
- The review store is unlocked and its storefront agent endpoint is public.
- Partner Dashboard automated checks and mandatory-webhook tests pass.
- A fresh install, uninstall, and reinstall pass on a development store.
- Reviewer credentials below are tested in a private browser window.
- The exact prepared listing is visible to the reviewer account and has no active
  Shopify store connection before submission.
- The embedded app has been opened on the review store after the production
  deployment and confirms the live channel connection.
- A full publish, sync, edit, unpublish, and resync rehearsal passes without
  reusing the prepared reviewer listing.
- The emergency developer contact email and phone are active.

## Reviewer credentials

- Nexez email: `<REVIEW_EMAIL>`
- Nexez password: `<REVIEW_PASSWORD>`
- Prepared listing: `Shopify Review Catalog 2`

The review account must have a confirmed email and full access to this exact
listing. The listing must be present, published, free of personal information,
and unbound from every Shopify store when the submission is sent. Do not tell a
reviewer to choose a fallback listing. If this fixture is unavailable, stop and
repair the testing instructions before submitting. The review account should use
the Shopify Free plan unless a paid-plan test is requested. All plan selection
and app charges occur through Shopify.

## Store prerequisites

- An Online Store sales channel with an active theme
- Storefront password protection disabled so the app-proxy artifact is publicly
  crawlable during review
- At least two active, published products
- One product with multiple variants if possible
- No real customer or order data is required

The app supports a fresh review store. It does not require the shop to be
pre-provisioned in Nexez before installation.

## Paste-ready testing instructions

1. Install `Nexez Agent-Ready` on a review store and open it from Shopify admin.
2. Confirm the embedded home loads and shows `Account link needed` without a web error.
3. Click `Continue to Nexez`. This user-initiated top-level handoff opens the secure account-link flow.
4. Sign in with the Nexez reviewer credentials above.
5. Select the exact listing `Shopify Review Catalog 2`, then click `Connect this listing`.
6. Return to the embedded app. Confirm the Sales channel card says Shopify confirmed the channel for `Shopify Review Catalog 2`.
7. Click `Open products`. Open `Manage publishing` for at least two active products and publish them to `Nexez AI discovery`.
8. Reopen Nexez Agent-Ready and click `Sync now`. Confirm the success message reports the number of channel-published products imported.
9. Click `Preview catalog`. This opens a readable catalog inside the embedded app. Confirm the store name, sync time, and imported products. `Back to app` returns to the app home.
10. Compare an imported product name, description, variants, price, currency, availability, and storefront URL against Shopify admin.
11. Change that product's price in Shopify, save it, run `Sync now`, and confirm the new price appears in `Preview catalog`.
12. Remove one test product from `Nexez AI discovery`, run `Sync now`, and confirm that product is removed from the preview while the other product remains.
13. Click `Open theme editor`, enable `Agent-ready discovery`, and click `Save`.
14. In `Preview catalog`, click `View product on Shopify`. Select a variant, add the product to the cart, and continue to Shopify checkout. On a development store with the Bogus Gateway enabled, complete a test transaction and confirm the test order in Shopify admin. Do not place a real paid order for this review.
15. Open `Manage plan in Shopify`. Confirm plan selection and any app charge remain inside Shopify.
16. Expand `Agent data for developers` and click `View raw agent JSON`. This deliberately opens `/apps/nexez/agent.json`, a machine-readable data feed. A browser pretty-print viewer is expected for this developer link. It is not a customer checkout page. On an unlocked storefront, confirm HTTP 200 and matching published products.

Expected result: the app reads only active published products, keeps discovery
artifacts available from the storefront domain, and leaves every product purchase
on the merchant's Shopify storefront.

## Customer journey and store boundaries

1. The merchant connects a Shopify store to one Nexez listing and publishes
   selected active products to the Nexez AI discovery channel.
2. An AI agent reads the structured product data, including the product's
   original Shopify URL. The embedded catalog preview presents those imported
   fields in a readable view for the merchant.
3. The customer follows the product URL to that merchant's Shopify storefront,
   selects a variant, adds it to the cart, and completes Shopify checkout.
4. Shopify processes payment and creates the order. Nexez does not request
   customer or order access and does not process this product payment.
5. A second store connects to a different listing. Products retain their source
   store's URLs. There is no combined cart, cross-store payment, or shared order.

The review recording must show this journey through a test order, not stop at
the product data feed. Show the source store domain at the catalog, product,
cart, checkout, and Shopify order confirmation steps. Use a separate rehearsal
listing so the prepared reviewer listing remains available for Shopify's store.

## Important behavior for reviewers

- Requested scopes: `read_products`, `read_product_listings`, `write_app_proxy`
- Admin catalog API: versioned GraphQL Admin API
- Customer data: not requested or stored
- Order data: not requested or stored
- Billing: Shopify App Pricing only
- Catalog cap: up to 250 active published products per sync
- Store relationship: one active Shopify store per Nexez listing
- Product selection: catalog reads are scoped to the exact channel connection
  handle instead of an app-level current publication
- Product updates: contextual product-feed events queue a bounded refresh, and
  `Sync now` runs an immediate channel-scoped reconciliation
- Uninstall: tokens are revoked and that shop's imported offers are removed
- Final redaction: the remaining installation record is deleted

## Error-path checks

1. Open the embedded app with an invalid or expired session token: the server returns an authentication error and no shop data.
2. Try linking a listing already connected to another active store: the app returns a clear conflict and does not relink either store.
3. Remove or expire the installation credential: manual sync asks the merchant to reconnect and does not expose the token.
4. Trigger a transient catalog error: the app preserves the existing catalog and reports an attention state.
5. Uninstall and reinstall: the old listing link is not silently restored; the merchant must explicitly link again.

## Review screencast script

Record one clear English screencast with no cuts that hide setup steps:

1. Start on the Nexez Agent-Ready installation screen in Shopify admin and show the install action and OAuth grant.
2. Open the newly installed embedded app and show `Account link needed`.
3. Click `Continue to Nexez`, sign in, explicitly select a separate rehearsal listing, and connect it. Explain that Shopify's reviewer should select the unbound `Shopify Review Catalog 2` fixture from the private instructions.
4. Return to Shopify admin and show the confirmed `Nexez AI discovery` sales channel connection.
5. Use `Open products` and Shopify's `Manage publishing` action to publish two products to `Nexez AI discovery`.
6. Run `Sync now`, show a successful import count, and open `Preview catalog`.
7. Compare one product's name, variant, price, availability, and storefront URL between Shopify and the preview.
8. Change the product price in Shopify, save, sync again, and show the same change in the preview.
9. Unpublish the second product from `Nexez AI discovery`, sync again, and show that only the unpublished product was removed.
10. Enable and save the theme app embed. Explain `Agent data for developers` and its explicitly labeled `View raw agent JSON` link. Show the HTTP 200 response on an unlocked storefront; disclose any development-store password gate.
11. Follow `View product on Shopify`, choose a variant, add to cart, continue to checkout, and complete a Bogus Gateway test order. Show its confirmation in Shopify admin. Keep test mode visible and use no real customer data or payment card.
12. Explain that a second store uses a different listing and its own product URLs, cart, checkout, and orders. There is no combined cross-store checkout. Do not simulate or imply a second connection that has not been demonstrated.
13. Open Shopify App Pricing and show that app plan management remains in Shopify.
14. End on the connected embedded home with its verified channel and latest successful sync time.

Use the private review screencast field for this walkthrough. Public feature
media should be promotional and follow Shopify's separate media guidance.

## Support and legal links

- Support: https://nexez.ai/support
- Privacy: https://nexez.ai/privacy
- Terms: https://nexez.ai/terms
- Developer website: https://nexez.ai

## Final Partner Dashboard actions

1. Submit in the Sales Channel category and set `Merchant must have online store`.
2. Configure Shopify App Pricing with Free, Launch, Pro, and Scale plans.
3. Opt out of protected customer data because the app requests none.
4. Upload the icon, feature media, screenshots, and alt text from `APP_STORE_LISTING.md`.
5. Paste these testing instructions and valid credentials into the private review section.
6. Add the screencast URL.
7. Add the emergency developer contact email and phone number.
8. Run every automated check and mandatory-webhook test.
9. Submit only after every critical requirement is green.

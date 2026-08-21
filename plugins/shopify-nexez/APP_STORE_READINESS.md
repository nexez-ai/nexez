# Shopify App Store readiness

Last reviewed against Shopify's public requirements: 2026-08-20.

## Code-backed requirements

- [x] Embedded app home is configured with `embedded = true`.
- [x] Latest App Bridge CDN script is the first script in the embedded document.
- [x] Embedded backend calls use Shopify ID tokens instead of third-party cookies.
- [x] ID tokens verify HS256 signature, audience, expiry, not-before time, issuer,
  destination, Shopify shop domain, user, and session.
- [x] Session-token exchange establishes rotating offline Admin API credentials.
- [x] Existing rotating credentials refresh before expiry, with token rotation
  persisted atomically.
- [x] Reinstalls clear old owner/listing links and require an explicit relink.
- [x] Account linking crosses the iframe boundary with a ten-minute, single-use,
  hashed credential.
- [x] `app/uninstalled` immediately clears credentials and the active listing
  connection, then removes that shop's imported offers. Service-role cleanup
  pointers remain only until Shopify sends `shop/redact`.
- [x] `customers/data_request`, `customers/redact`, and `shop/redact` are declared,
  HMAC verified, and handled. Nexez stores no Shopify customer data.
- [x] Product create/update/delete webhooks queue bounded background reconciliation.
- [x] Catalog reads use the versioned GraphQL Admin API, not the legacy REST Admin API.
- [x] Requested scopes are limited to `read_products,write_app_proxy`.
- [x] Synced Shopify offers retain Shopify storefront URLs as their purchase path.
- [x] One active Shopify store can feed a listing at a time, enforced in both the
  link route and the database.
- [x] Moving or uninstalling a store removes only that store's imported catalog;
  manual offers and another explicitly scoped store are preserved.
- [x] Embedded CSP permits Shopify admin framing without opening the page to arbitrary origins.
- [x] Theme editor deep link is available after linking.
- [x] Privacy and support destinations are visible from the embedded app.
- [x] Account linking uses a user-initiated top-level navigation supported by the
  current Shopify App Bridge Navigation API, with no popup dependency.
- [x] An authenticated Shopify admin can change the linked Nexez listing without
  uninstalling the app. Nexez authentication and listing edit access are checked
  again before the move, and only the old Shopify-imported catalog is removed.

## Submission blocker requiring Shopify confirmation

### 1. Distribution classification

Nexez publishes a merchant's Shopify products to an external agent-discovery
network. Shopify describes apps that publish products from Shopify to another
platform as sales channels. Confirm classification with Shopify before review.
If Shopify requires the Sales Channel model, the app will also need the channel
flag, channel-specific scopes, Shopify checkout/order handling, account controls,
and the full Sales Channel review checklist.

### 2. Billing source: resolved as a free connector

- [x] Account linking and first catalog import are not plan gated.
- [x] Embedded manual sync is not plan gated.
- [x] Product-webhook reconciliation is not plan gated.
- [x] Listing-settings sync bypasses the plan gate only for a verified OAuth app
  installation; manually supplied Shopify tokens retain Nexez plan controls.
- [x] Theme discovery links and the storefront proxy are free app functionality.

The embedded Shopify app does not present off-platform pricing or withhold its
Shopify functionality behind a Nexez subscription.

#### 2026-08-20 core-review remediation (requirement 1.2.1)

Shopify paused review under requirement 1.2.1 after the account-link journey
entered the general Nexez dashboard, where unrelated Stripe subscription and
upgrade surfaces were reachable. The connector remains free; the remediation is
to keep the complete App Store journey outside those surfaces.

- [x] Move the listing picker from `/dashboard/shopify` to the standalone
  `/shopify/link` route, outside the paid dashboard shell.
- [x] Send OAuth callbacks, one-time claims, relinks, and expired-link recovery
  through `/shopify/link`.
- [x] Let Shopify-origin sign-in and account creation return directly to the
  free connector instead of mandatory Nexez plan onboarding.
- [x] Remove Pricing, Start Free, and other paid-plan links from the
  Shopify-origin authentication screen.
- [x] State that the manual Admin API token importer is a separate Nexez platform
  tool and is not installed or used by the App Store connector.
- [ ] Deploy the server remediation and verify the fresh-install reviewer flow.
- [ ] Re-run Shopify's automated checks and submit the requirement fixes.

### 3. Checkout boundary

The current importer keeps each Shopify product's storefront URL as its preferred
purchase action. Preserve this invariant. A regular Shopify app must not route a
Shopify-origin purchase around Shopify checkout.

## Partner Dashboard and listing work

Validation evidence from 2026-07-13:

- Shopify CLI `app build` passed the production config and theme-extension checks.
- The full suite passed after the relink work: 254 test files, 1,971 tests. Lint,
  palette guard, TypeScript, and the production build also passed.
- The live embedded app authenticated, moved from the negotiation gauntlet to the
  dedicated `Shopify Review Catalog`, and completed a manual sync with 13 active
  products imported. The gauntlet retained its 64 non-Shopify offers.
- The theme editor showed `Agent-ready discovery` enabled with `/apps/nexez` as
  the storefront proxy path.
- The review catalog is published. Its public page, `agent.json`, and `llms.txt`
  return 200; the agent artifact contains all 13 products; and a checkout dry run
  resolves to the original Shopify product URL.
- Four final 1600 x 900 desktop captures are under `app-store-media/final/`. The
  final icon is under `app-store-media/`.
- Public distribution is selected in Partner Dashboard. Shopify now requires the
  App Store registration declarations and one-time $19 payment before the listing
  editor and submission checklist are available.

- [ ] Confirm regular-app versus Sales Channel classification with Shopify.
- [x] Implement and test the free-connector billing path.
- [ ] Complete Shopify App Store registration with truthful business/account
  declarations and the one-time registration payment.
- [ ] Mark the Online Store sales channel as required because the theme app embed
  and app proxy depend on a storefront.
- [ ] Add an emergency developer contact.
- [x] Verify current privacy-policy, terms, and support URLs resolve publicly.
- [ ] Enter the verified legal, support, and data-use URLs in Partner Dashboard.
- [x] Prepare truthful listing copy without rankings, guarantees, or statistics
  in `APP_STORE_LISTING.md`.
- [x] Capture final desktop screenshots.
- [ ] Capture the required mobile-admin screenshot set.
- [x] Prepare the English onboarding screencast script and complete reviewer flow
  in `REVIEWER_GUIDE.md`.
- [ ] Record the onboarding screencast: install, connect account, choose listing,
  sync catalog, enable app embed, inspect agent endpoint.
- [ ] Provide durable review credentials with access to the complete feature set.
- [ ] Run the Partner Dashboard automated quality checks and mandatory-webhook test.
- [ ] Test fresh install, uninstall, reinstall, token refresh, link expiry, webhook
  sync, product deletion, and mobile admin. Manual sync and theme activation are
  verified.
- [ ] Move the review store to an unlock-eligible Shopify state, disable password
  protection, and confirm `/apps/nexez/agent.json` resolves to structured data
  without a storefront-password redirect. Shopify currently disables the
  password toggle because the store is in development.

## Release commands

```bash
cd plugins/shopify-nexez
npx @shopify/cli app deploy
```

Release the generated version only after the matching Nexez server deployment is
READY and the Supabase one-active-shop-per-listing migration has been applied.

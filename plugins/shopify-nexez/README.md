# Nexez Agent-Ready Shopify app

Makes a Shopify store agent-legible via the merchant's [Nexez](https://nexez.ai)
listing. Two parts:

- **Embedded app home** (`/shopify`) runs inside Shopify admin with the latest
  App Bridge, authenticates every backend request with a short-lived Shopify ID
  token, and exposes account linking, catalog status, manual sync, theme setup,
  and the storefront agent endpoint.
- **Theme app extension** (`extensions/agent-ready/`) ships same-origin manifest
  and agent-summary discovery links, plus an optional verification `<meta>`, in
  the storefront `<head>`.
- **App server routes** (in the main Nexez Next app) provide OAuth installation,
  mandatory webhooks, and an **App Proxy** that serves the full live artifacts
  under the shop's own domain. All are **inert** until `SHOPIFY_API_KEY` /
  `SHOPIFY_API_SECRET` are set (every route 404s / 401s without them).

## Why a theme extension isn't enough on its own

A Shopify theme app extension renders in Liquid and **cannot** fetch `embed.json`
at render time or intercept `/.well-known/*` and issue 301s (Shopify doesn't let
apps take over arbitrary storefront routes). So the extension alone gives agents
the manifest **link**; the full JSON-LD + artifact redirects are delivered by the
**App Proxy** (`/apps/nexez/agent.json`, `/apps/nexez/llms.txt`, and the other
allowlisted child paths on the storefront) once the app is installed and linked.
Shopify signs each request, Nexez resolves the linked listing, and Shopify follows
the response to the live `nexez.app/<slug>/<artifact>` resource.

## Server routes

| Route | Host | Purpose |
| --- | --- | --- |
| `GET /shopify` | app.nexez.ai | Embedded, cookie-independent App Bridge home |
| `GET /shopify/link` | app.nexez.ai | Free, top-level account/listing link flow isolated from Nexez billing UI |
| `POST /api/shopify/session` | app.nexez.ai | Verify Shopify ID token, exchange/refresh offline credentials, load shop state |
| `POST /api/shopify/session/sync` | app.nexez.ai | Exact-shop catalog refresh authenticated by the Shopify session |
| `GET /api/shopify/claim` | app.nexez.ai | Consume a one-time token and continue top-level Nexez account linking |
| `GET /api/shopify/auth` | app.nexez.ai | OAuth install start (SSRF-pinned shop, CSRF state) |
| `GET /api/shopify/callback` | app.nexez.ai | HMAC + state verify -> expiring offline credentials -> `shopify_installs` |
| `POST /api/webhooks/shopify` | app.nexez.ai | `app/uninstalled` + GDPR (HMAC-verified) |
| `GET /api/shopify/proxy` | app.nexez.ai | App-Proxy-signed artifact delivery |

Data: `shopify_installs` (migrations `20260711015728` and `20260712222518`)
maps a shop domain to a Nexez owner/listing plus encrypted, rotating offline
credentials. The table is service-role only. Access tokens are refreshed before
expiry, refresh-token rotation is persisted atomically, and uninstall/GDPR
webhooks revoke the local connection state. Embedded account-link tokens are
random, stored only as SHA-256 digests, expire after ten minutes, and are
atomically cleared on first use.

## Catalog sync

After a merchant links the installed shop to a Nexez listing, Nexez immediately
imports the active, published storefront catalog at no additional connector
charge. The same OAuth installation powers later manual syncs from listing
settings; merchants never paste an Admin API token into Nexez.

Product create, update, and delete webhooks enqueue a debounced catalog refresh.
A bounded five-minute worker reconciles up to 250 active products per pass,
retries transient failures, and reports attention state in listing settings.
Webhook requests never wait on the Shopify Admin API. Deleted or unpublished
Shopify items are pruned only when Shopify confirms the fetched catalog is
complete, and only from that exact shop; manual offers and other connected shops
remain untouched.

Catalog reads use Shopify's GraphQL Admin API and preserve the store currency,
product and variant IDs, storefront URLs, availability, sellable quantity, and up
to ten variant tiers. Nexez stores the product URL as the preferred transaction
path so buyers and agents complete the purchase on the merchant's Shopify store.

## Release and merchant activation

1. Create the app in your **Shopify Partner** dashboard; copy Client ID/secret and
   set `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` in the Nexez environment, plus
   `INTEGRATION_SECRET_KEY` for token encryption.
2. Keep the embedded App URL, `read_products,write_app_proxy` scopes, redirect URL, App Proxy,
   compliance topics, and catalog-change webhooks in `shopify.app.toml`
   synchronized with production.
3. Run `shopify app deploy` (the theme extension has its own release lifecycle,
   separate from the Vercel `next build`).
4. Install the app, link the shop to a Nexez listing, confirm the initial catalog
   sync, then use the post-link theme editor button to activate and save the
   Agent-ready discovery app embed.
5. Resolve every blocking decision in `APP_STORE_READINESS.md`, then complete the
   listing, screencast, test credentials, privacy details, and quality checks.

Existing installations created before expiring offline tokens were enabled must
approve OAuth again once. Installations must also approve OAuth whenever requested
scopes change. The addition of `write_app_proxy` therefore requires
reauthorization.

## App Store billing model

The Shopify-installed connector is free: account linking, initial import, manual
sync, webhook reconciliation, theme discovery links, and the signed storefront
proxy do not depend on a Nexez subscription. This avoids off-platform billing for
the public app's Shopify functionality. Shopify OAuth callbacks and sign-in return
to `/shopify/link`, which deliberately sits outside the general Nexez dashboard,
plan onboarding, Billing navigation, and Stripe subscription surfaces. Manually
supplied Shopify credentials are part of Nexez's separate integrations product
and are not installed, linked, or used by this app.

Before App Store submission, confirm whether Shopify classifies Nexez's external
agent-discovery distribution as a Sales Channel. That classification is separate
from the connector billing implementation.

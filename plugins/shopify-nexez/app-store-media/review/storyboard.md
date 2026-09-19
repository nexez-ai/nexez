# Nexez Agent-Ready Shopify review screencast

Updated for the September 18 review: requirements 4.5.3 and 2.1.1.
Target duration: 08:00 to 10:00, adjusted to the actual UI.

Record the real deployed app with English narration or captions. Do not hide
setup steps, fabricate a successful transaction, or present a local fixture as
production evidence. Protect passwords and login tokens. Keep store domains,
product names, and selected listing visible. Keep the prepared
`Shopify Review Catalog 2` listing unbound for Shopify's reviewer; use the
separate `Shopify Review Rehearsal` listing for recording and disclose this.

| Scene | Required visual proof | Explanation |
| --- | --- | --- |
| Installation | Install screen, requested scopes, install action, and first embedded open | Only product and app-proxy access is requested |
| Account connection | Continue to Nexez, sign-in, explicit rehearsal listing selection, confirmation | Each store connects to one listing; reviewer fixture is separate |
| Channel verification | Sales channel card names the connected listing | Shopify confirms the exact channel connection |
| Product publication | Two active test products published to Nexez AI discovery | Merchant controls which products agents can discover |
| Catalog sync | Sync now, success count, latest sync time | Selected Shopify products are imported |
| Human preview | Preview catalog, product names, prices, variants, availability, Back to app | Merchants have a readable catalog inside Shopify admin |
| Update proof | Change a price in Shopify, save, sync, show changed preview value | Product changes synchronize |
| Unpublish proof | Unpublish one product from the channel, sync, show it removed | Other published products remain available |
| Discovery | Enable and save Agent-ready discovery in the theme editor | Storefront advertises machine-readable discovery links |
| Developer data | Expand Agent data for developers, open View raw agent JSON | JSON and browser pretty-print are expected for the explicitly labeled data feed |
| Customer journey | View product on Shopify, original product page, variant selection, add to cart | Customer follows the source store's product URL |
| Transaction | Shopify checkout, visible test payment mode, order confirmation, test order in admin | Shopify processes payment and owns the order; Nexez does not collect it |
| Store boundaries | Source domain visible throughout the journey; optional second real store if available | Each store has its own listing, catalog, cart, checkout, and orders |
| App billing | Manage plan in Shopify and Free plan | App subscription billing also stays within Shopify |
| Final state | Connected home, verified channel, successful sync | Return to a working merchant screen |

## Acceptance checks

- The published release includes the catalog preview fix.
- Show installation and account linking, or retain a clearly labeled complete
  existing installation segment followed by the new functionality walkthrough.
- All claims in the captions match visible behavior.
- The customer journey reaches a confirmed test order, not only a product page.
- Test mode is visible and no real payment is submitted.
- Products and checkout stay on the originating Shopify store.
- An inaccessible endpoint or password-protected storefront is disclosed, not
  edited out or described as publicly crawlable.
- The reviewer fixture remains available for Shopify's independent review.
- Inspect the final encoded video, audio, and captions before upload.

## Evidence status

This document is a recording plan, not proof that the recording or test order
has been completed. Record actual evidence and its URL in the dated review
response before marking either Shopify requirement resolved.

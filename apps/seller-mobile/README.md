# Nexez Seller Hub

Expo + React Native mobile seller app for Nexez.

## Run

```bash
cd apps/seller-mobile
npm install
npm run ios
# or
npm run android
# or
npm run web
```

## Environment

`apps/seller-mobile/.env.local` is already present (gitignored) and pre-filled with the
project's **public** Supabase URL + publishable key and a `https://nexez.app` API base, so
the app connects out of the box. Override the API base to your local web server when running
the Next app alongside it:

```bash
EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY
EXPO_PUBLIC_NEXEZ_API_URL=http://localhost:3000        # simulator + web handoffs
EXPO_PUBLIC_AGENT_RUNTIME_URL=http://localhost:3000    # public page previews
```

Only `EXPO_PUBLIC_*` values belong here, and only public ones. Never add
`SUPABASE_SERVICE_ROLE_KEY`, Stripe secret keys, webhook secrets, or other private server
secrets to the mobile app.

Native Firebase client configs come from the canonical `nexez-seller-hub` Firebase project.
Local builds use the gitignored `google-services.json` and `GoogleService-Info.plist` files in this
directory. EAS builds receive the same files through secret file variables named
`GOOGLE_SERVICES_JSON` and `GOOGLE_SERVICE_INFO_PLIST` in every build environment.

## Design system

Built to `design_handoff_seller_hub/` - the **persimmon glass** language (matches the web brand):
`#ff6a33` accent, glass **ring** buttons (not fills), Space Grotesk numerals / Manrope body /
JetBrains Mono slugs, SVG conic readiness rings, gradient avatar, and a center **Create FAB**
tab bar. Tokens live in `src/theme/colors.ts`; reusable primitives in `src/components/ui.tsx`
(`Screen`, `StackHeader`, `GlassCard`, ring `AppButton`, `ReadinessRing`, `TrafficSplit`,
`MetricCard`, `Badge`, `GroupCard/GroupRow`). Every drill-down screen uses `StackHeader` for a
consistent back affordance.

## Live In Phase 1

- Supabase email/password sign in, sign up, reset email, and encrypted session persistence.
- Bottom tabs: Overview · Listings · **Create (FAB)** · Inbox · Settings (Analytics opens from Overview).
- Every screen rebuilt to the handoff: Overview, Listings, Listing Detail, Readiness, Analytics, Inbox (+ detail), Settings, Simulator, Billing, Integrations, Offers, Create/Edit, Importer, Support.
- Overview metrics from RLS-safe seller reads: pages, agent visits, checkout events, negotiations, orders, reviews.
- Listings list, detail, readiness, publish toggle, preview handoff, create, and edit.
- Analytics cards/lists for agent traffic, top agent types, top pages, conversions, and recent events.
- Inbox tabs for negotiations, direct orders, reviews, and buyer requests (refund requests +
  problem reports, with an open-count badge) - all from RLS-safe reads.
- Pull-to-refresh on Overview, Listings, Analytics, Inbox, and the detail screens (silent
  background reload, content stays mounted).
- Negotiation and order details use the platform's server-authoritative accept, counter, decline,
  escrow, request-status, and refund routes. Web links remain available as a fallback.
- Per-offer negotiation rule authoring mirrors the platform fields, preserves advanced and future
  rule metadata, and shows stored rule-evaluation checks and reasons in negotiation details.
- The former competitor ranking is now an explicitly owner-only portfolio-readiness comparison.
  Real external competitor analysis opens the signed-in Agent Lab web experience.
- Billing summary reads `billing_subscriptions`, pages, and checkout events.
- Expo Notifications registration foundation writes to `user_push_tokens` (keyed by `user_id`) through RLS.
- Foreground and cold-start notification taps route to allowlisted seller screens after auth is ready. Paid-order and negotiation pushes open their exact records when the server includes a durable ID; older payloads fall back to the relevant inbox list.

## Scaffolded / Web Handoff

- Native mobile authentication uses email and password in this release. Google, passkey, and verified-phone sign-in remain available on the web.
- Stripe customer portal, Connect onboarding, review moderation, API keys, custom domains, team access, login-phone settings, and account data controls hand off to existing secure web routes.
- The mobile integration catalog mirrors all platform connectors: Calendly, Shopify, Square, Acuity, Stripe, Google Calendar, WooCommerce, and ServiceM8. Listing-scoped connection flows finish on the web dashboard.
- Integration OAuth, sync management, live connector status, and team administration remain explicitly web-managed. Mobile summarizes the connector catalog, plan availability, and Stripe payout readiness without implying native management.
- Website imports preserve the entered source in the canonical `/create?url=<encoded-url>` web handoff. File and provider imports continue to the web Tools page.
- In-app deal actions cover accept, counter, decline, approve, capture, cancel, buyer-request resolution, and full or partial refunds, each behind a confirmation. They call `/api/negotiations/transition`, `/api/negotiations/escrow`, `/api/orders/request-status`, and `/api/orders/refund`. These production routes accept either the web cookie session or an `Authorization: Bearer <token>` through `lib/server/request-auth.ts`, while retaining the platform's Stripe, ownership, transition, and ledger authority. "View on web" remains available as a fallback.

## Build & release (EAS)

The app is linked to `@nexez-ai/nexez-seller-hub`. `eas.json` defines physical-device,
simulator, preview, and production profiles, and `app.json` carries the
`app.nexez.sellerhub` bundle identifier and Android package. The complete device matrix and
evidence requirements are in [RELEASE_CERTIFICATION.md](./RELEASE_CERTIFICATION.md).

The four required public client values and two native Firebase file variables are registered in
the EAS development, preview, and production environments. Review their names without printing
values:

```bash
cd apps/seller-mobile
npx eas-cli whoami
npx eas-cli env:list --environment development --environment preview --environment production
```

**Builds**

```bash
npx eas-cli build --profile development-simulator --platform ios  # local simulator dev client
npx eas-cli build --profile development --platform ios            # registered physical iOS device
npx eas-cli build --profile preview --platform android             # installable Android APK
npx eas-cli build --profile production --platform all              # store binaries
npx eas-cli submit --profile production --platform ios             # TestFlight / App Store
```

The `preview` Android profile (`buildType: apk`) is the quickest way onto a real device - it needs
no Apple account and is the right target for the physical-device **push** test (the simulator can't
get a remote push token). The API base is pinned to `https://app.nexez.ai` in the build env, so the
in-app deal actions + pushes work against prod once the **web app is deployed**.

## Verification

Run the cross-app drift gate from the repository root whenever a platform contract or the seller
app changes:

```bash
npm run check:mobile-platform-contracts
```

Then run the mobile-owned gates from `apps/seller-mobile`:

```bash
npm run check:release-config
npm run certify:distribution
npm run typecheck
npm test
npm run lint
npm run check:expo-deps
```

The root contract gate checks every mobile API Route Handler plus public-name rules, seller
notification payloads, connector capabilities, entitlement schema and feature keys, negotiation
statuses and rules, secure feature boundaries, and web handoffs. The paths-filtered `Nexez Seller Hub`
workflow runs typecheck, the mobile-owned Vitest suite, Expo lint, and the SDK compatibility check
on every mobile PR. The route suite covers custom-scheme and Nexez web links, notification payload
fallbacks, foreign hosts, malformed inputs, traversal attempts, and unsafe record IDs.

## Notes

The root Next app is intentionally not converted into a workspace yet. This app has its own `package.json`, `package-lock.json`, and `tsconfig.json`. The root `tsconfig.json` and ESLint config exclude `apps/seller-mobile` so the existing web app keeps its current toolchain.

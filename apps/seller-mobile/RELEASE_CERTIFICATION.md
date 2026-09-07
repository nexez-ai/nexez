# Nexez Seller Hub release certification

This document is the release evidence checklist for the seller app. Automated gates establish that
the bundle and platform contracts are internally consistent. Device rows must be completed on real
hardware before a store release is approved.

## EAS project

- Owner: `nexez-ai`
- Project: `nexez-seller-hub`
- Project ID: `0ebc7964-9099-4b42-b569-da181c30d155`
- iOS bundle identifier: `app.nexez.sellerhub`
- Android package: `app.nexez.sellerhub`
- Firebase project: `nexez-seller-hub`
- Firebase Android app: production EAS signing certificate SHA-1 and SHA-256 registered

Build profiles:

| Profile | Target | Distribution | Environment |
|---|---|---|---|
| `development` | Physical iOS or Android development client | Internal | `development` |
| `development-simulator` | iOS Simulator development client | Internal | `development` |
| `preview` | Android APK and internal preview | Internal | `preview` |
| `production` | App Store and Play Store binary | Store | `production` |

EAS holds these public client values for development, preview, and production:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `EXPO_PUBLIC_NEXEZ_API_URL`
- `EXPO_PUBLIC_AGENT_RUNTIME_URL`

EAS also holds the canonical native Firebase client configs as secret file variables:

- `GOOGLE_SERVICES_JSON`
- `GOOGLE_SERVICE_INFO_PLIST`

Never add a Supabase secret or service-role key, Stripe secret, webhook secret, or server token to
an `EXPO_PUBLIC_*` variable.

## Automated certificate

Run from `apps/seller-mobile`:

```bash
npm run certify:distribution
```

The command validates release configuration and artwork, TypeScript, the mobile Vitest suite,
Expo lint, SDK dependency compatibility, the static web bundle, mobile-platform contract parity,
and the repository prose policy.

Latest local result: pass. The distribution certificate completed with 19 mobile test files and
158 tests, 7 platform-contract test files and 45 tests, a 40-route static web export, clean Expo
lint, compatible Expo dependencies, and a clean repository prose check. Earlier platform
verification also passed all 21 `expo-doctor` checks and found no lint errors in the linked
`public` and `private` database schemas; those two checks were not repeated for this build slice.

## Phase 6 build evidence

| Platform | Profile | EAS build ID | State | Notes |
|---|---|---|---|---|
| Android | `preview` | `19333002-552b-458c-8846-06454ef14b79` | Finished | Internal APK with EAS-managed signing, completed `2026-08-30T03:58:18.036Z` |
| iOS Simulator | `development-simulator` | `a23ac1a8-8695-40ae-b0b9-88ef8df918b8` | Finished | Installed and launched on iPhone 16e, completed `2026-08-30T03:57:10.048Z` |
| iOS Simulator | `development-simulator` | `070cf537-8912-42e8-899d-bc2bb3b1d8e9` | Service error | Compile finished, then Expo failed to upload the application archive |

These certification builds archive the current working tree, which also contains concurrent Nexxi
work, while EAS metadata displays the last commit on the branch. They are not production release
candidates. Build the store candidates only after the intended seller changes are reviewed and
committed from a clean source tree, then rerun the automated certificate against that exact source.

Local execution constraints for this pass:

- The iOS build installed and ran on an iPhone 16e simulator with iOS 18.6. Metro bundled 3,700
  modules without a startup exception, the signed-out login gate rendered, and a protected order
  deep link remained behind authentication.
- The Android APK has SHA-256
  `c31dd3879f254df6f30583ad401f9e34803d06baae7369d2fd604ae245cd2abb`. Android build tools
  verified its v2 RSA signature and confirmed package `app.nexez.sellerhub`, version `1.0.0`,
  version code `1`, target SDK 36, notification permission, and `MainActivity` launcher metadata.
- The Google API 34 ARM system image was restored without deleting or resetting the existing
  `Kismet_API_34` AVD. The preview APK installed and cold-launched through `MainActivity`, rendered
  the signed-out login screen, and reported no fatal Android or React Native log entry. A protected
  order deep link was delivered to the running app and failed closed with `Sign in required.`
- No physical iOS or Android device is connected. Physical push and signing rows remain pending.

## Build commands

EAS allocates production build numbers remotely and requires a clean committed source tree.
The local `ios.buildNumber` and `android.versionCode` values are development defaults; they are
not the source of truth for store builds. Before the first build after switching to remote
versioning, use `eas build:version:get --platform all --profile production --json` and initialize
each platform with `eas build:version:set` to at least its last issued build number. The last
issued Android production version was `2`; the last iOS simulator version was `1`.

Build from an isolated clean checkout so unrelated untracked files are not uploaded. Run the
automated certificate against that checkout, record its full Git SHA and tree hash, and keep
the EAS build IDs with the resulting artifact versions. A build alone does not satisfy the
physical-device matrix or authorize a store submission.

```bash
npx eas-cli build --platform android --profile production --non-interactive --freeze-credentials
npx eas-cli build --platform android --profile preview
npx eas-cli build --platform ios --profile development-simulator
npx eas-cli build --platform ios --profile development
npx eas-cli build --platform ios --profile production
```

The simulator build can validate layout and most application behavior. Remote push receipt,
permission prompts, background delivery, terminated-state delivery, and production signing require
physical hardware.

## Test data rules

- Use a dedicated QA seller account and non-live Stripe fixtures where possible.
- Prefix disposable listings with `QA Mobile` and record every created row ID.
- Never capture or refund real customer funds for certification.
- Remove disposable listings, negotiations, requests, push tokens, and uploaded files after the run.
- Preserve failure evidence before cleanup, including the build ID, platform, app build number, test
  account ID, timestamp, route, and screenshot or screen recording.

## Physical-device matrix

Record `Pass`, `Fail`, or `Blocked` plus evidence for each platform. A simulator result cannot be
used as evidence for a row marked physical-only.

| Area | Scenario | Expected result | iOS evidence | Android evidence |
|---|---|---|---|---|
| Authentication | Email/password login | Correct account opens Overview | Pending | Pending |
| Authentication | Invalid password | Inline error, no session created | Pending | Pending |
| Authentication | Reset email | Confirmation shown without account disclosure | Pending | Pending |
| Authentication | Logout and relaunch | Session is cleared | Pending | Pending |
| Authentication | Session restoration | Valid encrypted session restores once | Pending | Pending |
| Listings | Create a listing | Draft is owner-scoped and editable | Pending | Pending |
| Listings | Edit and rename | Data and public name persist after refresh | Pending | Pending |
| Listings | Publish and unpublish | State matches the web platform | Pending | Pending |
| Public names | Reserved, short, malformed, and taken | Submission is blocked with the canonical message | Pending | Pending |
| Public names | Available and grandfathered | Available name saves; existing grandfathered name remains editable | Pending | Pending |
| Intake | Create, resume, commit, and retry | Thread state survives relaunch and commit remains idempotent | Pending | Pending |
| Negotiation | Accept, counter, and decline | Only legal server-authoritative transitions succeed | Pending | Pending |
| Settlement | Approve, capture, cancel, and refund | Confirmation and resulting money state match web | Pending | Pending |
| Buyer requests | Approve and deny | Request status updates through the platform API | Pending | Pending |
| Push, physical-only | Foreground receipt | Seller event is shown and recorded once | Pending | Pending |
| Push, physical-only | Background receipt and tap | App opens the exact safe destination | Pending | Pending |
| Push, physical-only | Terminated receipt and tap | Cold-start route is consumed once after auth | Pending | Pending |
| Deep links | Negotiation, order, listing, and finance | Allowlisted routes open; malformed routes fail closed | Pending | Pending |
| Web handoffs | Account, connector, team, importer, and competitor | Canonical signed-in web destination opens | Pending | Pending |
| Expired auth | Expired mobile and web tokens | Reauthentication is requested without losing safe local state | Pending | Pending |
| Offline recovery | Launch, refresh, mutation, and push-token registration | Clear retry state; no false success or destructive overwrite | Pending | Pending |
| Visual | Icon, splash, safe areas, keyboard, and dark surfaces | Branded assets and controls render without clipping | Pending | Pending |

## Release sign-off

A store release requires:

- The automated certificate passes against the exact source archive used by EAS.
- Android preview and iOS development or TestFlight builds finish successfully.
- Every physical-device row has evidence on both target platforms, or an explicit approved waiver.
- No live test data remains.
- Release notes preserve the documented web-only boundaries for integrations, team administration,
  competitor research, and advanced account management.

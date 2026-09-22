# Integration maintenance, September 21, 2026

Scope: non-billing maintenance following the weekly integration review. Shopify
billing and App Store remediation are being handled separately. This work does
not submit a store build, deploy production, send a notification, change provider
credentials, or enable dormant checkout capabilities.

## Changes

- Replace the retired Gemini default with `gemini-2.5-flash`, a supported stable
  model with no announced shutdown date at review time. Keep the low-latency
  function-selection budget bounded and preserve explicit `LLM_MODEL` overrides.
- Replace the retired Claude Sonnet 3.5 default with the provider-recommended
  `claude-sonnet-4-6`. The factory uses adapter defaults to prevent duplicate
  fallback strings drifting apart.
- Migrate `@google/generative-ai` to pinned `@google/genai` 2.23.0. Preserve the
  trusted-system/untrusted-buyer boundary and integer minor-unit counter prices.
  Reject missing, unknown, or multiple Gemini tool decisions.
- Update A2A interoperability and canary pins to JavaScript 1.2.0 and Python
  1.1.5. Keep protocol 1.0 and the deliberately disabled optional capabilities.
- Exclude dated `shopify-review-rehearsal-YYYYMMDD` fixtures from discovery using
  the existing shared visibility gate. Keep published direct artifacts available;
  do not delete or unpublish reviewer data.
- Rename the seller-mobile workflow to Nexez Seller Hub, add release-config and
  web/mobile parity gates, and align the Expo 57 packages with the current
  compatibility metadata. React Native remains 0.86.3.

## Upstream references

- [Google GenAI SDK migration](https://ai.google.dev/gemini-api/docs/migrate)
- [Gemini model retirement schedule](https://ai.google.dev/gemini-api/docs/deprecations)
- [Claude model retirements and replacements](https://platform.claude.com/docs/en/about-claude/model-deprecations)
- [A2A JavaScript 1.2.0](https://github.com/a2aproject/a2a-js/releases/tag/v1.2.0)
- [A2A Python 1.1.5](https://github.com/a2aproject/a2a-python/releases/tag/v1.1.5)

## Validation and release boundaries

Local validation after the Expo patch alignment:

- Root: 23 targeted test files, 168 tests passed; TypeScript and scoped ESLint
  passed, with no whitespace or prose-policy errors.
- Seller Hub: 21 test files, 214 tests passed; release configuration/artwork,
  TypeScript, Expo lint, and the online Expo compatibility check passed.
- Seller Hub static web export: 40 routes built. The isolated checkout has no
  production public environment values, so the export reports the expected
  missing Supabase client configuration. This is a compile smoke test only.
- The full Next.js production build and `lint:dead` gates were not run locally;
  leave those to CI. The repository documents sandbox Google Fonts and
  dead-code-analyzer memory constraints for these gates.

Targeted tests cover Gemini request/response serialization, decision parsing,
model overrides, prompt fencing, counter-price validation, fixture exclusion in
both feeds, direct reviewer artifact access, workflow/version consistency, A2A
contracts, and the certification runner's local HTTP harness.

The updated official JavaScript and Python SDKs each passed four live public
checks: discovery/version selection, anonymous rejection, invalid-key rejection,
and disabled capabilities. These checks used no real certification credentials
and created no authenticated tasks. They are not full production certification.

After review and deployment, run the full A2A certification and authenticated
SDK workflows against the exact deployed SHA. Retain the report and workflow
links, verify that the report SHA matches the deployment, and do not reuse the
September 1 certificate as proof for a newer revision.

Sentry account alert configuration still requires authorized read access. Verify
email delivery actions and the three existing source-level signal contracts:

| Event | Trigger |
| --- | --- |
| `a2a.v1.auth.denied` | 25 events in 5 minutes |
| `a2a.v1.rate_limited` | 5 events in 5 minutes |
| `a2a.v1.task.claim_delayed` | First emitted event, indicating at least 10 seconds |

Seller Hub still requires a clean, committed production source archive, EAS build
IDs with remote build numbers, Firebase identifier/file-variable mapping, Sentry
source-map verification, store metadata/privacy review, and the physical iOS and
Android matrix in `apps/seller-mobile/RELEASE_CERTIFICATION.md`. A successful
static web export is not device, authentication, push, or store certification.

## Additional security finding, awaiting scope approval

The fresh production lockfile audit also flags Next.js 16.3.1, sharp below 0.35.4,
and Hono below 4.13.5. Coordinate patching shared package files with the ongoing
Shopify work. Do not run an indiscriminate audit fix.

- [Next.js Windows-hosted RCE](https://github.com/advisories/GHSA-p293-qw3h-jr36):
  platform-specific; not evidence of a Windows deployment here.
- [Next.js AVIF optimization RCE](https://github.com/advisories/GHSA-2xp9-vwfh-vxw4):
  upstream patch starts at Next.js 16.3.3; npm currently offers 16.3.5.
- [sharp/libheif advisory](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c):
  patch starts at sharp 0.35.4.
- [Hono body-parser advisory](https://github.com/advisories/GHSA-g6gw-c38x-mqfc):
  patch starts at 4.13.5; the reported path requires dot-notation parsing.

No exploit attempts were made. Dependency findings do not by themselves prove
that a production endpoint is exploitable.

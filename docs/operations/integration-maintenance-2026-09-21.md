# Integration maintenance, September 21, 2026

Scope: non-billing maintenance following the weekly integration review. Shopify
billing and App Store remediation are handled separately. The initial review was
read-only, followed by approval to implement maintenance changes. On September 22
UTC, the user also approved the security patches, merge, production deployment,
authenticated A2A certification, and read-only Sentry alert verification. This
does not authorize a store build, provider credential changes, or enabling dormant
checkout capabilities.

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

## Approved security patch follow-up

The user approved patching the runtime advisories. The branch incorporates merged
Shopify PR #305 before the security changes. Next.js and its ESLint configuration
move from 16.3.1 to 16.3.5, sharp from 0.35.3 to 0.35.4, and Hono from 4.13.3 to
4.13.8. npm and pnpm both pin the patched Hono resolution; pnpm's root-only
configuration explicitly excludes independently released mobile, plugin, and SDK
packages from the web lockfile. Its additional stale `qs` and `fast-uri`
resolutions are aligned to the already patched npm versions, 6.16.0 and 3.1.7.
No indiscriminate audit fix was used.

Both production lockfile audits report zero known vulnerabilities after the
patches. The security follow-up passed 206 targeted tests across 27 files,
TypeScript, scoped ESLint, prose/whitespace guards, and frozen pnpm lockfile
validation. A local AVIF encode/decode round trip passed using sharp 0.35.4 and
libheif 1.23.2. Fresh CI and exact-revision production certification remain
required release gates; a dependency audit alone is not production certification.

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

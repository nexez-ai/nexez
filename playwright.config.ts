import { defineConfig } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'

// The authed specs read E2E_EMAIL/E2E_PASSWORD from the environment. Locally
// those live in the gitignored .env.local (the standing "E2E Runner" test
// seller). Load only the test credentials and public Supabase connection keys
// needed to create disposable RLS-owned fixtures, so `npx playwright test`
// works without exporting anything. Shell/CI env always wins; no secrets are
// ever committed.
try {
  const localE2EKeys = new Set([
    'E2E_EMAIL',
    'E2E_PASSWORD',
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  ])
  // cwd-relative like testDir below. Playwright runs from the repo root.
  // Use dotenv parsing so quoted credentials do not include literal quotes.
  for (const [key, value] of Object.entries(parseEnv(readFileSync('.env.local', 'utf8')))) {
    if (localE2EKeys.has(key) && process.env[key] === undefined) {
      process.env[key] = value
    }
  }
} catch {
  // No .env.local (CI). The authed specs self-skip without credentials.
}

// Support live deployed testing via TEST_LIVE=1 (skips the local webServer).
// Under the 3-host split (nexez.ai marketing · app.nexez.ai app · nexez.app agent
// runtime) the proxy 308-canonicalizes each route to its host, so a single base
// still reaches every surface via redirects. Default to the agent runtime
// (nexez.app) since the [slug]/agent-page specs are the core; override with
// E2E_BASE_URL to target a specific host (e.g. app.nexez.ai for authed flows).
const isLiveTest = !!process.env.TEST_LIVE
const isCi = Boolean(process.env.CI)
const baseURL = process.env.E2E_BASE_URL || (isLiveTest ? 'https://nexez.app' : 'http://127.0.0.1:3000')

// LLM config for the local dev server is sourced from the environment — never
// committed. Locally it comes from your shell or .env.local; in CI from a GitHub
// Actions secret. LLM_BASE_URL/LLM_MODEL carry non-secret defaults so the server
// still boots; LLM_API_KEY is only forwarded when set (the seeded llm_opt_in E2E
// self-skips when it's absent), so no secret value ever lives in this file.
const devServerEnv: Record<string, string> = {
  LLM_BASE_URL: process.env.LLM_BASE_URL || 'https://api.x.ai/v1',
  LLM_MODEL: process.env.LLM_MODEL || 'grok-4.3',
}
if (process.env.LLM_API_KEY) devServerEnv.LLM_API_KEY = process.env.LLM_API_KEY

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  // Authenticated specs share one intentionally mutable E2E seller. Running
  // files in parallel lets one suite restore plan metadata while another is
  // still behind the dashboard gate, producing false onboarding redirects.
  // Keep the release suite serial so disposable fixture mutations cannot race.
  workers: 1,
  retries: 0,
  reporter: 'list',
  // Browser traces and error snapshots can contain live passwords and tokens.
  // Public CI keeps masked console diagnostics; detailed evidence stays local.
  preserveOutput: isCi ? 'never' : 'always',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    browserName: 'chromium',
    viewport: { width: 1280, height: 800 },
    navigationTimeout: 60_000,
    trace: isCi ? 'off' : 'retain-on-failure',
    screenshot: isCi ? 'off' : 'only-on-failure',
  },
  // For live tests (TEST_LIVE=1), skip starting local dev server and use the deployed baseURL.
  // For local: reuses a running dev server if one is already up, otherwise boots `npm run dev`.
  ...(isLiveTest ? {} : {
    webServer: {
      command: 'npm run dev',
      url: baseURL,
      reuseExistingServer: true,
      timeout: 180_000,
      env: devServerEnv,
    },
  }),
})

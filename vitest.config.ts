import { defineConfig, configDefaults } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  // Mirror the tsconfig "@/*" path alias (only matches "@/", so it won't clash
  // with scoped packages like @playwright/test or @testing-library/react).
  resolve: {
    alias: [{ find: /^@\//, replacement: fileURLToPath(new URL('./', import.meta.url)) }],
  },
  test: {
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    // Keep independently installed test suites out of the root run. Playwright
    // owns the E2E specs, while seller-mobile installs and runs Vitest from its
    // own package in the dedicated Nexez Seller Hub workflow.
    exclude: [
      ...configDefaults.exclude,
      'e2e/**',
      'playwright/**',
      'apps/seller-mobile/**',
    ],
    // Vitest defaults to a 5s test budget. That is only ~5x the slowest test in
    // this suite (~950ms), which is far too thin for 310 files fanned out across
    // workers on a machine doing anything else. Under contention the symptom is
    // an arbitrary trivial test failing with "Test timed out in 5000ms" - the
    // stack pointing at something like `afterEach(() => vi.unstubAllEnvs())`,
    // which cannot take five seconds unless its worker was starved. Observed on
    // three unrelated files, a different one each run, all passing in isolation.
    //
    // The budget is raised rather than the tests retried: a retry hides real
    // failures, while a wider budget only removes the starvation class. A genuine
    // hang still fails, just later, and the whole suite runs in ~10s so 20s is
    // unmistakable.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
})

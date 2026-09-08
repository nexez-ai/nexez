import { test, expect } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { loginWithPassword } from './auth'

// Intake interview smoke (spec §10). Three layers:
//   1. The /create fork renders and switches (always runs, unauthenticated).
//   2. The intake API's auth gate surfaces the sign-in path (always runs).
//   3. The full interview loop - scratch start → skip the blocking batch via
//      quick answers → draft summary → commit → land in the builder - gated on
//      E2E_EMAIL/E2E_PASSWORD like the rest of the authed suite. Deterministic
//      mode (no LLM) drives it, so the loop is stable; LLM-mapped stated fields
//      are covered by the lib/route suites and the live-verify pass.
// Cleanup uses the test seller's RLS permissions and runs after failures too.

const email = process.env.E2E_EMAIL
const password = process.env.E2E_PASSWORD
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

test.describe('create fork (talk vs form)', () => {
  test('/create defaults to Talk it through and switches to the wizard', async ({ page }) => {
    // The mode switch is a client event. Wait for the intake resume request so
    // the button is hydrated before clicking it.
    const hydrated = page.waitForResponse((r) => r.url().includes('/api/agents/intake/threads'))
    await page.goto('/create', { waitUntil: 'domcontentloaded' })
    await hydrated
    await expect(page.getByTestId('create-talk-mode')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Talk your listing into existence' })).toBeVisible()
    await expect(page.getByText('Start with my site')).toBeVisible()
    await expect(page.getByText('Start from scratch')).toBeVisible()

    // the wizard is one click away and fully intact
    await page.getByTestId('switch-to-form').click()
    await expect(page.getByText('Turn an existing site into a Nexez draft')).toBeVisible()
  })

  test('?mode=form deep-links straight to the wizard (import/template entries preserved)', async ({ page }) => {
    await page.goto('/create?mode=form', { waitUntil: 'domcontentloaded' })
    await expect(page.getByText('Turn an existing site into a Nexez draft')).toBeVisible()
    await expect(page.getByTestId('create-talk-mode')).not.toBeVisible()
  })

  test('?reinterview deep-links into re-interview mode (editor entry)', async ({ page }) => {
    await page.goto('/create?reinterview=some-page-id', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: 'Give this listing another pass' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Re-interview this listing' })).toBeVisible()
    await expect(page.getByText('Start the re-interview')).toBeVisible()
    // create-only entries are gone in this mode
    await expect(page.getByText('Start from scratch')).not.toBeVisible()
    await expect(page.getByTestId('switch-to-form')).not.toBeVisible()
  })

  test('unauthenticated interview start routes to sign-in (real API 401)', async ({ page }) => {
    // The resume-check GET fires from a mount effect, so its response is a
    // reliable "hydration complete" signal - clicking before hydration would
    // hit an inert SSR button.
    const hydrated = page.waitForResponse((r) => r.url().includes('/api/agents/intake/threads'))
    await page.goto('/create', { waitUntil: 'domcontentloaded' })
    await hydrated
    await page.getByText('Start from scratch').click()
    await expect(page.getByText(/Sign in to start your interview/)).toBeVisible()
    await expect(page.getByRole('link', { name: 'Create Free account' })).toHaveAttribute('href', '/onboard?next=/create')
  })
})

test.describe('authed interview loop', () => {
  let fixtureClient: SupabaseClient | null = null
  let sessionId: string | null = null
  let pageId: string | null = null

  test.beforeAll(async () => {
    if (!process.env.TEST_LIVE || !email || !password || !supabaseUrl || !supabaseKey) return
    fixtureClient = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data, error } = await fixtureClient.auth.signInWithPassword({ email, password })
    if (error || !data.user) throw new Error(`Could not authenticate intake fixture: ${error?.message || 'no user returned'}`)
  })

  test.afterAll(async () => {
    if (!fixtureClient) return
    const cleanupErrors: string[] = []
    if (sessionId) {
      // Recover the draft ID even if the test failed during builder navigation.
      const { data, error } = await fixtureClient.from('intake_sessions').select('page_id').eq('id', sessionId).single()
      if (error) cleanupErrors.push(`session lookup: ${error.message}`)
      pageId ??= data?.page_id ?? null
      const removed = await fixtureClient.from('intake_sessions').delete().eq('id', sessionId).select('id').single()
      if (removed.error || removed.data?.id !== sessionId) cleanupErrors.push(`session: ${removed.error?.message || 'row not returned'}`)
    }
    if (pageId) {
      const { data, error } = await fixtureClient.from('pages').delete().eq('id', pageId).eq('is_published', false).select('id').single()
      if (error || data?.id !== pageId) cleanupErrors.push(`draft: ${error?.message || 'row not returned'}`)
    }
    await fixtureClient.auth.signOut({ scope: 'local' })
    if (cleanupErrors.length) throw new Error(`Could not fully clean up intake fixture: ${cleanupErrors.join('; ')}`)
  })

  test('scratch interview → skip blocking gaps → draft summary → commit → builder', async ({ page, baseURL }) => {
    test.skip(!email || !password || !supabaseUrl || !supabaseKey, 'set E2E credentials and Supabase public keys')
    // Commit needs the SERVER's admin env (SUPABASE_SERVICE_ROLE_KEY) - absent
    // on a local dev server by design (prod-only secret), so this leg only runs
    // against a deployment: TEST_LIVE=1 E2E_BASE_URL=https://app.nexez.ai.
    // Prod turns ride the real LLM (~25s each), hence the generous budget.
    test.skip(!process.env.TEST_LIVE, 'commit needs the deployed server - run with TEST_LIVE=1 E2E_BASE_URL=https://app.nexez.ai')
    test.setTimeout(300_000)

    await loginWithPassword(page, { email: email!, password: password! })

    const hydrated = page.waitForResponse((r) => r.url().includes('/api/agents/intake/threads'))
    await page.goto('/create', { waitUntil: 'domcontentloaded' })
    await hydrated
    const created = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/agents/intake/threads' && r.request().method() === 'POST')
    await page.getByText('Start from scratch').click()
    const response = await created
    expect(response.status()).toBe(201)
    sessionId = (await response.json()).id
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/)

    // The deterministic interviewer asks the machine's first blocking batch.
    await expect(page.getByRole('heading', { name: 'Nexez intake' })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('What is the name of your business?')).toBeVisible()

    // Skip through blocking gaps (quick answers post STRUCTURED answers through
    // the reducer - the no-LLM path). The summary card appears once no blocking
    // gap remains askable. Earlier cards keep their (idempotent) Skip chips as
    // the transcript grows, so always act on the NEWEST batch (.last()), and
    // key each round on the real turn response, not a fixed wait.
    for (let round = 0; round < 8; round++) {
      const summaryVisible = await page
        .getByRole('button', { name: /Review in the builder/ })
        .first()
        .isVisible()
        .catch(() => false)
      if (summaryVisible) break
      // Newest batch card, FIRST chip - blocking gaps sort to the top of each
      // batch, so this works through them before any quality gap.
      const newestBatch = page.locator('article').filter({ has: page.getByRole('button', { name: 'Skip' }) }).last()
      const skip = newestBatch.getByRole('button', { name: 'Skip' }).first()
      if (!(await skip.isVisible().catch(() => false))) break
      const turnDone = page.waitForResponse(
        (r) => r.url().includes('/messages') && r.request().method() === 'POST',
        { timeout: 30_000 },
      )
      await skip.click()
      await turnDone
      await page.waitForTimeout(250) // render settle
    }

    await expect(page.getByRole('button', { name: /Review in the builder/ }).first()).toBeVisible({ timeout: 20_000 })
    const committed = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/agents/intake/threads/${sessionId}/commit` && r.request().method() === 'POST')
    await page.getByRole('button', { name: /Review in the builder/ }).first().click()
    const commitResponse = await committed
    expect(commitResponse.status(), 'Interview commit must create a private draft').toBe(200)
    // Read the persisted handoff because a full navigation can discard Chromium's
    // response body before the test reads it, even after a successful commit.
    const { data: session, error: sessionError } = await fixtureClient!.from('intake_sessions').select('page_id,status').eq('id', sessionId!).single()
    expect(sessionError).toBeNull()
    expect(session?.status).toBe('handed_off')
    pageId = session!.page_id
    expect(pageId).toMatch(/^[0-9a-f-]{36}$/)

    // Commit materializes a DRAFT page and routes to the builder.
    await page.waitForURL((url) => url.origin === new URL(baseURL!).origin && url.pathname === `/dashboard/${pageId}`, { timeout: 30_000, waitUntil: 'domcontentloaded' })
    const editor = page.getByTestId('listing-editor-screen')
    await expect(editor).toBeVisible({ timeout: 20_000 })
    const { data: draft, error } = await fixtureClient!.from('pages').select('name,is_published').eq('id', pageId!).single()
    expect(error).toBeNull()
    expect(draft?.is_published).toBe(false)
    await expect(editor.getByRole('heading', { name: draft!.name, exact: true })).toBeVisible()
  })
})

import { test, expect } from '@playwright/test'
import { loginWithPassword } from './auth'

const publicSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const publicSupabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

function hasRealPublicSupabaseConfig() {
  if (!publicSupabaseUrl || !publicSupabaseKey || publicSupabaseKey.length < 20) return false
  try {
    const url = new URL(publicSupabaseUrl)
    const candidate = `${url.hostname} ${publicSupabaseKey}`.toLowerCase()
    return (url.protocol === 'https:' || url.protocol === 'http:')
      && !/(?:placeholder|example|your[-_. ]?project|change[-_. ]?me|dummy)/.test(candidate)
  } catch {
    return false
  }
}

// Public surface - no auth. Always runs (CI-safe).
test.describe('public surface', () => {
  test('homepage renders with no uncaught errors', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (e) => pageErrors.push(String(e)))

    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveTitle(/Nexez/)
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
    // primary CTA is reachable
    await expect(page.getByRole('link', { name: /list your offers/i }).first()).toBeVisible()

    expect(pageErrors, `Uncaught page errors:\n${pageErrors.join('\n')}`).toEqual([])
  })

  test('homepage keeps the mobile story compact, readable, and within the viewport', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(String(error)))

    await page.setViewportSize({ width: 320, height: 568 })
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
    await expect(page.getByRole('link', { name: 'List your offers' }).first()).toBeVisible()

    const compactLayout = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      height: document.documentElement.scrollHeight,
    }))
    expect(compactLayout.overflow).toBeLessThanOrEqual(1)
    // Budget history, so the number is not mistaken for arbitrary:
    //   7500  original
    //   7800  narrative connective copy (a lead for "How it works", which had
    //         none, plus the handoff sentences), ~177px against 128px of slack
    //   8300  restoring XrayMobile, ~422px. b2c13540 wrapped AgentXray in
    //         `hidden md:block` when moving it into the problem band, which
    //         also killed the component's own mobile variant. The lead has
    //         promised "the same business, twice" on mobile ever since.
    // The guard catches runaway bloat; it is not a pin. Move it deliberately.
    expect(compactLayout.height).toBeLessThan(8300)

    const menuButton = page.getByRole('button', { name: 'Open menu' })
    await expect(menuButton).toBeVisible()
    await menuButton.click()
    await expect(page.getByRole('link', { name: 'Scan your site' })).toBeVisible()
    await expect(page.getByText('Theme', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'List your offers' }).last()).toBeVisible()

    await page.getByRole('radio', { name: 'Light' }).click()
    await page.getByRole('button', { name: 'Close menu' }).click()

    for (const width of [360, 390, 430]) {
      await page.setViewportSize({ width, height: 844 })
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      expect(overflow).toBeLessThanOrEqual(1)
    }

    const sidewaysScrollers = await page.evaluate(() => Array.from(document.querySelectorAll('.nx-home-page *'))
      .filter((element) => {
        const htmlElement = element as HTMLElement
        const overflowX = getComputedStyle(htmlElement).overflowX
        return ['auto', 'scroll'].includes(overflowX) && htmlElement.scrollWidth > htmlElement.clientWidth + 1
      })
      .map((element) => element.className))
    expect(sidewaysScrollers).toEqual([])

    const controlDetails = page.locator('.nx-home-story-disclosure')
    await expect(controlDetails).toHaveCount(4)
    await expect(controlDetails.first()).toHaveAttribute('open', '')
    await controlDetails.nth(1).locator('summary').click()
    await expect(controlDetails.first()).not.toHaveAttribute('open', '')
    await expect(controlDetails.nth(1)).toHaveAttribute('open', '')

    const capabilities = page.locator('.nx-home-capabilities-disclosure')
    await expect(capabilities).not.toHaveAttribute('open', '')
    await capabilities.locator('summary').click()
    await expect(capabilities).toHaveAttribute('open', '')
    await expect(capabilities.getByText('Agent Simulator', { exact: true })).toBeVisible()

    await page.goto('/#readiness', { waitUntil: 'domcontentloaded' })
    await expect(page.getByText('What can buyers see?')).toBeVisible()
    await page.goto('/#analytics', { waitUntil: 'domcontentloaded' })
    await expect(page.getByText('“Deep tissue massage this Saturday for under $150.”')).toBeVisible()
    await expect(page.getByText('Deep Tissue, 60 minutes')).toBeVisible()

    expect(pageErrors, `Uncaught page errors:\n${pageErrors.join('\n')}`).toEqual([])
  })

  test('the learn library survives a 320px viewport and its shelves stay navigable', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(String(error)))

    await page.setViewportSize({ width: 320, height: 568 })
    await page.goto('/learn', { waitUntil: 'domcontentloaded' })

    // The three things the hub rebuild added, in the order a stranger meets them.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByText('Original research')).toBeVisible()
    await expect(page.getByText('Start here')).toBeVisible()

    // Deliberately no height budget here, unlike the homepage. This page grows by
    // one card every time we publish, so a height pin would fail on a schedule and
    // be raised without thought, which is worse than not having one.
    for (const width of [320, 360, 390, 430]) {
      await page.setViewportSize({ width, height: 844 })
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(1)
    }

    // The category filter is the element most likely to introduce a sideways
    // scroller: `.platform-tablist` scrolls by default and only the `-grid`
    // variant wraps. This is the check that catches losing that class.
    const sidewaysScrollers = await page.evaluate(() => Array.from(document.querySelectorAll('main *'))
      .filter((element) => {
        const htmlElement = element as HTMLElement
        const overflowX = getComputedStyle(htmlElement).overflowX
        return ['auto', 'scroll'].includes(overflowX) && htmlElement.scrollWidth > htmlElement.clientWidth + 1
      })
      .map((element) => element.className))
    expect(sidewaysScrollers).toEqual([])

    // Filtering is link based and lives in the URL, so it has to work as navigation.
    await page.setViewportSize({ width: 320, height: 568 })
    // Scope to the filter, not the page: the featured card carries its category as
    // text too, so an unscoped match opens the article instead of filtering.
    const filter = page.getByRole('navigation', { name: 'Filter guides by category' })
    await filter.getByRole('link', { name: /Agent readiness/ }).click()
    await expect(page).toHaveURL(/\/learn\?category=/)
    await expect(page.getByRole('heading', { name: 'Agent readiness', level: 2 })).toBeVisible()
    // A filtered view drops the hero, so the shelf is all there is; it must not be empty.
    await expect(page.getByText('Nothing in this shelf yet')).toHaveCount(0)

    expect(pageErrors, `Uncaught page errors:\n${pageErrors.join('\n')}`).toEqual([])
  })

  test('a learn article offers contents and related reading on a phone', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(String(error)))

    await page.setViewportSize({ width: 320, height: 568 })
    await page.goto('/learn', { waitUntil: 'domcontentloaded' })

    // Follow whatever is on the shelf rather than pinning a slug, so publishing
    // does not break the test.
    await page.locator('main a[href^="/learn/"]').first().click()
    await expect(page).toHaveURL(/\/learn\/[a-z0-9-]+$/)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible()

    // Contents costs one closed line until someone wants it, and its entries are
    // in-page anchors, which only works because the renderer emits heading ids.
    const contents = page.locator('details', { hasText: 'On this page' }).first()
    await expect(contents).not.toHaveAttribute('open', '')
    await contents.locator('summary').click()
    await expect(contents).toHaveAttribute('open', '')

    const firstAnchor = contents.locator('a[href^="#"]').first()
    const fragment = await firstAnchor.getAttribute('href')
    expect(fragment).toMatch(/^#[a-z0-9-]+$/)
    await expect(page.locator(`${fragment}`)).toHaveCount(1)

    await expect(page.getByRole('heading', { name: 'Keep reading', level: 2 })).toBeVisible()

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(1)

    expect(pageErrors, `Uncaught page errors:\n${pageErrors.join('\n')}`).toEqual([])
  })

  test('pricing comparison is keyboard reachable with semantic headings and accessible signal contrast', async ({ page }) => {
    await page.goto('/pricing', { waitUntil: 'domcontentloaded' })

    for (const plan of ['Free', 'Launch', 'Pro', 'Scale', 'Enterprise']) {
      await expect(page.getByRole('heading', { name: plan, level: 2, exact: true })).toBeVisible()
    }

    const comparison = page.getByRole('region', { name: 'Complete plan comparison table' })
    await expect(comparison).toHaveAttribute('tabindex', '0')
    await comparison.focus()
    await expect(comparison).toBeFocused()

    const signalContrast = await page.evaluate(() => {
      const probe = document.createElement('span')
      probe.style.backgroundColor = 'var(--signal-solid)'
      document.body.append(probe)
      const channels = getComputedStyle(probe).backgroundColor.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? []
      probe.remove()
      const luminance = (values: number[]) => values
        .map((value) => value / 255)
        .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
        .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0)
      const background = luminance(channels)
      const white = 1
      return (white + 0.05) / (background + 0.05)
    })
    expect(signalContrast).toBeGreaterThanOrEqual(4.5)
  })

  test('Agent Lab uses the expanded responsive workspace without desktop or mobile overflow', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (e) => pageErrors.push(String(e)))

    await page.goto('/simulator', { waitUntil: 'domcontentloaded' })
    await expect(page.getByText('Test, simulate & compare')).toBeVisible()
    await expect(page.getByRole('tablist', { name: 'Agent Lab modes' })).toBeVisible()
    const testMode = page.getByRole('tab', { name: 'Test a listing' })
    const urlMode = page.getByRole('tab', { name: 'Any URL' })
    await expect(testMode).toHaveAttribute('aria-selected', 'true')
    await expect(testMode).toHaveAttribute('tabindex', '0')
    await expect(urlMode).toHaveAttribute('tabindex', '-1')

    await testMode.focus()
    await testMode.press('ArrowRight')
    await expect(urlMode).toBeFocused()
    await expect(urlMode).toHaveAttribute('aria-selected', 'true')
    await expect(page).toHaveURL(/\?mode=url$/)
    await urlMode.press('Home')
    await expect(testMode).toBeFocused()
    await expect(testMode).toHaveAttribute('aria-selected', 'true')
    await expect(page).toHaveURL(/\?mode=test$/)

    await page.setViewportSize({ width: 1440, height: 900 })
    const wideLayout = await page.getByTestId('agent-lab-screen').evaluate((element) => ({
      width: element.firstElementChild?.getBoundingClientRect().width ?? 0,
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    }))
    expect(wideLayout.width).toBeGreaterThan(1280)
    expect(wideLayout.documentWidth).toBeLessThanOrEqual(wideLayout.viewport)

    // Responsive shell coverage is public and data-independent: it must keep
    // running even when CI intentionally supplies placeholder Supabase values.
    await page.setViewportSize({ width: 390, height: 844 })
    const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(mobileOverflow).toBeLessThanOrEqual(1)

    expect(pageErrors, `Uncaught page errors:\n${pageErrors.join('\n')}`).toEqual([])
  })

  test('Agent Lab analyzes the seeded certification listing when real public Supabase config is available', async ({ page }) => {
    // This assertion is deliberately data-backed. Placeholder/missing public
    // connection values must skip it before navigation while the layout test
    // above continues to certify the public workspace on every run.
    test.skip(
      !hasRealPublicSupabaseConfig(),
      'set a real non-placeholder NEXT_PUBLIC_SUPABASE_URL and publishable key to run the seeded listing simulation',
    )

    const pageErrors: string[] = []
    page.on('pageerror', (e) => pageErrors.push(String(e)))

    await page.goto('/simulator', { waitUntil: 'domcontentloaded' })

    // The certification merchant is the stable target: it is owned by us, always
    // published (the release gauntlet depends on it), and listed in
    // INTERNAL_SEED_SLUGS so it never pollutes discovery. The previous fixture,
    // lakehouse-spa-packages-specials, was a real merchant page that later got
    // unpublished and has been 404ing here ever since, unnoticed because this suite
    // only ever ran on workflow_dispatch.
    await page.waitForSelector('input[placeholder*="my-offers"]', { timeout: 10000 })
    await page.getByPlaceholder('my-offers or https://nexez.com/my-offers').fill('nexez-agent-negotiation-lab')
    await page.getByRole('button', { name: /analyze/i }).click()

    // Deterministic agents always render. LLM-Enhanced only renders when the
    // server explicitly confirms that a provider produced the response.
    await expect(page.getByRole('tablist', { name: 'Simulated agents' })).toBeVisible({ timeout: 30000 })
    await expect(page.getByRole('tab', { name: 'ChatGPT', exact: true })).toBeVisible()

    expect(pageErrors, `Uncaught page errors:\n${pageErrors.join('\n')}`).toEqual([])
  })
})

// Dedicated E2E for the Agent Lab's server-side LLM execution boundary.
// Seeds llm_opt_in=true on a test-owned published page via the settings toggle (authed),
// then runs the paste flow which (because of llm_opt_in) requests LLM enrichment inside
// the attributable /api/simulator/runs response. Uses the LLM_API_KEY the dev server reads from the environment
// (forwarded by playwright.config.ts; model e.g. grok-4.3). Skips gracefully (CI-safe) when
// E2E_EMAIL/E2E_PASSWORD aren't provided, or when LLM_API_KEY is unset (no real LLM call possible).
const email = process.env.E2E_EMAIL
const password = process.env.E2E_PASSWORD
const llmApiKey = process.env.LLM_API_KEY

test.describe('simulator LLM-Enhanced (seeded llm_opt_in page)', () => {
  test('simulator reports the real server-side LLM outcome when page llm_opt_in is seeded via settings', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (e) => pageErrors.push(String(e)))

    test.skip(!email || !password, 'set E2E_EMAIL and E2E_PASSWORD to run the seeded llm_opt_in simulator E2E')
    test.skip(!llmApiKey, 'set LLM_API_KEY to run the seeded llm_opt_in simulator E2E (it makes a real LLM call)')

    await loginWithPassword(page, {
      email: email!,
      password: password!,
      destination: '/dashboard',
    })

    // Pick a genuinely PUBLISHED owned listing. The previous selector grabbed
    // the first owned listing regardless of status, so a newer draft could be
    // fed into the public simulator and never resolve.
    const publishedCard = page.locator('article').filter({ has: page.getByRole('button', { name: 'Published' }) }).first()
    const editLink = publishedCard.getByRole('link', { name: 'Edit listing' })
    await editLink.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {})
    const href = await editLink.getAttribute('href').catch(() => null)
    test.skip(!href, 'test account has no published pages to seed llm_opt_in on')

    // Go to its settings to seed the opt-in flag (this is the "seeded llm_opt_in page")
    const idMatch = href!.match(/([0-9a-f-]{36})$/)
    const settingsPath = `/dashboard/${idMatch ? idMatch[1] : ''}/settings`
    await page.goto(settingsPath, { waitUntil: 'domcontentloaded' })

    // Wait for the accessible settings switch to be interactive.
    const aiAssistSwitch = page.getByRole('switch', { name: /advanced ai assist/i })
    await expect(aiAssistSwitch).toBeVisible({ timeout: 15000 })

    // Seed: ensure llm_opt_in is true for this page (direct update, no extra save)
    const wasEnabled = (await aiAssistSwitch.getAttribute('aria-checked')) === 'true'
    if (!wasEnabled) {
      await aiAssistSwitch.click()
      await expect(aiAssistSwitch).toHaveAttribute('aria-checked', 'true')
      // Handler awaits the pages.update then sets the confirmation message
      await page.getByText(/Advanced AI assist enabled|LLM opt-in enabled/i).waitFor({ timeout: 10000 }).catch(() => {})
    }

    // Capture the slug from the rendered "Public Listing" link. The link is an
    // absolute runtime URL, so parse its pathname instead of treating the whole
    // href as a relative slug.
    const publicLink = page.locator('a:has-text("Public Listing")')
    await expect(publicLink).toBeVisible({ timeout: 5000 })
    const publicHref = await publicLink.getAttribute('href')
    const pageSlug = publicHref ? new URL(publicHref, page.url()).pathname.replace(/^\/+|\/+$/g, '') : ''
    test.skip(!pageSlug, 'could not resolve slug for the seeded page')

    // Now go to simulator (same auth context) and exercise the paste + analyze path
    await page.goto('/simulator', { waitUntil: 'domcontentloaded' })
    await expect(page.getByText('Test, simulate & compare')).toBeVisible()
    await page.waitForSelector('input[placeholder*="my-offers"]', { timeout: 10000 })

    // Pass 2 moved provider execution behind the attributable Agent Lab run.
    // Assert that contract instead of waiting for the retired client-side route.
    const simulatorRunResponse = page.waitForResponse(
      (response) => /\/api\/simulator\/runs/.test(response.url()) && response.request().method() === 'POST',
      { timeout: 45_000 },
    )

    await page.getByPlaceholder('my-offers or https://nexez.com/my-offers').fill(pageSlug)
    await page.getByRole('button', { name: /analyze/i }).click()

    const runResponse = await simulatorRunResponse
    expect(runResponse.ok(), 'the attributable Agent Lab run should complete').toBe(true)
    const runData = await runResponse.json()
    const llmEvidence = runData?.run?.evidence?.execution?.llm
    expect(llmEvidence?.requested, 'an opted-in listing should request the configured provider').toBe(true)

    // The UI must only expose LLM-Enhanced when the provider actually returned
    // usable text. Provider outages remain explicit evidence, never false claims.
    const llmTab = page.getByRole('tab', { name: 'LLM-Enhanced', exact: true })
    if (llmEvidence?.executed) {
      const llmResult = runData.run.result.results.find((result: { agent?: string }) => result.agent === 'LLM-Enhanced')
      expect(typeof llmResult?.naturalLanguage, 'provider-confirmed results must include naturalLanguage text').toBe('string')
      expect((llmResult?.naturalLanguage || '').length, 'naturalLanguage should be substantial agent-style output').toBeGreaterThan(20)
      await expect(llmTab).toBeVisible({ timeout: 30_000 })
      await llmTab.click()
      await expect(page.getByRole('heading', { name: "LLM-Enhanced's view" })).toBeVisible()
    } else {
      expect(llmEvidence?.reason, 'a skipped provider must retain an explicit evidence reason').toMatch(/^[a-z_]+$/)
      await expect(llmTab).toHaveCount(0)
      await expect(page.getByText(new RegExp(`LLM skipped: ${String(llmEvidence.reason).replaceAll('_', ' ')}`, 'i'))).toBeVisible()
    }

    // Additional authed feature coverage (non-destructive page loads for main dashboard sections + flows).
    // Anchor each page on one unique semantic landmark so the smoke remains
    // stable as cards/KPIs add more text that happens to share broad keywords.
    await page.goto('/dashboard/analytics', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: 'Analytics', exact: true })).toBeVisible({ timeout: 15000 })

    await page.goto('/dashboard/billing', { waitUntil: 'domcontentloaded' })
    if (process.env.TEST_LIVE || process.env.SUPABASE_SERVICE_ROLE_KEY) {
      await expect(page.getByRole('heading', { name: 'Your plan & payouts', exact: true })).toBeVisible({ timeout: 15000 })
    } else {
      // CI deliberately has no service-role credential. Billing must fail closed
      // when it cannot verify Shopify ownership, instead of exposing Stripe UI.
      await expect(page.getByText('Billing is temporarily unavailable. Please try again shortly.', { exact: true })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Your plan & payouts', exact: true })).toHaveCount(0)
      const portal = await page.request.post('/api/billing/portal')
      expect(portal.status()).toBe(503)
      expect(await portal.json()).toMatchObject({ error: 'Billing ownership verification is unavailable. Please try again shortly.' })
    }

    await page.goto('/dashboard/negotiations', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: 'Negotiations', exact: true })).toBeVisible({ timeout: 15000 })

    await page.goto('/dashboard/tools', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: 'Tools', exact: true })).toBeVisible({ timeout: 15000 })

    await page.goto('/create', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: 'Talk your listing into existence', exact: true })).toBeVisible({ timeout: 10000 })

    // Quick re-visit to dashboard overview and a settings page for llm_opt_in coverage (already toggled earlier)
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible({ timeout: 10000 })

    // Additional E2E coverage for the /negotiate persistent page (the core of long-lived resumable negotiations).
    // After visiting negotiations inbox (which now links to persistent threads), exercise /negotiate/{id}:
    // - Load full history from dedicated table
    // - Display of turns, status, continuation form
    // - Submit a follow-up (appends to history via API + service, LLM would see full context on next step)
    await page.goto('/dashboard/negotiations', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: 'Negotiations', exact: true })).toBeVisible({ timeout: 10000 })

    const negotiateLink = page.locator('a[href*="/negotiate/"]').first()
    if (await negotiateLink.count() > 0) {
      const href = await negotiateLink.getAttribute('href')
      if (href) {
        await page.goto(href, { waitUntil: 'domcontentloaded' })
        await expect(page.getByRole('heading', { name: 'Negotiation', exact: true })).toBeVisible({ timeout: 10000 })
        await expect(page.getByText('Full Conversation History')).toBeVisible({ timeout: 10000 })
        await expect(page.getByText('Continue this negotiation')).toBeVisible()

        // Submit a follow-up via the persistent page form (tests end-to-end flow for agents returning later)
        const continueForm = page.locator('form[action="/api/negotiations"]').first()
        if (await continueForm.count() > 0) {
          await continueForm.locator('textarea[name="query"]').fill('E2E follow-up: updated scope from persistent link')
          await continueForm.locator('input[name="budget"]').fill('950')
          await continueForm.getByRole('button', { name: /Submit follow-up/i }).click()

          // Wait for the submission to process and page to reflect (or redirect/re-render with new turn)
          await page.waitForTimeout(3000)
          await expect(page.getByText(/E2E follow-up|updated scope/i)).toBeVisible({ timeout: 15000 })
        }
      }
    }

    expect(pageErrors, `Uncaught page errors:\n${pageErrors.join('\n')}`).toEqual([])
  })
})

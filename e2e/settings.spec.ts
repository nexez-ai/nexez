import { test, expect, type Page } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { loginWithPassword } from './auth'
import { selectPlatformTheme } from './platform-theme'
import { SCAN_CHECK_COPY } from '../lib/organization-scans'

const email = process.env.E2E_EMAIL
const password = process.env.E2E_PASSWORD
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

function hasRealSettingsFixtureConfig() {
  if (!email || !password || !supabaseUrl || !supabaseKey || supabaseKey.length < 20) return false
  try {
    const url = new URL(supabaseUrl)
    const candidate = `${url.hostname} ${supabaseKey}`.toLowerCase()
    return (url.protocol === 'https:' || url.protocol === 'http:')
      && !/(?:placeholder|example|your[-_. ]?project|change[-_. ]?me|dummy)/.test(candidate)
  } catch {
    return false
  }
}

const UUID_DASHBOARD_LINK = /^\/dashboard\/[0-9a-f-]{36}$/

let disposablePageId: string | null = null
let fixtureClient: SupabaseClient | null = null
let fixtureOwnerId: string | null = null
let fixtureOutboundWebhooksEnabled = false
let fixtureIntegrationsEnabled = false
let fixtureCustomDomainEnabled = false
let originalPlanMetadata: unknown = null
let planMetadataAdjusted = false

async function initializeSettingsFixture(): Promise<string> {
  if (fixtureClient && fixtureOwnerId) return fixtureOwnerId
  if (!email || !password || !supabaseUrl || !supabaseKey) {
    throw new Error('E2E fixture setup requires the test credentials and public Supabase connection keys')
  }

  fixtureClient = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: authData, error: authError } = await fixtureClient.auth.signInWithPassword({ email, password })
  if (authError || !authData.user) {
    throw new Error(`Could not authenticate the E2E fixture owner: ${authError?.message || 'no user returned'}`)
  }
  fixtureOwnerId = authData.user.id

  const { data: entitlements, error: entitlementError } = await fixtureClient.rpc('get_my_plan_entitlements')
  if (entitlementError) throw new Error(`Could not resolve settings fixture entitlements: ${entitlementError.message}`)
  const features = (entitlements as {
    features?: { outboundWebhooks?: boolean; integrations?: boolean; customDomain?: boolean }
  } | null)?.features
  fixtureOutboundWebhooksEnabled = Boolean(features?.outboundWebhooks)
  fixtureIntegrationsEnabled = Boolean(features?.integrations)
  fixtureCustomDomainEnabled = Boolean(features?.customDomain)

  const selectedPlan = authData.user.user_metadata?.plan
  if (!['free', 'launch', 'pro', 'scale'].includes(selectedPlan)) {
    originalPlanMetadata = selectedPlan ?? null
    const { error: metadataError } = await fixtureClient.auth.updateUser({ data: { plan: 'free' } })
    if (metadataError) throw new Error(`Could not prepare settings fixture onboarding: ${metadataError.message}`)
    planMetadataAdjusted = true
  }

  return fixtureOwnerId
}

async function createDisposableListing(): Promise<string> {
  if (disposablePageId) return disposablePageId
  const ownerId = await initializeSettingsFixture()

  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const { data, error } = await fixtureClient!
    .from('pages')
    .insert({
      owner_id: ownerId,
      name: 'Nexez settings E2E',
      slug: `settings-e2e-${unique}`,
      description: 'Disposable private listing used to verify the settings experience.',
      website_url: 'https://example.com',
      cta_url: 'https://example.com/contact',
      cta_label: 'Contact us',
      is_published: false,
      branding: {},
      products: [],
      services: [],
      faqs: [],
    })
    .select('id')
    .single()

  if (error || !data?.id) {
    throw new Error(`Could not create the disposable settings listing: ${error?.message || 'no id returned'}`)
  }
  disposablePageId = data.id

  return data.id
}

async function loginToDashboard(page: Page) {
  test.skip(!email || !password, 'set E2E_EMAIL and E2E_PASSWORD to run the page settings E2E')

  await loginWithPassword(page, {
    email: email!,
    password: password!,
    destination: '/dashboard',
  })
}

async function loginAndOpenFirstPageSettings(page: Page) {
  // Prepare plan metadata before browser sign-in so the newly minted browser
  // token and the server-side dashboard gate agree on onboarding state.
  await initializeSettingsFixture()
  await loginToDashboard(page)
  await page
    .waitForFunction(
      () => [...document.querySelectorAll('a[href]')].some((a) => /^\/dashboard\/[0-9a-f-]{36}$/.test(a.getAttribute('href') || '')),
      undefined,
      { timeout: 15_000 },
    )
    .catch(() => {})

  const href = await page.evaluate(
    () => [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')).find((h) => !!h && /^\/dashboard\/[0-9a-f-]{36}$/.test(h)) || null,
  )
  const resolvedHref = href || `/dashboard/${await createDisposableListing()}`
  expect(resolvedHref).toMatch(UUID_DASHBOARD_LINK)

  const id = resolvedHref.split('/').pop()
  await page.goto(`/dashboard/${id}/settings`, { waitUntil: 'domcontentloaded' })
}

test.describe('page settings', () => {
  test.describe.configure({ mode: 'serial' })

  test.afterAll(async () => {
    if (!fixtureClient) return
    const cleanupErrors: string[] = []
    if (disposablePageId) {
      const id = disposablePageId
      const { data, error } = await fixtureClient.from('pages').delete().eq('id', id).select('id').single()
      if (error || data?.id !== id) cleanupErrors.push(error?.message || 'fixture row was not deleted')
    }
    if (planMetadataAdjusted) {
      const { error } = await fixtureClient.auth.updateUser({ data: { plan: originalPlanMetadata } })
      if (error) cleanupErrors.push(`plan metadata: ${error.message}`)
    }
    await fixtureClient.auth.signOut()
    if (cleanupErrors.length) {
      throw new Error(`Could not fully clean up disposable settings listing ${disposablePageId}: ${cleanupErrors.join('; ')}`)
    }
  })

  test('loads implemented settings without stale roadmap notes or machine markers', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (e) => pageErrors.push(String(e)))

    await loginAndOpenFirstPageSettings(page)

    await expect(page.getByTestId('page-settings-screen')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Listing settings', { exact: false }).first()).toBeVisible()
    for (const section of [
      'General',
      'Brand & domain',
      'Agent experience',
      'Commerce & integrations',
      'Trust & verification',
      'Team & history',
      'Developer',
    ]) {
      await expect(page.getByRole('heading', { name: section, exact: true })).toBeVisible()
    }
    await expect(page.getByText('Agent links')).toBeVisible()
    await expect(page.getByText('Agent Manifest Preview')).toBeVisible()
    await expect(page.getByTestId('availability-panel')).toBeVisible()
    if (fixtureOutboundWebhooksEnabled) {
      await expect(page.getByTestId('outbound-webhooks-panel')).toBeVisible()
    } else {
      const webhookGate = page.getByText('Booking event webhooks', { exact: true }).locator('..').locator('..')
      await expect(webhookGate).toBeVisible()
      await expect(webhookGate.getByRole('link', { name: 'Upgrade to Pro', exact: true })).toHaveAttribute(
        'href',
        /\/dashboard\/billing\?plan=pro$/,
      )
      await expect(page.getByTestId('outbound-webhooks-panel')).toHaveCount(0)
    }

    await expect(page.getByText(/future automated sync/i)).toHaveCount(0)
    await expect(page.getByText(/Phase 3 stub/i)).toHaveCount(0)

    const availabilityNote = page.getByTestId('availability-note-input')
    await expect(availabilityNote).toBeVisible()
    await expect(async () => {
      expect(await availabilityNote.inputValue()).not.toContain('||WINDOWS||')
    }).toPass()

    const calendarId = page.getByTestId('google-calendar-id-input')
    if (fixtureIntegrationsEnabled) {
      const originalCalendarId = await calendarId.inputValue()
      await calendarId.fill('')
      await expect(page.getByTestId('availability-save-button')).toHaveText(/Save Manual Availability/)
      await calendarId.fill('e2e-calendar@example.com')
      // A configured calendar now uses the stored OAuth connection and live
      // Google freeBusy data. Keep the retired sample behavior out of the UI.
      await expect(page.getByTestId('availability-save-button')).toHaveText(/Sync Google availability/)
      await calendarId.fill(originalCalendarId)
    } else {
      await expect(calendarId).toBeDisabled()
    }

    if (fixtureOutboundWebhooksEnabled) {
      const webhookPanel = page.getByTestId('outbound-webhooks-panel')
      const webhookUrl = 'https://example.com/nexez-e2e-webhook'
      await webhookPanel.getByPlaceholder(/hooks\.zapier/i).fill(webhookUrl)
      await webhookPanel.getByPlaceholder(/Optional signing secret/i).fill('e2e-secret')
      await webhookPanel.getByRole('button', { name: 'Add' }).click()
      await expect(webhookPanel.getByText(webhookUrl)).toBeVisible()
      await expect(webhookPanel.getByTestId('outbound-secret-chip-0')).toBeVisible()
      await webhookPanel.getByRole('button', { name: 'remove' }).click()
      await expect(webhookPanel.getByText(webhookUrl)).toHaveCount(0)
    }

    expect(pageErrors, `Uncaught page errors:\n${pageErrors.join('\n')}`).toEqual([])
  })

  test('account settings uses the wide control-center architecture without mobile overflow', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(String(error)))

    // Skip before fixture creation: a browser-login skip inside
    // loginToDashboard is too late once placeholder/missing public connection
    // values have already been handed to the Supabase fixture client.
    test.skip(
      !hasRealSettingsFixtureConfig(),
      'set E2E_EMAIL, E2E_PASSWORD, and real non-placeholder public Supabase connection keys to run account settings E2E',
    )

    // Prepare the fixture owner before browser sign-in so its fresh auth token
    // includes the temporary Free workspace selection used by dashboard gating.
    await createDisposableListing()
    await loginToDashboard(page)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/dashboard/settings', { waitUntil: 'domcontentloaded' })

    await expect(page.getByTestId('account-settings-screen')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
    const sectionNav = page.getByRole('navigation', { name: 'Settings sections' })
    for (const section of ['Workspace', 'Profile & security', 'Team access', 'Data controls', 'Agent surfaces']) {
      await expect(sectionNav.getByRole('link', { name: section, exact: true })).toBeVisible()
    }
    await expect(page.getByRole('heading', { name: 'Complete account archive', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Remove personal buyer data', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: /Open Agent Lab/i })).toBeVisible()

    const endpointCards = page.getByTestId('settings-endpoint-card')
    await expect(endpointCards).toHaveCount(6)
    for (const theme of ['Light', 'Dark']) {
      await selectPlatformTheme(page, theme as 'Light' | 'Dark')
      await expect(page.locator('html')).toHaveClass(new RegExp(theme.toLowerCase()))
      const endpointStyles = await endpointCards.evaluateAll((cards) => {
        const expectedSurface = document.createElement('span')
        expectedSurface.style.backgroundColor = 'var(--fill-1)'
        document.body.append(expectedSurface)
        const expectedBackground = getComputedStyle(expectedSurface).backgroundColor
        expectedSurface.remove()
        return {
          backgrounds: cards.map((card) => getComputedStyle(card).backgroundColor),
          expectedBackground,
          colorScheme: getComputedStyle(cards[0]).colorScheme,
        }
      })
      expect(new Set(endpointStyles.backgrounds).size).toBe(1)
      expect(endpointStyles.backgrounds[0]).toBe(endpointStyles.expectedBackground)
      expect(endpointStyles.colorScheme).toContain(theme.toLowerCase())
    }

    const desktopMetrics = await page.getByTestId('account-settings-screen').evaluate((element) => ({
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      screenWidth: element.getBoundingClientRect().width,
    }))
    expect(desktopMetrics.screenWidth).toBeGreaterThan(1100)
    expect(desktopMetrics.documentWidth).toBeLessThanOrEqual(desktopMetrics.viewport)

    await sectionNav.getByRole('link', { name: 'Agent surfaces' }).click()
    await expect(page).toHaveURL(/#agent-surfaces$/)
    await expect(page.getByRole('heading', { name: 'Agent surfaces', exact: true })).toBeVisible()
    await expect(sectionNav.getByRole('link', { name: 'Agent surfaces' })).toHaveClass(/settings-choice-active/)

    await page.locator('#team').evaluate((section) => window.scrollTo({ top: section.getBoundingClientRect().top + window.scrollY - 180 }))
    await expect(sectionNav.getByRole('link', { name: 'Team access' })).toHaveAttribute('aria-current', 'location')
    await expect(sectionNav.getByRole('link', { name: 'Agent surfaces' })).not.toHaveAttribute('aria-current', 'location')

    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight }))
    await expect(sectionNav.getByRole('link', { name: 'Agent surfaces' })).toHaveAttribute('aria-current', 'location')

    const stickyGeometry = await sectionNav.evaluate((nav) => {
      const navRect = nav.getBoundingClientRect()
      const shellHeader = document.querySelector<HTMLElement>('header.nx-nav')
      return {
        navTop: Math.round(navRect.top),
        navBottom: Math.round(navRect.bottom),
        headerBottom: Math.round(shellHeader?.getBoundingClientRect().bottom ?? 0),
        viewportHeight: window.innerHeight,
      }
    })
    expect(stickyGeometry.navTop).toBeGreaterThanOrEqual(stickyGeometry.headerBottom)
    expect(stickyGeometry.navBottom).toBeLessThanOrEqual(stickyGeometry.viewportHeight)

    await page.setViewportSize({ width: 390, height: 844 })
    const mobileMetrics = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      bodyOverflow: document.body.scrollWidth - window.innerWidth,
      navAncestors: (() => {
        const rows: Array<Record<string, unknown>> = []
        let element: HTMLElement | null = document.querySelector('nav[aria-label="Settings sections"]')
        while (element && rows.length < 7) {
          const rect = element.getBoundingClientRect()
          rows.push({
            tag: element.tagName,
            className: element.className,
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            width: Math.round(rect.width),
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
            overflowX: getComputedStyle(element).overflowX,
          })
          element = element.parentElement
        }
        return rows
      })(),
      offenders: [...document.querySelectorAll<HTMLElement>('body *')]
        .filter((element) =>
          element.getBoundingClientRect().right > window.innerWidth + 1
          && !element.closest('nav[aria-label="Settings sections"]'),
        )
        .slice(0, 8)
        .map((element) => ({
          tag: element.tagName,
          id: element.id,
          className: element.className,
          right: Math.round(element.getBoundingClientRect().right),
          width: Math.round(element.getBoundingClientRect().width),
        })),
    }))
    expect(
      mobileMetrics.overflow,
      JSON.stringify({ offenders: mobileMetrics.offenders, ancestors: mobileMetrics.navAncestors, bodyOverflow: mobileMetrics.bodyOverflow }, null, 2),
    ).toBeLessThanOrEqual(1)
    await expect(sectionNav).toBeVisible()

    expect(pageErrors, `Uncaught page errors:\n${pageErrors.join('\n')}`).toEqual([])
  })

  test('keeps every section mounted, preserves drafts, and exposes distinct switch states', async ({ page }) => {
    await loginAndOpenFirstPageSettings(page)
    await expect(page.getByTestId('page-settings-screen')).toBeVisible({ timeout: 15_000 })

    const sectionNav = page.getByRole('navigation', { name: 'Listing settings sections' })
    const listingName = page.locator('#listing-name')
    const originalName = await listingName.inputValue()
    await listingName.fill(`${originalName} - unsaved E2E draft`)

    await sectionNav.getByRole('link', { name: 'Developer' }).click()
    await expect(page).toHaveURL(/#developer$/)
    await expect(page.getByRole('heading', { name: 'General', exact: true })).toBeAttached()
    await expect(listingName).toHaveValue(`${originalName} - unsaved E2E draft`)
    const developerSection = page.locator('#developer')
    await expect(developerSection).toHaveAttribute('aria-current', 'location')
    const developerStateId = await developerSection.getAttribute('aria-describedby')
    expect(developerStateId).toBeTruthy()
    await expect(page.locator(`#${developerStateId}`)).toHaveText('Current section')
    await expect(developerSection.locator('header > span[aria-hidden="true"]')).toBeVisible()

    await page.goBack()
    await expect(listingName).toHaveValue(`${originalName} - unsaved E2E draft`)
    await expect(sectionNav.getByRole('link', { name: 'General' })).toHaveAttribute('aria-current', 'location')
    await expect(page.locator('#general')).toHaveAttribute('aria-current', 'location')
    await listingName.fill(originalName)

    const customDomainInput = page.getByPlaceholder('agents.yourcompany.com')
    const originalCustomDomain = await customDomainInput.inputValue()
    await customDomainInput.fill('agents.e2e-example.test')
    const domainSetup = page.getByRole('group', { name: 'Recommended next step: attach and detect DNS' })
    if (fixtureCustomDomainEnabled) {
      await expect(domainSetup).toHaveClass(/\bsettings-priority-card\b/)
      await expect(domainSetup.getByRole('button', { name: 'Attach & detect DNS' })).toHaveClass(/\bsettings-emphasis-action\b/)
    } else {
      await expect(domainSetup).toHaveCount(0)
      await expect(page.locator('a[title^="Custom domain - Launch plan"]')).toHaveAttribute(
        'href',
        /\/dashboard\/billing\?plan=launch$/,
      )
    }
    await customDomainInput.fill(originalCustomDomain)

    const apacheRecipe = page.getByRole('button', { name: 'Apache (.htaccess)', exact: true })
    await expect(apacheRecipe).toHaveAttribute('aria-pressed', 'true')
    await expect(apacheRecipe).toHaveClass(/\bsettings-choice-active\b/)

    const visibility = page.getByRole('switch', { name: 'Listing visibility' })
    const initialChecked = (await visibility.getAttribute('aria-checked')) === 'true'
    if (initialChecked) await visibility.click()

    const offVisual = await visibility.evaluate((control) => {
      const track = control.firstElementChild as HTMLElement
      const thumb = track.firstElementChild as HTMLElement
      return {
        background: getComputedStyle(track).backgroundColor,
        border: getComputedStyle(track).borderColor,
        thumbLeft: thumb.getBoundingClientRect().left,
      }
    })

    await visibility.click()
    await expect(visibility).toHaveAttribute('aria-checked', 'true')
    await expect
      .poll(async () => visibility.evaluate((control) => getComputedStyle(control.firstElementChild as HTMLElement).backgroundColor))
      .not.toBe(offVisual.background)
    await expect
      .poll(async () => visibility.evaluate((control) => (control.firstElementChild?.firstElementChild as HTMLElement).getBoundingClientRect().left))
      .toBeGreaterThan(offVisual.thumbLeft + 10)
    const onVisual = await visibility.evaluate((control) => {
      const track = control.firstElementChild as HTMLElement
      const thumb = track.firstElementChild as HTMLElement
      return {
        background: getComputedStyle(track).backgroundColor,
        border: getComputedStyle(track).borderColor,
        thumbLeft: thumb.getBoundingClientRect().left,
      }
    })

    expect(onVisual.background).not.toBe(offVisual.background)
    expect(onVisual.thumbLeft).toBeGreaterThan(offVisual.thumbLeft + 10)

    if (!initialChecked) await visibility.click()

    for (const viewport of [
      { width: 375, height: 760 },
      { width: 768, height: 900 },
      { width: 1280, height: 800 },
    ]) {
      await page.setViewportSize(viewport)
      const metrics = await page.evaluate(() => ({
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        shell: (() => {
          const aside = document.querySelector<HTMLElement>('.dashboard-sidebar')
          const nav = aside?.querySelector<HTMLElement>('nav')
          const describe = (element: HTMLElement | null | undefined) => element ? {
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
            rect: element.getBoundingClientRect().toJSON(),
            overflowX: getComputedStyle(element).overflowX,
            contain: getComputedStyle(element).contain,
            position: getComputedStyle(element).position,
          } : null
          return { aside: describe(aside), nav: describe(nav) }
        })(),
        overflow: [...document.querySelectorAll<HTMLElement>('body *')]
          .map((element) => {
            const rect = element.getBoundingClientRect()
            return {
              tag: element.tagName.toLowerCase(),
              className: typeof element.className === 'string' ? element.className : '',
              text: (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80),
              left: Math.round(rect.left),
              right: Math.round(rect.right),
              width: Math.round(rect.width),
            }
          })
          .filter((item) => item.right > window.innerWidth + 1 || item.left < -1)
          .sort((a, b) => Math.max(b.right - window.innerWidth, -b.left) - Math.max(a.right - window.innerWidth, -a.left))
          .slice(0, 12),
      }))
      const horizontalScroll = await page.evaluate(() => {
        window.scrollTo({ left: document.documentElement.scrollWidth, top: window.scrollY, behavior: 'instant' })
        const x = window.scrollX
        window.scrollTo({ left: 0, top: window.scrollY, behavior: 'instant' })
        return x
      })
      expect(
        horizontalScroll,
        `Page can drift horizontally at ${viewport.width}px (${metrics.documentWidth}px document): ${JSON.stringify({ shell: metrics.shell, overflow: metrics.overflow })}`,
      ).toBe(0)
    }

  })

  test('uses webhook colors only for observed test outcomes', async ({ page }) => {
    await createDisposableListing()
    test.skip(!fixtureOutboundWebhooksEnabled, 'requires a Pro-or-higher E2E entitlement')
    let releaseSuccessResponse = () => {}
    const successResponseGate = new Promise<void>((resolve) => {
      releaseSuccessResponse = () => resolve()
    })

    // This spec owns the UI state contract. Persistence authorization and
    // encryption are covered by the page-secrets route tests, so keep the
    // visual assertion independent from the shared remote E2E fixture.
    await page.route('**/api/pages/*/secrets', async (route) => {
      const body = route.request().postDataJSON() as { outbound_webhooks?: unknown }
      if (!Array.isArray(body.outbound_webhooks)) {
        await route.continue()
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      })
    })

    await page.route('**/api/test-outbound', async (route) => {
      const body = route.request().postDataJSON() as { endpoint?: string }
      const failed = body.endpoint?.includes('failure')
      if (!failed) {
        // Keep the successful request pending until the test has observed the
        // intermediate UI state. A timeout fallback prevents a failed assertion
        // from leaving the mocked request unresolved until the whole spec times out.
        await Promise.race([
          successResponseGate,
          new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
        ])
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          failed
            ? { success: false, status: 502, error: 'E2E delivery rejected' }
            : { success: true, status: 204, error: null },
        ),
      })
    })

    await loginAndOpenFirstPageSettings(page)
    await expect(page.getByTestId('page-settings-screen')).toBeVisible({ timeout: 15_000 })

    const panel = page.getByTestId('outbound-webhooks-panel')
    const summary = page.getByTestId('outbound-webhook-summary')
    const urlInput = panel.getByPlaceholder(/hooks\.zapier/i)
    const addButton = panel.getByRole('button', { name: 'Add' })
    const unique = Date.now()

    const successUrl = `https://hooks.example.com/nexez-e2e-success-${unique}`
    await urlInput.fill(successUrl)
    await addButton.click()
    const successRow = panel.getByTestId('outbound-webhook-row').filter({ hasText: successUrl })
    await expect(successRow).toBeVisible()
    await expect(summary).toHaveAttribute('data-tone', 'neutral')
    await expect(summary).toContainText(/webhooks? configured/)
    await panel.getByRole('button', { name: /Save 1 Webhook URL/i }).click()

    const successTestButton = successRow.getByRole('button', { name: 'Send Test' })
    await expect(successTestButton).toBeEnabled()
    await successTestButton.click()
    const successResult = successRow.getByTestId('outbound-test-result')
    await expect(successResult).toHaveAttribute('data-state', 'testing')
    await expect(successResult).toHaveClass(/text-\[var\(--fg-muted\)\]/)
    await expect(summary).toHaveAttribute('data-tone', 'neutral')
    releaseSuccessResponse()
    await expect(successResult).toHaveAttribute('data-state', 'success')
    await expect(successResult).toHaveClass(/text-\[var\(--ready\)\]/)
    await expect(summary).toHaveAttribute('data-tone', 'ready')
    await expect(summary).toContainText('1 webhook test passed')

    await successRow.getByRole('button', { name: 'remove' }).click()
    await expect(successRow).toHaveCount(0)
    await expect(summary).toHaveAttribute('data-tone', 'neutral')

    const failureUrl = `https://hooks.example.com/nexez-e2e-failure-${unique}`
    await urlInput.fill(failureUrl)
    await addButton.click()
    const failureRow = panel.getByTestId('outbound-webhook-row').filter({ hasText: failureUrl })
    await panel.getByRole('button', { name: /Save 1 Webhook URL/i }).click()
    const failureTestButton = failureRow.getByRole('button', { name: 'Send Test' })
    await expect(failureTestButton).toBeEnabled()
    await failureTestButton.click()
    const failureResult = failureRow.getByRole('alert')
    await expect(failureResult).toHaveAttribute('data-state', 'failure')
    await expect(failureResult).toHaveClass(/text-\[var\(--danger\)\]/)
    await expect(summary).toHaveAttribute('data-tone', 'danger')
    await expect(summary).toContainText('1 webhook test failed')

    await failureRow.getByRole('button', { name: 'remove' }).click()
    await expect(failureRow).toHaveCount(0)
  })

  test('website baseline requires approval and distinguishes observations from failed collection', async ({ page }) => {
    test.skip(!hasRealSettingsFixtureConfig(), 'requires the configured disposable E2E seller')
    const listingId = await createDisposableListing()
    const ownerId = fixtureOwnerId!
    const associationId = 'cd000000-0000-4000-8000-000000000001'
    const recordedAt = '2026-09-12T00:00:00.000Z'
    const writes: Record<string, unknown>[] = []
    let approved = false
    let collections = 0
    // Browser interaction uses synthetic API responses. No report pilot is
    // enabled, no live website is fetched, and no merchant evidence is written.
    await page.route('**/api/merchant/website-baseline**', async route => {
      if (route.request().method() === 'POST') {
        const input = route.request().postDataJSON() as Record<string, unknown>
        writes.push(input)
        if (input.action === 'approve') approved = true
        if (input.action === 'collect') collections++
        if (input.action === 'revoke') { approved = false; collections = 0 }
      }
      const association = approved ? { id: associationId, origin: 'https://example.com', method: 'merchant_approved', confirmedAt: recordedAt, expiresAt: '2026-10-01T00:00:00.000Z' } : null
      const latest = collections ? {
        id: 'dd000000-0000-4000-8000-000000000001', associationId, origin: 'https://example.com', associationMethod: 'merchant_approved',
        scannerVersion: 'site-scan-2.1', rubricId: 'nexez.website-agent-readiness', provenance: 'merchant_website_snapshot',
        evaluatedAt: recordedAt, createdAt: recordedAt, sourceVersion: `sha256:${'a'.repeat(64)}`,
        result: collections === 1 ? { version: 2, score: 100, checks: Object.keys(SCAN_CHECK_COPY).map(id => ({ id, status: 'pass' })) } : null,
        failure: collections === 1 ? null : 'robots_denied',
      } : null
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ownerId, listingId, collectionEnabled: true,
        suggestedOrigin: 'https://example.com', association, latest, attempt: null }) })
    })
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await loginToDashboard(page)
    await page.goto(`/dashboard/${listingId}/settings`, { waitUntil: 'domcontentloaded' })
    const panel = page.getByRole('region', { name: 'Website baseline', exact: true })
    await expect(panel).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Approve website' })).toBeDisabled()
    await panel.getByRole('checkbox').check()
    await panel.getByRole('button', { name: 'Approve website' }).click()
    await expect(panel.getByRole('button', { name: 'Collect baseline' })).toBeEnabled()
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({ action: 'approve', listingId, origin: 'https://example.com', attested: true, approvalVersion: 'merchant-website-v1' })
    expect(writes[0]).not.toHaveProperty('ownerId')
    await panel.getByRole('button', { name: 'Collect baseline' }).click()
    await expect(panel.getByText('Website agent readiness: 100%')).toBeVisible()
    await expect(panel.getByText(/does not establish a trend/)).toBeVisible()
    if (process.env.NEXEZ_WEBSITE_SCREENSHOT) await panel.screenshot({ path: process.env.NEXEZ_WEBSITE_SCREENSHOT })
    await page.setViewportSize({ width: 375, height: 812 })
    expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    await panel.getByRole('button', { name: 'Check website again' }).click()
    await expect(panel.getByText(/failed collection is not a score of zero/)).toBeVisible()
    await expect(panel.getByText('Website agent readiness: 100%')).toHaveCount(0)
    await panel.getByRole('button', { name: 'Revoke website approval' }).click()
    await expect(panel.getByRole('button', { name: 'Approve website' })).toBeDisabled()
    await expect(panel.getByRole('heading', { name: 'Latest observation' })).toHaveCount(0)
    expect(errors).toEqual([])
  })

  test('calendar availability API blocks anonymous requests', async ({ request }) => {
    const res = await request.post('/api/integrations/google-calendar/availability', {
      data: { calendarId: 'e2e-calendar@example.com' },
    })
    expect(res.status()).toBe(401)
    const json = await res.json()
    expect(json.error).toBe('Not authenticated')
  })
})

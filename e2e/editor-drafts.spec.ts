import { test, expect, type Page } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { loginWithPassword } from './auth'

const email = process.env.E2E_EMAIL
const password = process.env.E2E_PASSWORD
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const service = { name: 'Preserved consultation', description: 'Keep the merchant offer configuration.', price: '$250', duration: '60 minutes', cta_url: 'https://example.com/contact' }
const product = { name: 'Preserved guide', description: 'Keep the merchant product.', price: '$25', cta_url: 'https://example.com/guide' }

let db: SupabaseClient | null = null
let ownerId: string | null = null
let pageId: string | null = null
let originalPlan: unknown
let adjustedPlan = false

async function storedPage() {
  const { data, error } = await db!.from('pages').select('name,description,services,products,faqs,industry,prefer_original_site,is_published,draft,updated_at').eq('id', pageId!).single()
  expect(error).toBeNull()
  return data!
}

async function writeWith(page: Page, button: string) {
  const saved = page.waitForResponse(response => new URL(response.url()).pathname === '/rest/v1/pages' && response.request().method() === 'PATCH')
  await page.getByRole('button', { name: button, exact: true }).click()
  expect((await saved).status()).toBe(200)
}

test.describe('merchant draft preservation', () => {
  test.beforeAll(async () => {
    if (!email || !password || !supabaseUrl || !supabaseKey) return
    db = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data, error } = await db.auth.signInWithPassword({ email, password })
    if (error || !data.user) throw new Error('Could not authenticate the draft fixture owner.')
    ownerId = data.user.id
    const selectedPlan = data.user.user_metadata?.plan
    if (!['free', 'launch', 'pro', 'scale'].includes(selectedPlan)) {
      originalPlan = selectedPlan ?? null
      const updated = await db.auth.updateUser({ data: { plan: 'free' } })
      if (updated.error) throw new Error('Could not prepare the draft fixture owner.')
      adjustedPlan = true
    }
  })

  test.beforeEach(async () => {
    test.skip(!db || !ownerId, 'set E2E credentials and public Supabase keys')
    const { data, error } = await db!.from('pages').insert({
      owner_id: ownerId!, name: 'Nexez draft preservation E2E', slug: `draft-proof-${crypto.randomUUID()}`,
      description: 'Live description before draft publication.', website_url: 'https://example.com',
      cta_url: 'https://example.com/contact', cta_label: 'Contact us', industry: 'consulting',
      services: [service], products: [product], faqs: [], prefer_original_site: true, is_published: false,
      draft: { description: 'Merchant-reviewed staged description.' }, draft_updated_at: new Date().toISOString(),
    }).select('id').single()
    if (error || !data?.id) throw new Error('Could not create the private draft fixture.')
    pageId = data.id
  })

  test.afterEach(async () => {
    if (!db || !pageId) return
    const { data, error } = await db.from('pages').delete().eq('id', pageId).eq('is_published', false).select('id').single()
    if (error || data?.id !== pageId) throw new Error('Could not remove the private draft fixture.')
    pageId = null
  })

  test.afterAll(async () => {
    if (!db) return
    let restoreFailed = false
    if (adjustedPlan) {
      const { error } = await db.auth.updateUser({ data: { plan: originalPlan } })
      restoreFailed = Boolean(error)
    }
    await db.auth.signOut({ scope: 'local' })
    if (restoreFailed) throw new Error('Could not restore the draft fixture owner metadata.')
  })

  test('a partial draft opens for review and publishes without resetting other fields', async ({ page }) => {
    await loginWithPassword(page, { email: email!, password: password!, destination: `/dashboard/${pageId}` })
    await page.waitForLoadState('networkidle')
    await expect(page.locator('textarea[required]').first()).toHaveValue('Merchant-reviewed staged description.')
    const before = await storedPage()
    await writeWith(page, 'Publish draft → live')
    await expect(page.getByText('Draft applied. Publish the listing when you are ready to make it public.')).toBeVisible()
    const after = await storedPage()
    expect(after).toEqual({ ...before, description: 'Merchant-reviewed staged description.', draft: null, updated_at: after.updated_at })
    expect(after.updated_at).not.toBe(before.updated_at)
  })

  test('an older tab cannot overwrite a new draft, and the current tab can still publish', async ({ page, context }) => {
    await loginWithPassword(page, { email: email!, password: password!, destination: `/dashboard/${pageId}` })
    await page.waitForLoadState('networkidle')
    const stale = await context.newPage()
    try {
      await stale.goto(`/dashboard/${pageId}`, { waitUntil: 'networkidle' })
      await expect(stale.locator('textarea[required]').first()).toHaveValue('Merchant-reviewed staged description.')
      await page.locator('textarea[required]').first().fill('Newer merchant draft from the current tab.')
      await writeWith(page, 'Save as draft')
      await expect(page.getByText(/Draft saved \(staged\)/)).toBeVisible()
      const saved = await storedPage()
      expect(saved.draft.description).toBe('Newer merchant draft from the current tab.')
      expect(saved.description).toBe('Live description before draft publication.')

      await writeWith(stale, 'Publish draft → live')
      await expect(stale.getByText(/This listing changed or your access ended/)).toBeVisible()
      expect(await storedPage()).toEqual(saved)

      await writeWith(page, 'Publish draft → live')
      await expect(page.getByText('Draft applied. Publish the listing when you are ready to make it public.')).toBeVisible()
      const published = await storedPage()
      expect(published.description).toBe('Newer merchant draft from the current tab.')
      expect(published.draft).toBeNull()
      expect(published.is_published).toBe(false)
      expect(published.services).toEqual([service])
      expect(published.products).toEqual([product])
      expect(published.prefer_original_site).toBe(true)
    } finally {
      await stale.close()
    }
  })
})

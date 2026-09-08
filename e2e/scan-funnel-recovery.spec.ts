import { test, expect } from '@playwright/test'

test('homepage scan prefill survives hydration and preserves user edits', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  // Inspect the real browser request without creating a scan or external probes.
  let submitted: unknown
  await page.route('**/api/scan', async (route) => {
    submitted = route.request().postDataJSON()
    await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Verification only' }) })
  })
  await page.goto('/?url=https%3A%2F%2Fexample.com%2Fservices', { waitUntil: 'domcontentloaded' })
  const input = page.getByLabel('Website URL to scan')
  await expect(input).toHaveValue('https://example.com/services')
  await input.fill('https://example.com/edited')
  await page.getByRole('button', { name: 'Scan my site' }).click()
  await expect.poll(() => submitted).toEqual({ url: 'https://example.com/edited', source: 'hero' })
  expect(errors).toEqual([])
})

test('scan page sends an explicit source without requiring a referrer', async ({ page }) => {
  let submitted: unknown
  await page.route('**/api/scan', async (route) => {
    submitted = route.request().postDataJSON()
    await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Verification only' }) })
  })
  await page.goto('/scan', { waitUntil: 'domcontentloaded' })
  await page.getByLabel('Website URL to scan').fill('example.com')
  await page.getByRole('button', { name: /see what agents see/i }).click()
  await expect.poll(() => submitted).toEqual({ url: 'example.com', source: 'scan-page' })
})

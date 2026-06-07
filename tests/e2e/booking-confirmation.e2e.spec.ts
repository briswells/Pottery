import { test, expect } from '@playwright/test'

const SLUG = '6wk-wheel-throwing-tuesdays'

test('confirmation page shows success, class title, and reference', async ({ page }) => {
  await page.goto(`/classes/${SLUG}/confirmed?ref=1234`)
  await expect(page.getByRole('heading', { name: 'Payment successful!' })).toBeVisible()
  await expect(page.getByText(/6wk Wheel Throwing/)).toBeVisible()
  await expect(page.getByText('Reference: #1234')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Browse more classes' })).toBeVisible()
})

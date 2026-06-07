import { test, expect } from '@playwright/test'

const SLUG = '6wk-wheel-throwing-tuesdays'

test('confirmation page shows success, class title, and reference', async ({ page }) => {
  await page.goto(`/classes/${SLUG}/confirmed?ref=1234`)
  await expect(page.getByRole('heading', { name: 'Payment successful!' })).toBeVisible()
  await expect(page.getByText(/6wk Wheel Throwing/)).toBeVisible()
  await expect(page.getByText('Reference: #1234')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Browse more classes' })).toBeVisible()
})

test('payment area stays hidden until a complete email is entered', async ({ page }) => {
  await page.goto(`/classes/${SLUG}`)

  const prompt = page.getByText('Enter your name and email to continue to payment.')
  await expect(prompt).toBeVisible()
  await expect(page.getByRole('button', { name: /Book & pay/ })).toHaveCount(0)

  // Name + a partial email must NOT reveal the payment area.
  await page.getByPlaceholder('Your name').fill('Test Customer')
  await page.getByPlaceholder('Email').fill('test@')
  await expect(prompt).toBeVisible()
  await expect(page.getByRole('button', { name: /Book & pay/ })).toHaveCount(0)

  // Completing the email reveals it.
  await page.getByPlaceholder('Email').fill('test@example.com')
  await expect(prompt).toBeHidden()
  await expect(page.getByRole('button', { name: /Book & pay/ })).toBeVisible()
})

test('card field loads (no InvalidStyles error) once identity is complete', async ({ page }) => {
  await page.goto(`/classes/${SLUG}`)
  await page.getByPlaceholder('Your name').fill('Test Customer')
  await page.getByPlaceholder('Email').fill('test@example.com')

  // Square injects an iframe into #card-container once card() + attach() succeed.
  // If the style object is rejected (e.g. an unsupported fontFamily), card()
  // throws and this iframe never appears.
  await expect(page.locator('#card-container iframe')).toBeVisible({ timeout: 15000 })
  await expect(
    page.getByText('The payment form could not be loaded. Please refresh and try again.'),
  ).toHaveCount(0)
})

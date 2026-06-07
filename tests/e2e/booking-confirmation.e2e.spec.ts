import { test, expect } from '@playwright/test'

const SLUG = '6wk-wheel-throwing-tuesdays'

test('confirmation page shows success, class title, and reference', async ({ page }) => {
  await page.goto(`/classes/${SLUG}/confirmed?ref=1234`)
  await expect(page.getByRole('heading', { name: 'Payment successful!' })).toBeVisible()
  await expect(page.getByText(/6wk Wheel Throwing/)).toBeVisible()
  await expect(page.getByText('Reference: #1234')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Browse more classes' })).toBeVisible()
})

test('payment area is hidden until name and email are entered', async ({ page }) => {
  await page.goto(`/classes/${SLUG}`)

  const prompt = page.getByText('Enter your name and email to continue to payment.')
  await expect(prompt).toBeVisible()
  await expect(page.getByRole('button', { name: /Book & pay/ })).toHaveCount(0)

  await page.getByPlaceholder('Your name').fill('Test Customer')
  await page.getByPlaceholder('Email').fill('test@example.com')

  await expect(prompt).toBeHidden()
  await expect(page.getByRole('button', { name: /Book & pay/ })).toBeVisible()
})

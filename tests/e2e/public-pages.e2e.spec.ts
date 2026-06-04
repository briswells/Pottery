import { test, expect } from '@playwright/test'

test('home shows hero headline', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Where clay meets community' })).toBeVisible()
})

test('classes page lists a seeded class', async ({ page }) => {
  await page.goto('/classes')
  await expect(page.getByRole('link', { name: /6wk Wheel Throwing/ })).toBeVisible()
})

test('membership page shows the price', async ({ page }) => {
  await page.goto('/membership')
  await expect(page.getByText('$200 / month')).toBeVisible()
})

test('staff page shows Eric and Naiomi', async ({ page }) => {
  await page.goto('/staff')
  await expect(page.getByRole('heading', { name: 'Eric' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Naiomi' })).toBeVisible()
})

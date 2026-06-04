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

test('home renders a hero image from media API', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('img[src*="/api/media/file/"]').first()).toBeVisible()
})

test('home gallery renders multiple media images', async ({ page }) => {
  await page.goto('/')
  const count = await page.locator('img[src*="/api/media/file/"]').count()
  expect(count).toBeGreaterThan(3)
})

test('staff page renders staff photos from media API', async ({ page }) => {
  await page.goto('/staff')
  await expect(page.locator('img[src*="/api/media/file/"]').first()).toBeVisible()
})

test('classes page renders a class thumbnail image', async ({ page }) => {
  await page.goto('/classes')
  await expect(page.locator('img[src*="/api/media/file/"]').first()).toBeVisible()
})

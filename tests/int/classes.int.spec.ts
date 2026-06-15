import { describe, it, expect, beforeEach } from 'vitest'
import { getTestPayload } from './helpers'

describe('Classes', () => {
  beforeEach(async () => {
    const payload = await getTestPayload()
    const existing = await payload.find({ collection: 'classes', limit: 1000 })
    await Promise.all(existing.docs.map((d) => payload.delete({ collection: 'classes', id: d.id })))
  })

  it('auto-generates a slug from the title when none is provided', async () => {
    const payload = await getTestPayload()
    const cls = await payload.create({
      collection: 'classes',
      data: {
        title: '6wk Wheel Throwing (Tuesdays)',
        defaultPriceCents: 22000,
        defaultCapacity: 8,
      },
    })
    expect(cls.slug).toBe('6wk-wheel-throwing-tuesdays')
  })

  it('defaults status to active', async () => {
    const payload = await getTestPayload()
    const cls = await payload.create({
      collection: 'classes',
      data: { title: 'Raku Day', defaultPriceCents: 9000, defaultCapacity: 10 },
    })
    expect(cls.status).toBe('active')
  })

  it('produces a non-empty slug even when the title has no ASCII characters', async () => {
    const payload = await getTestPayload()
    const cls = await payload.create({
      collection: 'classes',
      data: { title: '陶芸', defaultPriceCents: 5000, defaultCapacity: 6 },
    })
    expect(cls.slug).toBeTruthy()
    expect(String(cls.slug).length).toBeGreaterThan(0)
  })

  it('normalizes an explicitly provided slug', async () => {
    const payload = await getTestPayload()
    const cls = await payload.create({
      collection: 'classes',
      data: { title: 'Anything', slug: 'Custom Slug!', defaultPriceCents: 5000, defaultCapacity: 6 },
    })
    expect(cls.slug).toBe('custom-slug')
  })
})

import { describe, it, expect } from 'vitest'
import { getTestPayload } from './helpers'

describe('Classes', () => {
  it('auto-generates a slug from the title when none is provided', async () => {
    const payload = await getTestPayload()
    const cls = await payload.create({
      collection: 'classes',
      data: {
        title: '6wk Wheel Throwing (Tuesdays)',
        category: 'wheel-series',
        priceCents: 22000,
        capacity: 8,
        scheduleText: 'Tuesdays 6–8pm, starts soon',
      },
    })
    expect(cls.slug).toBe('6wk-wheel-throwing-tuesdays')
  })

  it('defaults status to active', async () => {
    const payload = await getTestPayload()
    const cls = await payload.create({
      collection: 'classes',
      data: { title: 'Raku Day', category: 'raku', priceCents: 9000, capacity: 10, scheduleText: 'Sat' },
    })
    expect(cls.status).toBe('active')
  })
})

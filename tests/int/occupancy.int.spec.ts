import { describe, it, expect } from 'vitest'
import { getTestPayload } from './helpers'
import { seatsRemaining } from '../../src/lib/occupancy'

describe('seatsRemaining', () => {
  it('counts paid and pending bookings against capacity', async () => {
    const payload = await getTestPayload()
    const cls = await payload.create({
      collection: 'classes',
      data: { title: `Cap Test ${Date.now()}`, category: 'raku', priceCents: 1000, capacity: 2, scheduleText: 'x' },
    })
    expect(await seatsRemaining(payload, cls.id)).toBe(2)

    await payload.create({ collection: 'bookings', data: {
      class: cls.id, customerName: 'A', customerEmail: 'a@test.local', amountCents: 1000, status: 'paid',
    }, overrideAccess: true })
    await payload.create({ collection: 'bookings', data: {
      class: cls.id, customerName: 'B', customerEmail: 'b@test.local', amountCents: 1000, status: 'pending',
    }, overrideAccess: true })

    expect(await seatsRemaining(payload, cls.id)).toBe(0)
  })

  it('ignores cancelled bookings', async () => {
    const payload = await getTestPayload()
    const cls = await payload.create({
      collection: 'classes',
      data: { title: `Cap Test2 ${Date.now()}`, category: 'raku', priceCents: 1000, capacity: 1, scheduleText: 'x' },
    })
    await payload.create({ collection: 'bookings', data: {
      class: cls.id, customerName: 'C', customerEmail: 'c@test.local', amountCents: 1000, status: 'cancelled',
    }, overrideAccess: true })
    expect(await seatsRemaining(payload, cls.id)).toBe(1)
  })
})

import { describe, it, expect, afterAll } from 'vitest'
import { getTestPayload } from './helpers'
import { seatsRemaining } from '../../src/lib/occupancy'

async function makeInstance(payload: any, capacity: number) {
  const cls = await payload.create({ collection: 'classes', data: {
    title: `Cap ${Date.now()}-${Math.random()}`, defaultPriceCents: 1000, defaultCapacity: capacity,
  } })
  const user = await payload.create({ collection: 'users', data: {
    name: 'Inst', email: `inst-${Date.now()}-${Math.random()}@test.local`, password: 'test12345', roles: ['instructor'],
  } })
  return payload.create({ collection: 'class-instances', data: {
    class: cls.id, instructor: user.id, startDate: '2026-07-07', startTime: '18:00', endTime: '20:00', status: 'published', capacity,
  } })
}

describe('seatsRemaining', () => {
  afterAll(async () => {
    const payload = await getTestPayload()
    await payload.delete({ collection: 'payments', where: {} })
    await payload.delete({ collection: 'bookings', where: {} })
    await payload.delete({ collection: 'class-instances', where: {} })
    await payload.delete({ collection: 'classes', where: {} })
  })

  it('counts paid and pending bookings against capacity', async () => {
    const payload = await getTestPayload()
    const inst = await makeInstance(payload, 2)
    expect(await seatsRemaining(payload, inst.id)).toBe(2)
    await payload.create({ collection: 'bookings', overrideAccess: true, data: {
      classInstance: inst.id, customerName: 'A', customerEmail: 'a@test.local', amountCents: 1000, status: 'paid',
    } })
    await payload.create({ collection: 'bookings', overrideAccess: true, data: {
      classInstance: inst.id, customerName: 'B', customerEmail: 'b@test.local', amountCents: 1000, status: 'pending',
    } })
    expect(await seatsRemaining(payload, inst.id)).toBe(0)
  })

  it('ignores cancelled bookings', async () => {
    const payload = await getTestPayload()
    const inst = await makeInstance(payload, 1)
    await payload.create({ collection: 'bookings', overrideAccess: true, data: {
      classInstance: inst.id, customerName: 'C', customerEmail: 'c@test.local', amountCents: 1000, status: 'cancelled',
    } })
    expect(await seatsRemaining(payload, inst.id)).toBe(1)
  })
})

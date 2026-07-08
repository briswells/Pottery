import { describe, it, expect, afterAll } from 'vitest'
import { getTestPayload } from './helpers'
import { backfillPeople } from '../../scripts/backfill-people'

describe('backfillPeople', () => {
  afterAll(async () => {
    const payload = await getTestPayload()
    await payload.delete({ collection: 'payments', where: {} })
    await payload.delete({ collection: 'bookings', where: { customerEmail: { like: '@bf.local' } } })
    await payload.delete({ collection: 'firing-requests', where: { email: { like: '@bf.local' } } })
    await payload.delete({ collection: 'class-instances', where: {} })
    await payload.delete({ collection: 'classes', where: {} })
    await payload.delete({ collection: 'people', where: { email: { like: '@bf.local' } } })
  })

  it('collapses a shared email across a booking + firing into one person and is idempotent', async () => {
    const payload = await getTestPayload()
    const cls = await payload.create({ collection: 'classes', data: { title: `BF ${Date.now()}`, defaultPriceCents: 100, defaultCapacity: 5 } })
    const user = await payload.create({ collection: 'users', data: { name: 'BF Inst', email: `bf-inst-${Date.now()}@test.local`, password: 'test12345', roles: ['instructor'] } })
    const inst = await payload.create({ collection: 'class-instances', data: { class: cls.id, instructor: user.id, startDate: '2026-07-07', startTime: '18:00', endTime: '20:00', status: 'published' } })
    // Booking and firing with no person link, same email, different case.
    await payload.create({ collection: 'bookings', overrideAccess: true, data: { classInstance: inst.id, customerName: 'Shared', customerEmail: 'shared@bf.local', amountCents: 100, status: 'paid' } })
    await payload.create({ collection: 'firing-requests', overrideAccess: true, data: { name: 'Shared', email: 'SHARED@bf.local', description: 'pot', halfShelves: 1, amountCents: 2500, stonewareConfirmed: true, status: 'pending' } })

    await backfillPeople(payload)

    const people = await payload.find({ collection: 'people', where: { email: { equals: 'shared@bf.local' } } })
    expect(people.totalDocs).toBe(1)
    const personId = people.docs[0].id
    const bookings = await payload.find({ collection: 'bookings', where: { customerEmail: { equals: 'shared@bf.local' } }, depth: 0 })
    const firings = await payload.find({ collection: 'firing-requests', where: { email: { equals: 'SHARED@bf.local' } }, depth: 0 })
    expect(bookings.docs[0].person).toBe(personId)
    expect(firings.docs[0].person).toBe(personId)

    // Idempotent: a second run links nothing new and creates no duplicate person.
    const second = await backfillPeople(payload)
    expect(second.linked).toBe(0)
    const peopleAfter = await payload.count({ collection: 'people', where: { email: { equals: 'shared@bf.local' } } })
    expect(peopleAfter.totalDocs).toBe(1)
  })
})

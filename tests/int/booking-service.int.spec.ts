import { describe, it, expect, vi, afterAll } from 'vitest'
import { getTestPayload } from './helpers'
import { createPaidBooking } from '../../src/services/booking'

function deps(overrides = {}) {
  return {
    charge: vi.fn(async () => ({ paymentId: 'pay_123', status: 'COMPLETED' })),
    sendEmail: vi.fn(async () => {}),
    ...overrides,
  }
}

async function makeClass(payload: any, capacity: number) {
  return payload.create({ collection: 'classes', data: {
    title: `Svc ${Date.now()}-${Math.round(capacity)}`, category: 'wheel-series',
    priceCents: 22000, capacity, scheduleText: 'x',
  } })
}

describe('createPaidBooking', () => {
  // Bookings hold a required (NOT NULL) relationship to classes, so leaving
  // them in the shared test DB makes other suites' class cleanup fail. Tear
  // down children (payments -> bookings) then the classes we created.
  afterAll(async () => {
    const payload = await getTestPayload()
    await payload.delete({ collection: 'payments', where: {} })
    await payload.delete({ collection: 'bookings', where: {} })
    await payload.delete({ collection: 'classes', where: {} })
    await payload.delete({ collection: 'people', where: { email: { like: '@test.local' } } })
  })

  it('charges the DB price (not the client) and records a paid booking + payment', async () => {
    const payload = await getTestPayload()
    const cls = await makeClass(payload, 5)
    const d = deps()
    const booking = await createPaidBooking({ payload, ...d }, {
      classId: cls.id, sourceId: 'cnon:fake', customerName: 'Jo', customerEmail: 'jo@test.local',
    })
    expect(d.charge).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 22000, sourceId: 'cnon:fake' }))
    expect(booking.status).toBe('paid')
    expect(booking.squarePaymentId).toBe('pay_123')
    const pays = await payload.find({ collection: 'payments', where: { squareId: { equals: 'pay_123' } } })
    expect(pays.totalDocs).toBe(1)
    expect(d.sendEmail).toHaveBeenCalledOnce()
  })

  it('rejects when the class is full and does not charge', async () => {
    const payload = await getTestPayload()
    const cls = await makeClass(payload, 1)
    const d = deps()
    await createPaidBooking({ payload, ...d }, { classId: cls.id, sourceId: 'cnon:a', customerName: 'A', customerEmail: 'a@t.local' })
    d.charge.mockClear()
    await expect(
      createPaidBooking({ payload, ...d }, { classId: cls.id, sourceId: 'cnon:b', customerName: 'B', customerEmail: 'b@t.local' }),
    ).rejects.toThrow(/full/i)
    expect(d.charge).not.toHaveBeenCalled()
  })

  it('cancels the pending booking if the charge fails (frees the seat)', async () => {
    const payload = await getTestPayload()
    const cls = await makeClass(payload, 1)
    const d = deps({ charge: vi.fn(async () => { throw new Error('card declined') }) })
    await expect(
      createPaidBooking({ payload, ...d }, { classId: cls.id, sourceId: 'cnon:x', customerName: 'X', customerEmail: 'x@t.local' }),
    ).rejects.toThrow(/declined/i)
    const remaining = await payload.count({ collection: 'bookings', where: { and: [
      { class: { equals: cls.id } }, { status: { in: ['paid', 'pending'] } },
    ] } })
    expect(remaining.totalDocs).toBe(0)
  })

  it('never oversells a class under concurrent booking attempts', async () => {
    const payload = await getTestPayload()
    const cls = await makeClass(payload, 1)
    await Promise.allSettled([
      createPaidBooking({ payload, ...deps() }, { classId: cls.id, sourceId: 'cnon:p1', customerName: 'P1', customerEmail: 'p1@t.local' }),
      createPaidBooking({ payload, ...deps() }, { classId: cls.id, sourceId: 'cnon:p2', customerName: 'P2', customerEmail: 'p2@t.local' }),
    ])
    const paid = await payload.count({ collection: 'bookings', where: { and: [
      { class: { equals: cls.id } }, { status: { equals: 'paid' } },
    ] } })
    const occupied = await payload.count({ collection: 'bookings', where: { and: [
      { class: { equals: cls.id } }, { status: { in: ['paid', 'pending'] } },
    ] } })
    expect(paid.totalDocs).toBeLessThanOrEqual(1)
    expect(occupied.totalDocs).toBeLessThanOrEqual(1)
  })

  it('links the booking to a person, reusing the same person on a repeat email', async () => {
    const payload = await getTestPayload()
    const cls = await makeClass(payload, 5)
    const d = deps()
    const first = await createPaidBooking({ payload, ...d }, {
      classId: cls.id, sourceId: 'cnon:fake', customerName: 'Repeat', customerEmail: 'repeat@test.local', customerPhone: '999',
    })
    const firstFull = await payload.findByID({ collection: 'bookings', id: first.id, depth: 0 })
    expect(firstFull.person).toBeTruthy()

    const cls2 = await makeClass(payload, 5)
    const second = await createPaidBooking({ payload, ...d }, {
      classId: cls2.id, sourceId: 'cnon:fake2', customerName: 'Repeat', customerEmail: 'REPEAT@test.local',
    })
    const secondFull = await payload.findByID({ collection: 'bookings', id: second.id, depth: 0 })
    expect(secondFull.person).toBe(firstFull.person) // same person id
  })

  it('booking by an existing member email links to that member without clobbering their plan/status', async () => {
    const payload = await getTestPayload()
    // Create a free membership plan for this test
    const plan = await payload.create({
      collection: 'membership-plans',
      overrideAccess: true,
      data: { name: `Free ${Date.now()}`, kind: 'free' },
    })
    // Create a person who is already an active member
    const member = await payload.create({
      collection: 'people',
      overrideAccess: true,
      data: { name: 'Existing Member', email: 'member@test.local', plan: plan.id, status: 'active' },
    })
    // Book a class using the member's email
    const cls = await makeClass(payload, 5)
    const d = deps()
    const booking = await createPaidBooking({ payload, ...d }, {
      classId: cls.id, sourceId: 'cnon:member', customerName: 'Existing Member', customerEmail: 'member@test.local',
    })
    // Booking must link to the existing member, not a new duplicate
    const bookingFull = await payload.findByID({ collection: 'bookings', id: booking.id, depth: 0 })
    expect(bookingFull.person).toBe(member.id)
    // Re-fetch the person and confirm plan/status were NOT clobbered
    const personAfter = await payload.findByID({ collection: 'people', id: member.id, depth: 0 })
    expect(personAfter.plan).toBe(plan.id)
    expect(personAfter.status).toBe('active')
    // Confirm no duplicate person was created
    const count = await payload.count({ collection: 'people', where: { email: { equals: 'member@test.local' } } })
    expect(count.totalDocs).toBe(1)
    // Clean up membership-plan created in this test
    await payload.delete({ collection: 'membership-plans', id: plan.id, overrideAccess: true })
  })
})

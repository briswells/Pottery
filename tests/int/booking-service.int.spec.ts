import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { getTestPayload } from './helpers'
import { createPaidBooking } from '../../src/services/booking'

function deps(overrides = {}) {
  return {
    charge: vi.fn(async () => ({ paymentId: 'pay_123', status: 'COMPLETED' })),
    sendEmail: vi.fn(async () => {}),
    createOrder: vi.fn(async () => 'order_test_1'),
    ...overrides,
  }
}

async function makeInstance(payload: any, capacity: number, status = 'published', priceCents = 22000) {
  const cls = await payload.create({ collection: 'classes', data: {
    title: `Svc ${Date.now()}-${Math.random()}`, defaultPriceCents: priceCents, defaultCapacity: capacity,
  } })
  const user = await payload.create({ collection: 'users', data: {
    name: 'Inst', email: `inst-${Date.now()}-${Math.random()}@test.local`, password: 'test12345', roles: ['instructor'],
  } })
  return payload.create({ collection: 'class-instances', data: {
    class: cls.id, instructor: user.id, startDate: '2026-07-07', endDate: '2026-08-11',
    daysOfWeek: ['TU'], startTime: '18:00', endTime: '20:00', status, capacity, priceCents,
  } })
}

async function mkFixedCoupon(payload: any, amountOffCents: number) {
  return payload.create({ collection: 'coupons', overrideAccess: true, data: {
    code: `SVCTAX${Date.now()}${Math.floor(Math.random() * 1e4)}`, discountType: 'fixed', amountOffCents,
  } })
}

describe('createPaidBooking', () => {
  // Pin the checkout tax rate to 0 so this file's legacy (pre-tax) amount
  // assertions stay valid regardless of the Site Settings default.
  beforeAll(async () => {
    const payload = await getTestPayload()
    await payload.updateGlobal({ slug: 'site-settings', data: { salesTaxPercent: 0 }, overrideAccess: true })
  })

  afterAll(async () => {
    const payload = await getTestPayload()
    await payload.delete({ collection: 'payments', where: {} })
    await payload.delete({ collection: 'bookings', where: {} })
    await payload.delete({ collection: 'class-instances', where: {} })
    await payload.delete({ collection: 'classes', where: {} })
    await payload.delete({ collection: 'people', where: { email: { like: '@test.local' } } })
  })

  it('charges the DB price and records a paid booking + payment + ICS email', async () => {
    const payload = await getTestPayload()
    const inst = await makeInstance(payload, 5)
    const d = deps()
    const booking = await createPaidBooking({ payload, ...d }, {
      classInstanceId: inst.id, sourceId: 'cnon:fake', customerName: 'Jo', customerEmail: 'jo@test.local',
    })
    expect(d.charge).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 22000, sourceId: 'cnon:fake' }))
    expect(booking.status).toBe('paid')
    expect(booking.squarePaymentId).toBe('pay_123')
    const pays = await payload.find({ collection: 'payments', where: { squareId: { equals: 'pay_123' } } })
    expect(pays.totalDocs).toBe(1)
    // Confirmation email carries a class.ics attachment.
    const emailArg: any = (d.sendEmail as any).mock.calls[0][0]
    expect(emailArg.attachments[0].filename).toBe('class.ics')
    expect(emailArg.attachments[0].content.toString()).toContain('BEGIN:VCALENDAR')
  })

  it('refuses to book an unpublished instance', async () => {
    const payload = await getTestPayload()
    const inst = await makeInstance(payload, 5, 'draft')
    const d = deps()
    await expect(createPaidBooking({ payload, ...d }, {
      classInstanceId: inst.id, sourceId: 'cnon:x', customerName: 'X', customerEmail: 'x@test.local',
    })).rejects.toThrow(/not available/i)
    expect(d.charge).not.toHaveBeenCalled()
  })

  it('rejects when the instance is full and does not charge', async () => {
    const payload = await getTestPayload()
    const inst = await makeInstance(payload, 1)
    const d = deps()
    await createPaidBooking({ payload, ...d }, { classInstanceId: inst.id, sourceId: 'cnon:a', customerName: 'A', customerEmail: 'a@t.local' })
    d.charge.mockClear()
    await expect(createPaidBooking({ payload, ...d }, {
      classInstanceId: inst.id, sourceId: 'cnon:b', customerName: 'B', customerEmail: 'b@t.local',
    })).rejects.toThrow(/full/i)
    expect(d.charge).not.toHaveBeenCalled()
  })

  it('cancels the pending booking if the charge fails (frees the seat)', async () => {
    const payload = await getTestPayload()
    const inst = await makeInstance(payload, 1)
    const d = deps({ charge: vi.fn(async () => { throw new Error('card declined') }) })
    await expect(createPaidBooking({ payload, ...d }, {
      classInstanceId: inst.id, sourceId: 'cnon:x', customerName: 'X', customerEmail: 'x@t.local',
    })).rejects.toThrow(/declined/i)
    const remaining = await payload.count({ collection: 'bookings', where: { and: [
      { classInstance: { equals: inst.id } }, { status: { in: ['paid', 'pending'] } },
    ] } })
    expect(remaining.totalDocs).toBe(0)
  })

  it('never oversells under concurrent attempts', async () => {
    const payload = await getTestPayload()
    const inst = await makeInstance(payload, 1)
    await Promise.allSettled([
      createPaidBooking({ payload, ...deps() }, { classInstanceId: inst.id, sourceId: 'cnon:p1', customerName: 'P1', customerEmail: 'p1@t.local' }),
      createPaidBooking({ payload, ...deps() }, { classInstanceId: inst.id, sourceId: 'cnon:p2', customerName: 'P2', customerEmail: 'p2@t.local' }),
    ])
    const occupied = await payload.count({ collection: 'bookings', where: { and: [
      { classInstance: { equals: inst.id } }, { status: { in: ['paid', 'pending'] } },
    ] } })
    expect(occupied.totalDocs).toBeLessThanOrEqual(1)
  })

  it('links the booking to a person, reusing the same person on a repeat email', async () => {
    const payload = await getTestPayload()
    const inst = await makeInstance(payload, 5)
    const d = deps()
    const first = await createPaidBooking({ payload, ...d }, {
      classInstanceId: inst.id, sourceId: 'cnon:fake', customerName: 'Repeat', customerEmail: 'repeat@test.local', customerPhone: '999',
    })
    const firstFull = await payload.findByID({ collection: 'bookings', id: first.id, depth: 0 })
    expect(firstFull.person).toBeTruthy()
    const inst2 = await makeInstance(payload, 5)
    const second = await createPaidBooking({ payload, ...d }, {
      classInstanceId: inst2.id, sourceId: 'cnon:fake2', customerName: 'Repeat', customerEmail: 'REPEAT@test.local',
    })
    const secondFull = await payload.findByID({ collection: 'bookings', id: second.id, depth: 0 })
    expect(secondFull.person).toBe(firstFull.person)
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
    const inst = await makeInstance(payload, 5)
    const d = deps()
    const booking = await createPaidBooking({ payload, ...d }, {
      classInstanceId: inst.id, sourceId: 'cnon:member', customerName: 'Existing Member', customerEmail: 'member@test.local',
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

  it('charges subtotal − coupon + tax, and records taxCents (8.9%)', async () => {
    const payload = await getTestPayload()
    await payload.updateGlobal({ slug: 'site-settings', data: { salesTaxPercent: 8.9 }, overrideAccess: true })
    try {
      // $50.00 instance, no coupon → tax $4.45, charge $54.45
      const inst = await makeInstance(payload, 5, 'published', 5000)
      const charge = vi.fn(async () => ({ paymentId: 'sq-tax-1', status: 'COMPLETED' }))
      const sendEmail = vi.fn(async () => {})
      const booking = await createPaidBooking(
        { payload, charge, sendEmail, createOrder: vi.fn(async () => null) },
        { classInstanceId: inst.id, sourceId: 'tok', customerName: 'Tax Test', customerEmail: 'tax-test@example.com' },
      )
      expect(charge).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 5445 }))
      expect(booking.amountCents).toBe(5445)
      expect(booking.taxCents).toBe(445)
      const pay = await payload.find({ collection: 'payments', where: { booking: { equals: booking.id } }, overrideAccess: true, limit: 1 })
      expect(pay.docs[0]?.taxCents).toBe(445)
      expect(pay.docs[0]?.amountCents).toBe(5445)
      // Confirmation email must call out the tax and the final charged total.
      const emailArg: any = (sendEmail as any).mock.calls[0][0]
      expect(emailArg.html).toContain('sales tax')
      expect(emailArg.html).toContain('$54.45')
    } finally {
      await payload.updateGlobal({ slug: 'site-settings', data: { salesTaxPercent: 0 }, overrideAccess: true })
    }
  })

  it('succeeds when expectedTotalCents matches the server-computed total (8.9%)', async () => {
    const payload = await getTestPayload()
    await payload.updateGlobal({ slug: 'site-settings', data: { salesTaxPercent: 8.9 }, overrideAccess: true })
    try {
      // $50.00 instance → total $54.45; the client displayed and posts the same total.
      const inst = await makeInstance(payload, 5, 'published', 5000)
      const charge = vi.fn(async () => ({ paymentId: 'sq-tax-expected', status: 'COMPLETED' }))
      const booking = await createPaidBooking(
        { payload, charge, sendEmail: vi.fn(async () => {}), createOrder: vi.fn(async () => null) },
        {
          classInstanceId: inst.id, sourceId: 'tok', customerName: 'Expected Total', customerEmail: 'tax-expected@example.com',
          expectedTotalCents: 5445,
        },
      )
      expect(charge).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 5445 }))
      expect(booking.amountCents).toBe(5445)
    } finally {
      await payload.updateGlobal({ slug: 'site-settings', data: { salesTaxPercent: 0 }, overrideAccess: true })
    }
  })

  it('refuses a stale expectedTotalCents and never charges the card (8.9%)', async () => {
    const payload = await getTestPayload()
    await payload.updateGlobal({ slug: 'site-settings', data: { salesTaxPercent: 8.9 }, overrideAccess: true })
    try {
      // $50.00 instance → server total is $54.45, but the stale tab still shows
      // the pre-tax $50.00 total — the charge must be refused, not silently taken.
      const inst = await makeInstance(payload, 5, 'published', 5000)
      const charge = vi.fn(async () => ({ paymentId: 'sq-tax-stale', status: 'COMPLETED' }))
      await expect(createPaidBooking(
        { payload, charge, sendEmail: vi.fn(async () => {}), createOrder: vi.fn(async () => null) },
        {
          classInstanceId: inst.id, sourceId: 'tok', customerName: 'Stale Total', customerEmail: 'tax-stale@example.com',
          expectedTotalCents: 5000,
        },
      )).rejects.toThrow(/please refresh/i)
      expect(charge).not.toHaveBeenCalled()
    } finally {
      await payload.updateGlobal({ slug: 'site-settings', data: { salesTaxPercent: 0 }, overrideAccess: true })
    }
  })

  it('taxes the post-coupon amount: $50 instance − $10 fixed coupon + tax (8.9%)', async () => {
    const payload = await getTestPayload()
    await payload.updateGlobal({ slug: 'site-settings', data: { salesTaxPercent: 8.9 }, overrideAccess: true })
    try {
      // $50.00 instance, $10.00-off coupon → taxable $40.00, tax $3.56, charge $43.56
      const inst = await makeInstance(payload, 5, 'published', 5000)
      const coupon = await mkFixedCoupon(payload, 1000)
      const charge = vi.fn(async () => ({ paymentId: 'sq-tax-2', status: 'COMPLETED' }))
      const booking = await createPaidBooking(
        { payload, charge, sendEmail: vi.fn(async () => {}), createOrder: vi.fn(async () => null) },
        {
          classInstanceId: inst.id, sourceId: 'tok', couponCode: coupon.code,
          customerName: 'Tax Coupon Test', customerEmail: 'tax-coupon-test@example.com',
        },
      )
      expect(charge).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 4356 }))
      expect(booking.discountCents).toBe(1000)
      expect(booking.taxCents).toBe(356)
      const pay = await payload.find({ collection: 'payments', where: { booking: { equals: booking.id } }, overrideAccess: true, limit: 1 })
      expect(pay.docs[0]?.taxCents).toBe(356)
      expect(pay.docs[0]?.amountCents).toBe(4356)
    } finally {
      await payload.updateGlobal({ slug: 'site-settings', data: { salesTaxPercent: 0 }, overrideAccess: true })
    }
  })

  it('itemizes the charge with a Square order and passes the orderId to charge', async () => {
    const payload = await getTestPayload()
    const inst = await makeInstance(payload, 5)
    const d = deps()
    await createPaidBooking({ payload, ...d }, {
      classInstanceId: inst.id, sourceId: 'cnon:fake', customerName: 'Jo', customerEmail: 'jo@test.local',
    })
    expect(d.createOrder).toHaveBeenCalledWith(expect.objectContaining({
      itemName: expect.stringMatching(/^Class: /), subtotalCents: 22000, discountCents: 0,
      taxRatePercent: 0, expectedTotalCents: 22000, referenceId: expect.stringMatching(/^booking-\d+$/),
    }))
    expect(d.charge).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'order_test_1' }))
  })

  it('still charges (unitemized) when order creation returns null', async () => {
    const payload = await getTestPayload()
    const inst = await makeInstance(payload, 5)
    const d = deps({ createOrder: vi.fn(async () => null) })
    const booking = await createPaidBooking({ payload, ...d }, {
      classInstanceId: inst.id, sourceId: 'cnon:fake', customerName: 'Jo', customerEmail: 'jo2@test.local',
    })
    expect(booking.status).toBe('paid')
    const chargeArg: any = (d.charge as any).mock.calls[0][0]
    expect(chargeArg.orderId).toBeUndefined()
  })
})

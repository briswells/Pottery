import { describe, it, expect, vi, afterAll } from 'vitest'
import { getTestPayload } from './helpers'
import { createPaidBooking } from '../../src/services/booking'

function deps(overrides = {}) {
  return {
    charge: vi.fn(async () => ({ paymentId: 'pay_cp', status: 'COMPLETED' })),
    sendEmail: vi.fn(async () => {}),
    ...overrides,
  }
}
async function makeInstance(payload: any, priceCents = 22000) {
  const cls = await payload.create({ collection: 'classes', data: { title: `CpSvc ${Date.now()}-${Math.random()}`, defaultPriceCents: priceCents, defaultCapacity: 5 } })
  const user = await payload.create({ collection: 'users', data: { name: 'I', email: `cpsvc-${Date.now()}-${Math.random()}@test.local`, password: 'test12345', roles: ['instructor'] } })
  const inst = await payload.create({ collection: 'class-instances', data: {
    class: cls.id, instructor: user.id, startDate: '2026-08-01', daysOfWeek: ['TU'], startTime: '18:00', endTime: '20:00', status: 'published', capacity: 5,
  } })
  return { cls, inst }
}
async function mkCoupon(p: any, over: Record<string, unknown> = {}) {
  return p.create({ collection: 'coupons', overrideAccess: true, data: {
    code: `CPBOOK${Date.now()}${Math.floor(Math.random() * 1e4)}`, discountType: 'percent', percentOff: 30, ...over,
  } })
}

describe('createPaidBooking with coupons', () => {
  it('charges the discounted amount and records coupon + discount', async () => {
    const p = await getTestPayload()
    const { inst } = await makeInstance(p)
    const c = await mkCoupon(p)
    const d = deps()
    const booking = await createPaidBooking({ payload: p, ...d }, {
      classInstanceId: inst.id, sourceId: 'cnon:x', couponCode: c.code.toLowerCase(),
      customerName: 'A', customerEmail: 'a@cptest.local',
    })
    expect(d.charge).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 15400 }))
    expect(booking.amountCents).toBe(15400)
    expect(booking.discountCents).toBe(6600)
  })

  it('books free with a 100% code: no charge call, $0 payment, paid booking', async () => {
    const p = await getTestPayload()
    const { inst } = await makeInstance(p)
    const c = await mkCoupon(p, { percentOff: 100 })
    const d = deps()
    const booking = await createPaidBooking({ payload: p, ...d }, {
      classInstanceId: inst.id, couponCode: c.code, customerName: 'B', customerEmail: 'b@cptest.local',
    })
    expect(d.charge).not.toHaveBeenCalled()
    expect(booking.status).toBe('paid')
    expect(booking.amountCents).toBe(0)
    const pays = await p.find({ collection: 'payments', where: { booking: { equals: booking.id } }, overrideAccess: true })
    expect(pays.docs[0].amountCents).toBe(0)
  })

  it('requires payment info when the total is not zero', async () => {
    const p = await getTestPayload()
    const { inst } = await makeInstance(p)
    const d = deps()
    await expect(createPaidBooking({ payload: p, ...d }, {
      classInstanceId: inst.id, customerName: 'C', customerEmail: 'c@cptest.local',
    })).rejects.toThrow(/payment information is required/i)
  })

  it('rejects at charge time with the validation reason', async () => {
    const p = await getTestPayload()
    const { inst } = await makeInstance(p)
    const c = await mkCoupon(p, { active: false })
    const d = deps()
    await expect(createPaidBooking({ payload: p, ...d }, {
      classInstanceId: inst.id, sourceId: 'cnon:x', couponCode: c.code, customerName: 'D', customerEmail: 'd@cptest.local',
    })).rejects.toThrow('That code is no longer active.')
    expect(d.charge).not.toHaveBeenCalled()
  })

  it('a pending booking consumes a maxRedemptions slot', async () => {
    const p = await getTestPayload()
    const { cls, inst } = await makeInstance(p)
    const c = await mkCoupon(p, { maxRedemptions: 1 })
    // Simulate an in-flight checkout holding the only slot.
    await p.create({ collection: 'bookings', overrideAccess: true, data: {
      classInstance: inst.id, customerName: 'Held', customerEmail: 'held@cptest.local',
      status: 'pending', amountCents: 15400, coupon: c.id, discountCents: 6600,
    } })
    const d = deps()
    await expect(createPaidBooking({ payload: p, ...d }, {
      classInstanceId: inst.id, sourceId: 'cnon:x', couponCode: c.code, customerName: 'E', customerEmail: 'e@cptest.local',
    })).rejects.toThrow('That code has been fully redeemed.')
    void cls
  })

  it('enforces onePerCustomer by email, case-insensitively', async () => {
    const p = await getTestPayload()
    const { inst } = await makeInstance(p)
    const c = await mkCoupon(p, { onePerCustomer: true })
    const d = deps()
    await createPaidBooking({ payload: p, ...d }, {
      classInstanceId: inst.id, sourceId: 'cnon:x', couponCode: c.code, customerName: 'F', customerEmail: 'f@cptest.local',
    })
    await expect(createPaidBooking({ payload: p, ...deps() }, {
      classInstanceId: inst.id, sourceId: 'cnon:x', couponCode: c.code, customerName: 'F2', customerEmail: 'F@CPTEST.LOCAL',
    })).rejects.toThrow('That code has already been used with this email.')
  })

  it('books a natively free class (no coupon) and still sends the confirmation email', async () => {
    const p = await getTestPayload()
    const { inst } = await makeInstance(p, 0)
    const d = deps()
    const booking = await createPaidBooking({ payload: p, ...d }, {
      classInstanceId: inst.id, customerName: 'G', customerEmail: 'g@cptest.local',
    })
    expect(d.charge).not.toHaveBeenCalled()
    expect(booking.status).toBe('paid')
    expect(d.sendEmail).toHaveBeenCalledTimes(1)
    const html: string = (d.sendEmail as any).mock.calls[0][0].html
    expect(html).toContain('Amount paid: $0.00.')
  })

  it('confirmation email shows the coupon amount line variants', async () => {
    const p = await getTestPayload()
    const { inst } = await makeInstance(p)
    const c = await mkCoupon(p) // 30% default
    const d = deps()
    await createPaidBooking({ payload: p, ...d }, {
      classInstanceId: inst.id, sourceId: 'cnon:x', couponCode: c.code, customerName: 'H', customerEmail: 'h@cptest.local',
    })
    const html: string = (d.sendEmail as any).mock.calls[0][0].html
    expect(html).toContain(`Amount paid: $154.00 (${c.code} applied).`)

    const { inst: inst2 } = await makeInstance(p)
    const free = await mkCoupon(p, { percentOff: 100 })
    const d2 = deps()
    await createPaidBooking({ payload: p, ...d2 }, {
      classInstanceId: inst2.id, couponCode: free.code, customerName: 'I', customerEmail: 'i@cptest.local',
    })
    const html2: string = (d2.sendEmail as any).mock.calls[0][0].html
    expect(html2).toContain(`Free with code ${free.code}.`)
  })
})

afterAll(async () => {
  const p = await getTestPayload()
  await p.delete({ collection: 'payments', where: {}, overrideAccess: true })
  await p.delete({ collection: 'bookings', where: { customerEmail: { contains: '@cptest.local' } }, overrideAccess: true })
  await p.delete({ collection: 'coupons', where: { code: { contains: 'CPBOOK' } }, overrideAccess: true })
  await p.delete({ collection: 'class-instances', where: {}, overrideAccess: true })
  await p.delete({ collection: 'classes', where: { title: { contains: 'CpSvc' } }, overrideAccess: true })
  await p.delete({ collection: 'people', where: { email: { contains: '@cptest.local' } }, overrideAccess: true })
})

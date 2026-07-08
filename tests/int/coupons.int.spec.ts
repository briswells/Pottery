import { describe, it, expect, afterAll } from 'vitest'
import { getTestPayload } from './helpers'

export const CP = () => `CPTEST${Date.now()}${Math.floor(Math.random() * 1e4)}`

describe('coupons collection', () => {
  it('stores the code uppercased', async () => {
    const p = await getTestPayload()
    const code = CP()
    const c = await p.create({ collection: 'coupons', overrideAccess: true, data: {
      code: `  ${code.toLowerCase()} `, discountType: 'percent', percentOff: 25,
    } })
    expect(c.code).toBe(code)
    expect(c.active).toBe(true)
    expect(c.appliesTo).toBe('all')
  })

  it('rejects a duplicate code with a friendly message', async () => {
    const p = await getTestPayload()
    const code = CP()
    await p.create({ collection: 'coupons', overrideAccess: true, data: { code, discountType: 'percent', percentOff: 10 } })
    const err: any = await p
      .create({ collection: 'coupons', overrideAccess: true, data: { code: code.toLowerCase(), discountType: 'percent', percentOff: 10 } })
      .catch((e: unknown) => e)
    const text = `${(err?.data?.errors ?? []).map((x: any) => x?.message).join(' ')} ${err?.message ?? ''}`
    expect(text).toMatch(/a coupon with that code already exists/i)
  })

  it('validates percent range and fixed amount per discountType', async () => {
    const p = await getTestPayload()
    await expect(p.create({ collection: 'coupons', overrideAccess: true, data: { code: CP(), discountType: 'percent', percentOff: 150 } })).rejects.toThrow()
    await expect(p.create({ collection: 'coupons', overrideAccess: true, data: { code: CP(), discountType: 'fixed' } })).rejects.toThrow()
    const fixed = await p.create({ collection: 'coupons', overrideAccess: true, data: { code: CP(), discountType: 'fixed', amountOffCents: 5000 } })
    expect(fixed.amountOffCents).toBe(5000)
  })

  it('normalizes an explicit null appliesTo to all', async () => {
    const p = await getTestPayload()
    const c = await p.create({ collection: 'coupons', overrideAccess: true, data: {
      code: CP(), discountType: 'percent', percentOff: 10, appliesTo: null as never,
    } })
    expect(c.appliesTo).toBe('all')
  })
})

describe('booking coupon fields', () => {
  it('stores coupon + discountCents on a booking and allows a payments row without squareId', async () => {
    const p = await getTestPayload()
    const c = await p.create({ collection: 'coupons', overrideAccess: true, data: { code: CP(), discountType: 'percent', percentOff: 50 } })
    const cls = await p.create({ collection: 'classes', overrideAccess: true, data: { title: `CpBk ${Date.now()}`, defaultPriceCents: 10000, defaultCapacity: 5 } })
    const user = await p.create({ collection: 'users', overrideAccess: true, data: { name: 'I', email: `cpbk-${Date.now()}@test.local`, password: 'test12345', roles: ['instructor'] } })
    const inst = await p.create({ collection: 'class-instances', overrideAccess: true, data: {
      class: cls.id, instructor: user.id, startDate: '2026-08-01', daysOfWeek: ['TU'], startTime: '18:00', endTime: '20:00', status: 'published', capacity: 5,
    } })
    const b = await p.create({ collection: 'bookings', overrideAccess: true, data: {
      classInstance: inst.id, customerName: 'D', customerEmail: 'd@test.local', status: 'pending',
      amountCents: 5000, coupon: c.id, discountCents: 5000,
    } })
    expect(b.discountCents).toBe(5000)
    const pay = await p.create({ collection: 'payments', overrideAccess: true, data: {
      type: 'booking', booking: b.id, amountCents: 0, status: 'COMPLETED', paidAt: new Date().toISOString(),
    } })
    expect(pay.squareId ?? null).toBeNull()
  })
})

afterAll(async () => {
  const p = await getTestPayload()
  await p.delete({ collection: 'coupons', where: { code: { contains: 'CPTEST' } }, overrideAccess: true })
  // Pre-existing gap: the booking-coupon-fields test above creates a class +
  // class-instance (+ booking/payments/instructor) that this afterAll never
  // cleaned up. An orphaned class-instance left a NOT-NULL FK violation for
  // any later suite that bulk-deletes `classes` (e.g. classes.int.spec.ts's
  // beforeEach), causing order-dependent full-suite flakes unrelated to those
  // suites. Clean up in FK-safe order: payments -> bookings -> class-instances
  // -> classes -> the instructor user.
  await p.delete({ collection: 'payments', where: { type: { equals: 'booking' } }, overrideAccess: true })
  await p.delete({ collection: 'bookings', where: { customerEmail: { equals: 'd@test.local' } }, overrideAccess: true })
  const { docs: cpBkClasses } = await p.find({ collection: 'classes', where: { title: { contains: 'CpBk' } }, limit: 1000, depth: 0, overrideAccess: true })
  const classIds = cpBkClasses.map((c) => c.id)
  if (classIds.length > 0) {
    await p.delete({ collection: 'class-instances', where: { class: { in: classIds } }, overrideAccess: true })
    await p.delete({ collection: 'classes', where: { id: { in: classIds } }, overrideAccess: true })
  }
  await p.delete({ collection: 'users', where: { email: { contains: 'cpbk-' } }, overrideAccess: true })
})

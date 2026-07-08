// The default jsdom test environment gives Node `Buffer`s a cross-realm
// `Uint8Array` that fails `instanceof` checks inside `file-type` (used by
// Payload's upload validation), so a real file upload always fails there.
// Force node for this file, which actually creates media with file data.
// @vitest-environment node
import { describe, it, expect, vi, afterAll } from 'vitest'
import { getTestPayload } from './helpers'
import { createPaidFiring } from '../../src/services/firing'
import { createPaidBooking } from '../../src/services/booking'

async function mkPhoto(p: any) {
  // 1x1 png buffer — media create needs a real file
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
  return p.create({ collection: 'media', overrideAccess: true, data: { alt: 'fp test' }, file: { data: png, mimetype: 'image/png', name: `fp-${Date.now()}-${Math.random()}.png`, size: png.length } })
}

function deps(overrides = {}) {
  return {
    charge: vi.fn(async () => ({ paymentId: 'pay_fp', status: 'COMPLETED' })),
    sendEmail: vi.fn(async () => {}),
    ...overrides,
  }
}

async function mkCoupon(p: any, over: Record<string, unknown> = {}) {
  return p.create({ collection: 'coupons', overrideAccess: true, data: {
    code: `CPFPD${Date.now()}${Math.floor(Math.random() * 1e4)}`, discountType: 'percent', percentOff: 30, ...over,
  } })
}

async function makeInstance(payload: any, priceCents = 22000) {
  const cls = await payload.create({ collection: 'classes', data: { title: `FpSvc ${Date.now()}-${Math.random()}`, defaultPriceCents: priceCents, defaultCapacity: 5 } })
  const user = await payload.create({ collection: 'users', data: { name: 'I', email: `fpsvc-${Date.now()}-${Math.random()}@test.local`, password: 'test12345', roles: ['instructor'] } })
  const inst = await payload.create({ collection: 'class-instances', data: {
    class: cls.id, instructor: user.id, startDate: '2026-08-01', daysOfWeek: ['TU'], startTime: '18:00', endTime: '20:00', status: 'published', capacity: 5,
  } })
  return { cls, inst }
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    halfShelves: 2,
    photoIds: [] as number[],
    customerName: 'Fp Customer',
    customerEmail: 'fp1@fptest.local',
    description: 'a few mugs',
    stonewareConfirmed: true,
    ...overrides,
  }
}

describe('createPaidFiring', () => {
  it('paid, no coupon: charges the half-shelf total and records a firing payment', async () => {
    const p = await getTestPayload()
    const photo = await mkPhoto(p)
    const d = deps()
    const fr = await createPaidFiring({ payload: p, ...d }, baseInput({
      photoIds: [photo.id], sourceId: 'cnon:x', customerEmail: 'fp1@fptest.local',
    }))
    expect(d.charge).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 5000 }))
    expect(fr.status).toBe('paid')
    expect(fr.amountCents).toBe(5000)

    const pays = await p.find({ collection: 'payments', where: { firingRequest: { equals: fr.id } }, overrideAccess: true })
    expect(pays.docs[0].type).toBe('firing')
    expect(pays.docs[0].squareId).toBe('pay_fp')

    const html: string = (d.sendEmail as any).mock.calls[0][0].html
    expect(html).toContain('$50.00')
    expect(html).toContain('half shelf')
  })

  it('30% coupon: discounts the charge and mentions the code in the email', async () => {
    const p = await getTestPayload()
    const photo = await mkPhoto(p)
    const c = await mkCoupon(p)
    const d = deps()
    const fr = await createPaidFiring({ payload: p, ...d }, baseInput({
      photoIds: [photo.id], sourceId: 'cnon:x', couponCode: c.code, customerEmail: 'fp2@fptest.local',
    }))
    expect(d.charge).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 3500 }))
    expect(fr.discountCents).toBe(1500)
    const html: string = (d.sendEmail as any).mock.calls[0][0].html
    expect(html).toContain(`(${c.code} applied)`)
  })

  it('100% coupon: skips the charge and records a free payment', async () => {
    const p = await getTestPayload()
    const photo = await mkPhoto(p)
    const c = await mkCoupon(p, { percentOff: 100 })
    const d = deps()
    const fr = await createPaidFiring({ payload: p, ...d }, baseInput({
      photoIds: [photo.id], couponCode: c.code, customerEmail: 'fp3@fptest.local',
    }))
    expect(d.charge).not.toHaveBeenCalled()
    expect(fr.amountCents).toBe(0)
    expect(fr.status).toBe('paid')
    const pays = await p.find({ collection: 'payments', where: { firingRequest: { equals: fr.id } }, overrideAccess: true })
    expect(pays.docs[0].squareId).toBeFalsy()
    const html: string = (d.sendEmail as any).mock.calls[0][0].html
    expect(html).toContain('Free with code')
  })

  it('requires payment info when no coupon zeroes the total', async () => {
    const p = await getTestPayload()
    const photo = await mkPhoto(p)
    const d = deps()
    await expect(createPaidFiring({ payload: p, ...d }, baseInput({
      photoIds: [photo.id], customerEmail: 'fp4@fptest.local',
    }))).rejects.toThrow('Payment information is required')
  })

  it('rejects a class-scoped coupon with the firing-specific reason', async () => {
    const p = await getTestPayload()
    const photo = await mkPhoto(p)
    const { cls } = await makeInstance(p)
    const c = await mkCoupon(p, { appliesTo: 'class', class: cls.id })
    const d = deps()
    await expect(createPaidFiring({ payload: p, ...d }, baseInput({
      photoIds: [photo.id], sourceId: 'cnon:x', couponCode: c.code, customerEmail: 'fp5@fptest.local',
    }))).rejects.toThrow("That code isn't valid for firings.")
    expect(d.charge).not.toHaveBeenCalled()
  })

  it('a declined charge cancels the request and rethrows', async () => {
    const p = await getTestPayload()
    const photo = await mkPhoto(p)
    const d = deps({ charge: vi.fn(async () => { throw new Error('card declined') }) })
    await expect(createPaidFiring({ payload: p, ...d }, baseInput({
      photoIds: [photo.id], sourceId: 'cnon:x', customerEmail: 'fp6@fptest.local',
    }))).rejects.toThrow('card declined')
    const { docs } = await p.find({ collection: 'firing-requests', where: { email: { equals: 'fp6@fptest.local' } }, overrideAccess: true })
    expect(docs[0].status).toBe('cancelled')
  })

  it('cross-collection redemption: a pending booking blocks a firing, and a paid firing blocks a booking', async () => {
    const p = await getTestPayload()
    const { inst } = await makeInstance(p)
    const c = await mkCoupon(p, { maxRedemptions: 1 })

    // A pending booking holds the only slot.
    await p.create({ collection: 'bookings', overrideAccess: true, data: {
      classInstance: inst.id, customerName: 'Held', customerEmail: 'held@fptest.local',
      status: 'pending', amountCents: 15400, coupon: c.id, discountCents: 6600,
    } })
    const photo = await mkPhoto(p)
    const d = deps()
    await expect(createPaidFiring({ payload: p, ...d }, baseInput({
      photoIds: [photo.id], sourceId: 'cnon:x', couponCode: c.code, customerEmail: 'fp7@fptest.local',
    }))).rejects.toThrow('That code has been fully redeemed.')

    // Release that slot, then let a paid firing consume it instead.
    await p.delete({ collection: 'bookings', where: { customerEmail: { equals: 'held@fptest.local' } }, overrideAccess: true })
    const photo2 = await mkPhoto(p)
    const d2 = deps()
    await createPaidFiring({ payload: p, ...d2 }, baseInput({
      photoIds: [photo2.id], sourceId: 'cnon:x', couponCode: c.code, customerEmail: 'fp7b@fptest.local',
    }))

    await expect(createPaidBooking({ payload: p, ...deps() }, {
      classInstanceId: inst.id, sourceId: 'cnon:x', couponCode: c.code, customerName: 'Blocked', customerEmail: 'blocked@fptest.local',
    })).rejects.toThrow('That code has been fully redeemed.')
  })

  it('onePerCustomer: a paid firing blocks a booking with the same email, case-insensitively', async () => {
    const p = await getTestPayload()
    const { inst } = await makeInstance(p)
    const c = await mkCoupon(p, { onePerCustomer: true })
    const photo = await mkPhoto(p)
    const d = deps()
    await createPaidFiring({ payload: p, ...d }, baseInput({
      photoIds: [photo.id], sourceId: 'cnon:x', couponCode: c.code, customerEmail: 'a@fptest.local',
    }))
    await expect(createPaidBooking({ payload: p, ...deps() }, {
      classInstanceId: inst.id, sourceId: 'cnon:x', couponCode: c.code, customerName: 'Dup', customerEmail: 'A@FPTEST.LOCAL',
    })).rejects.toThrow('That code has already been used with this email.')
  })
})

afterAll(async () => {
  const p = await getTestPayload()
  await p.delete({ collection: 'payments', where: {}, overrideAccess: true })
  await p.delete({ collection: 'firing-requests', where: { email: { contains: '@fptest.local' } }, overrideAccess: true })
  await p.delete({ collection: 'bookings', where: { customerEmail: { contains: '@fptest.local' } }, overrideAccess: true })
  await p.delete({ collection: 'coupons', where: { code: { contains: 'CPFPD' } }, overrideAccess: true })
  await p.delete({ collection: 'class-instances', where: {}, overrideAccess: true })
  await p.delete({ collection: 'classes', where: { title: { contains: 'FpSvc' } }, overrideAccess: true })
  await p.delete({ collection: 'media', where: { alt: { equals: 'fp test' } }, overrideAccess: true })
  await p.delete({ collection: 'people', where: { email: { contains: '@fptest.local' } }, overrideAccess: true })
})

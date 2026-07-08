import { describe, it, expect, afterAll } from 'vitest'
import { getTestPayload } from './helpers'
import { validateCoupon } from '../../src/services/coupons'

const CP = () => `CPFIRE${Date.now()}${Math.floor(Math.random() * 1e4)}`
async function mkCoupon(p: any, over: Record<string, unknown> = {}) {
  return p.create({ collection: 'coupons', overrideAccess: true, data: { code: CP(), discountType: 'percent', percentOff: 20, ...over } })
}
async function mkClass(p: any) {
  return p.create({ collection: 'classes', overrideAccess: true, data: { title: `CpFireCls ${Date.now()}-${Math.random()}`, defaultPriceCents: 5000, defaultCapacity: 5 } })
}

describe('coupon firing scope', () => {
  it('all-scope works for both targets', async () => {
    const p = await getTestPayload()
    const cls = await mkClass(p)
    const c = await mkCoupon(p) // appliesTo defaults to all
    expect(await validateCoupon({ payload: p }, { code: c.code, priceCents: 5000, target: { kind: 'class', classId: cls.id } })).toMatchObject({ ok: true })
    expect(await validateCoupon({ payload: p }, { code: c.code, priceCents: 5000, target: { kind: 'firing' } })).toMatchObject({ ok: true, discountCents: 1000 })
  })

  it('class-scope rejects firing targets with the exact reason', async () => {
    const p = await getTestPayload()
    const cls = await mkClass(p)
    const c = await mkCoupon(p, { appliesTo: 'class', class: cls.id })
    expect(await validateCoupon({ payload: p }, { code: c.code, priceCents: 5000, target: { kind: 'firing' } }))
      .toMatchObject({ ok: false, reason: "That code isn't valid for firings." })
  })

  it('firing-scope rejects class targets and accepts firing targets', async () => {
    const p = await getTestPayload()
    const cls = await mkClass(p)
    const c = await mkCoupon(p, { appliesTo: 'firing' })
    expect(await validateCoupon({ payload: p }, { code: c.code, priceCents: 5000, target: { kind: 'class', classId: cls.id } }))
      .toMatchObject({ ok: false, reason: "That code isn't valid for this class." })
    expect(await validateCoupon({ payload: p }, { code: c.code, priceCents: 5000, target: { kind: 'firing' } })).toMatchObject({ ok: true })
  })
})

afterAll(async () => {
  const p = await getTestPayload()
  await p.delete({ collection: 'coupons', where: { code: { contains: 'CPFIRE' } }, overrideAccess: true })
  await p.delete({ collection: 'classes', where: { title: { contains: 'CpFireCls' } }, overrideAccess: true })
})

import { describe, it, expect, afterAll } from 'vitest'
import { getTestPayload } from './helpers'
import { computeDiscount, validateCoupon } from '../../src/services/coupons'

const CP = () => `CPVAL${Date.now()}${Math.floor(Math.random() * 1e4)}`

async function mkCoupon(p: any, over: Record<string, unknown> = {}) {
  return p.create({ collection: 'coupons', overrideAccess: true, data: {
    code: CP(), discountType: 'percent', percentOff: 30, ...over,
  } })
}
async function mkClass(p: any) {
  return p.create({ collection: 'classes', overrideAccess: true, data: {
    title: `CpCls ${Date.now()}-${Math.random()}`, defaultPriceCents: 22000, defaultCapacity: 8,
  } })
}

describe('computeDiscount', () => {
  it('percent rounds to whole cents', () => {
    expect(computeDiscount({ discountType: 'percent', percentOff: 30 } as any, 22000)).toEqual({ discountCents: 6600, finalCents: 15400 })
    expect(computeDiscount({ discountType: 'percent', percentOff: 33 } as any, 9999)).toEqual({ discountCents: 3300, finalCents: 6699 })
  })
  it('fixed clamps at the price', () => {
    expect(computeDiscount({ discountType: 'fixed', amountOffCents: 5000 } as any, 22000)).toEqual({ discountCents: 5000, finalCents: 17000 })
    expect(computeDiscount({ discountType: 'fixed', amountOffCents: 99999 } as any, 22000)).toEqual({ discountCents: 22000, finalCents: 0 })
  })
  it('100 percent is free', () => {
    expect(computeDiscount({ discountType: 'percent', percentOff: 100 } as any, 22000)).toEqual({ discountCents: 22000, finalCents: 0 })
  })
})

describe('validateCoupon', () => {
  it('accepts a valid all-classes code, case-insensitively', async () => {
    const p = await getTestPayload()
    const cls = await mkClass(p)
    const c = await mkCoupon(p)
    const res = await validateCoupon({ payload: p }, { code: ` ${c.code.toLowerCase()} `, priceCents: 22000, target: { kind: 'class', classId: cls.id } })
    expect(res).toMatchObject({ ok: true, discountCents: 6600, finalCents: 15400 })
  })

  it('rejects unknown, inactive, and expired codes with specific reasons', async () => {
    const p = await getTestPayload()
    const cls = await mkClass(p)
    expect(await validateCoupon({ payload: p }, { code: 'CPVALNOPE', priceCents: 100, target: { kind: 'class', classId: cls.id } })).toMatchObject({ ok: false, reason: "That code isn't valid." })
    const off = await mkCoupon(p, { active: false })
    expect(await validateCoupon({ payload: p }, { code: off.code, priceCents: 100, target: { kind: 'class', classId: cls.id } })).toMatchObject({ ok: false, reason: 'That code is no longer active.' })
    const old = await mkCoupon(p, { expiresAt: new Date(Date.now() - 86_400_000).toISOString() })
    expect(await validateCoupon({ payload: p }, { code: old.code, priceCents: 100, target: { kind: 'class', classId: cls.id } })).toMatchObject({ ok: false, reason: 'That code has expired.' })
  })

  it('enforces class scope', async () => {
    const p = await getTestPayload()
    const target = await mkClass(p)
    const other = await mkClass(p)
    const scoped = await mkCoupon(p, { appliesTo: 'class', class: target.id })
    expect(await validateCoupon({ payload: p }, { code: scoped.code, priceCents: 100, target: { kind: 'class', classId: target.id } })).toMatchObject({ ok: true })
    expect(await validateCoupon({ payload: p }, { code: scoped.code, priceCents: 100, target: { kind: 'class', classId: other.id } })).toMatchObject({ ok: false, reason: "That code isn't valid for this class." })
  })
})

afterAll(async () => {
  const p = await getTestPayload()
  await p.delete({ collection: 'coupons', where: { code: { contains: 'CPVAL' } }, overrideAccess: true })
  await p.delete({ collection: 'classes', where: { title: { contains: 'CpCls' } }, overrideAccess: true })
})

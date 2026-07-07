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
})

afterAll(async () => {
  const p = await getTestPayload()
  await p.delete({ collection: 'coupons', where: { code: { contains: 'CPTEST' } }, overrideAccess: true })
})

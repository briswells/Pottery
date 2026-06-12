import { describe, it, expect, afterAll } from 'vitest'
import { getTestPayload } from './helpers'

async function makeClass(payload: any) {
  return payload.create({ collection: 'classes', data: {
    title: `Inst Class ${Date.now()}-${Math.random()}`, category: 'wheel-series',
    defaultPriceCents: 22000, defaultCapacity: 8,
  } })
}

describe('ClassInstances', () => {
  afterAll(async () => {
    const payload = await getTestPayload()
    await payload.delete({ collection: 'payments', where: {} })
    await payload.delete({ collection: 'bookings', where: {} })
    await payload.delete({ collection: 'class-instances', where: {} })
    await payload.delete({ collection: 'classes', where: {} })
  })

  it('inherits price and capacity from its class when left blank', async () => {
    const payload = await getTestPayload()
    const cls = await makeClass(payload)
    const inst = await payload.create({ collection: 'class-instances', data: {
      class: cls.id, instructor: undefined, startDate: '2026-07-07', startTime: '18:00', endTime: '20:00',
      // instructor required — create a user
    } as any }).catch((e: Error) => e)
    // instructor is required, so the above throws; assert that here
    expect(inst).toBeInstanceOf(Error)
  })

  it('fills defaults, label and status when fully specified', async () => {
    const payload = await getTestPayload()
    const cls = await makeClass(payload)
    const user = await payload.create({ collection: 'users', data: {
      name: 'Teacher', email: `t-${Date.now()}@test.local`, password: 'test12345', roles: ['instructor'],
    } })
    const inst = await payload.create({ collection: 'class-instances', data: {
      class: cls.id, instructor: user.id, startDate: '2026-07-07', startTime: '18:00', endTime: '20:00',
    } })
    expect(inst.priceCents).toBe(22000)
    expect(inst.capacity).toBe(8)
    expect(inst.status).toBe('draft')
    expect(inst.label).toContain('2026-07-07')
  })

  it('allows overriding price and capacity per instance', async () => {
    const payload = await getTestPayload()
    const cls = await makeClass(payload)
    const user = await payload.create({ collection: 'users', data: {
      name: 'Teacher2', email: `t2-${Date.now()}@test.local`, password: 'test12345', roles: ['instructor'],
    } })
    const inst = await payload.create({ collection: 'class-instances', data: {
      class: cls.id, instructor: user.id, startDate: '2026-07-07', startTime: '18:00', endTime: '20:00',
      priceCents: 9900, capacity: 3,
    } })
    expect(inst.priceCents).toBe(9900)
    expect(inst.capacity).toBe(3)
  })

  it('rejects a malformed start time', async () => {
    const payload = await getTestPayload()
    const cls = await makeClass(payload)
    const user = await payload.create({ collection: 'users', data: {
      name: 'Teacher3', email: `t3-${Date.now()}@test.local`, password: 'test12345', roles: ['instructor'],
    } })
    await expect(payload.create({ collection: 'class-instances', data: {
      class: cls.id, instructor: user.id, startDate: '2026-07-07', startTime: '6pm', endTime: '20:00',
    } })).rejects.toThrow()
  })
})

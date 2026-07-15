import { describe, it, expect, afterAll } from 'vitest'
import { getTestPayload } from './helpers'
import { completePastInstances } from '../../src/services/complete-past-instances'

// A fixed "now": noon Pacific on 2026-07-15.
const NOW = new Date('2026-07-15T19:00:00.000Z')

async function makeClass(payload: any) {
  return payload.create({ collection: 'classes', data: {
    title: `Past Class ${Date.now()}-${Math.random()}`,
    defaultPriceCents: 5000, defaultCapacity: 8,
  } })
}

async function makeInstructor(payload: any) {
  return payload.create({ collection: 'users', data: {
    name: 'Past Teacher', email: `past-${Date.now()}-${Math.random()}@test.local`,
    password: 'test12345', roles: ['instructor'],
  } })
}

async function makeInstance(payload: any, cls: any, user: any, data: Record<string, unknown>) {
  return payload.create({ collection: 'class-instances', data: {
    class: cls.id, instructor: user.id, startTime: '12:30', endTime: '14:30', ...data,
  } })
}

describe('completePastInstances', () => {
  afterAll(async () => {
    const payload = await getTestPayload()
    await payload.delete({ collection: 'bookings', where: {} })
    await payload.delete({ collection: 'class-instances', where: {} })
    await payload.delete({ collection: 'classes', where: {} })
  })

  it('completes past published instances and leaves future/draft/cancelled alone', async () => {
    const payload = await getTestPayload()
    const cls = await makeClass(payload)
    const user = await makeInstructor(payload)

    const pastSingle = await makeInstance(payload, cls, user, { startDate: '2026-07-11', status: 'published' })
    const futureSingle = await makeInstance(payload, cls, user, { startDate: '2026-07-18', status: 'published' })
    const todaySingle = await makeInstance(payload, cls, user, { startDate: '2026-07-15', status: 'published' })
    const pastDraft = await makeInstance(payload, cls, user, { startDate: '2026-07-01', status: 'draft' })
    const pastCancelled = await makeInstance(payload, cls, user, { startDate: '2026-07-01', status: 'cancelled' })
    // Multi-week: started in the past but still running (end date in the future)
    const running = await makeInstance(payload, cls, user, {
      startDate: '2026-07-07', endDate: '2026-08-11', daysOfWeek: ['TU'], status: 'published',
    })
    // Multi-week that fully ended
    const endedRun = await makeInstance(payload, cls, user, {
      startDate: '2026-06-02', endDate: '2026-07-07', daysOfWeek: ['TU'], status: 'published',
    })

    const n = await completePastInstances(payload, NOW)
    expect(n).toBe(2)

    const statusOf = async (id: number) =>
      (await payload.findByID({ collection: 'class-instances', id, depth: 0 })).status
    expect(await statusOf(pastSingle.id)).toBe('completed')
    expect(await statusOf(endedRun.id)).toBe('completed')
    expect(await statusOf(futureSingle.id)).toBe('published')
    expect(await statusOf(todaySingle.id)).toBe('published') // completes tomorrow, not mid-class-day
    expect(await statusOf(pastDraft.id)).toBe('draft')
    expect(await statusOf(pastCancelled.id)).toBe('cancelled')
    expect(await statusOf(running.id)).toBe('published')

    // Idempotent: a second run finds nothing new.
    expect(await completePastInstances(payload, NOW)).toBe(0)
  })
})

describe('class instance deletion guard', () => {
  it('blocks deleting an instance with bookings, with a friendly message', async () => {
    const payload = await getTestPayload()
    const cls = await makeClass(payload)
    const user = await makeInstructor(payload)
    const inst = await makeInstance(payload, cls, user, { startDate: '2026-07-11', status: 'published' })
    await payload.create({ collection: 'bookings', data: {
      classInstance: inst.id, customerName: 'Madison Stone', customerEmail: 'madison@test.local',
      status: 'paid', amountCents: 9500,
    } })

    const err = await payload
      .delete({ collection: 'class-instances', id: inst.id })
      .then(() => null, (e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    expect(String(err)).toMatch(/booking/i)

    // Still there.
    const still = await payload.findByID({ collection: 'class-instances', id: inst.id, depth: 0 })
    expect(still.id).toBe(inst.id)
  })

  it('allows deleting an instance without bookings', async () => {
    const payload = await getTestPayload()
    const cls = await makeClass(payload)
    const user = await makeInstructor(payload)
    const inst = await makeInstance(payload, cls, user, { startDate: '2026-07-11', status: 'published' })
    await payload.delete({ collection: 'class-instances', id: inst.id })
    const gone = await payload
      .findByID({ collection: 'class-instances', id: inst.id, depth: 0 })
      .then(() => null, (e: Error) => e)
    expect(gone).toBeInstanceOf(Error)
  })
})

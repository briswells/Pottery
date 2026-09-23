import { describe, it, expect, afterAll } from 'vitest'
import { getTestPayload } from './helpers'

describe('Instructor access scoping', () => {
  afterAll(async () => {
    const payload = await getTestPayload()
    // Bookings first: the delete-guard hook silently skips booked instances
    // (payload.delete collects per-doc errors), and a surviving instance then
    // aborts the classes wipe with an FK violation. File order is timing-cache
    // dependent, so leftovers from booking suites can land here in any run.
    await payload.delete({ collection: 'bookings', where: {} })
    await payload.delete({ collection: 'class-instances', where: {} })
    await payload.delete({ collection: 'classes', where: {} })
  })

  it('an instructor reads every instance (their own and others); public reads only published', async () => {
    const payload = await getTestPayload()
    const cls = await payload.create({ collection: 'classes', data: {
      title: `Acc ${Date.now()}`, defaultPriceCents: 5000, defaultCapacity: 5,
    } })
    const mine = await payload.create({ collection: 'users', data: {
      name: 'Mine', email: `mine-${Date.now()}@test.local`, password: 'test12345', roles: ['instructor'],
    } })
    const other = await payload.create({ collection: 'users', data: {
      name: 'Other', email: `other-${Date.now()}@test.local`, password: 'test12345', roles: ['instructor'],
    } })
    const common = { class: cls.id, startTime: '18:00', endTime: '20:00' }
    const mineDraft = await payload.create({ collection: 'class-instances', data: { ...common, instructor: mine.id, startDate: '2026-07-07', status: 'draft' } })
    const otherPublished = await payload.create({ collection: 'class-instances', data: { ...common, instructor: other.id, startDate: '2026-07-08', status: 'published' } })

    // Instructor "mine" sees every instance, including other instructors' and drafts.
    const asMine = await payload.find({ collection: 'class-instances', overrideAccess: false, user: mine })
    expect(asMine.docs.map((d) => d.id).sort()).toEqual([mineDraft.id, otherPublished.id].sort())

    // findByID (what the roster view relies on) also succeeds for another instructor's instance.
    const fetched = await payload.findByID({ collection: 'class-instances', id: otherPublished.id, overrideAccess: false, user: mine })
    expect(fetched.id).toBe(otherPublished.id)

    // Public (no user) sees only published instances.
    const asPublic = await payload.find({ collection: 'class-instances', overrideAccess: false })
    expect(asPublic.docs.every((d) => d.status === 'published')).toBe(true)
    expect(asPublic.docs.some((d) => d.id === mineDraft.id)).toBe(false)
  })
})

import { describe, it, expect, beforeAll } from 'vitest'
import type { Payload } from 'payload'
import { getTestPayload } from './helpers'
import { previewSeries, createSeries } from '../../src/services/class-series'
import type { RecurrenceRule } from '../../src/lib/recurrence'

let payload: Payload
let classId: number
let instructorId: number

beforeAll(async () => {
  payload = await getTestPayload()
  const unique = `series-${Date.now()}`
  const instructor = await payload.create({
    collection: 'users',
    overrideAccess: true,
    data: { email: `${unique}@test.local`, password: 'test-password-1', roles: ['instructor'], name: 'Series Teacher' },
  })
  instructorId = instructor.id as number
  const cls = await payload.create({
    collection: 'classes',
    overrideAccess: true,
    data: { title: `Wheel Basics ${unique}`, defaultPriceCents: 5500, defaultCapacity: 8, defaultNumberOfClasses: 4 },
  })
  classId = cls.id as number
})

const RULE: RecurrenceRule = { kind: 'ordinalWeekday', weekday: 'TU', ordinals: [1, 3] }

describe('previewSeries', () => {
  it('expands the rule and flags no conflicts on a clean slate', async () => {
    const res = await previewSeries(payload, { classId, rule: RULE, from: '2027-01-01', until: '2027-02-28' })
    expect(res).toMatchObject({ ok: true })
    if (!res.ok) return
    expect(res.dates.map((d) => d.date)).toEqual(['2027-01-05', '2027-01-19', '2027-02-02', '2027-02-16'])
    expect(res.dates.every((d) => !d.conflict)).toBe(true)
  })

  it('404s an unknown class and 400s a bad rule', async () => {
    expect(await previewSeries(payload, { classId: 999999, rule: RULE, from: '2027-01-01', until: '2027-01-31' }))
      .toMatchObject({ ok: false, status: 404 })
    expect(await previewSeries(payload, { classId, rule: { kind: 'dayOfMonth', day: 40 }, from: '2027-01-01', until: '2027-01-31' }))
      .toMatchObject({ ok: false, status: 400 })
  })
})

describe('createSeries', () => {
  it('creates published single-day instances with class defaults and studio-midnight dates', async () => {
    const res = await createSeries(payload, {
      classId, instructorId,
      dates: ['2027-03-02', '2027-03-16'],
      startTime: '18:00', endTime: '20:00',
    })
    expect(res).toMatchObject({ ok: true, created: 2, skipped: [] })

    const { docs } = await payload.find({
      collection: 'class-instances',
      where: { and: [{ class: { equals: classId } }, { startDate: { greater_than: '2027-03-01' } }, { startDate: { less_than: '2027-03-20' } }] },
      overrideAccess: true, sort: 'startDate', limit: 10,
    })
    expect(docs).toHaveLength(2)
    const first = docs[0]
    expect(first.startDate).toBe('2027-03-02T08:00:00.000Z') // PST studio midnight
    expect(first.status).toBe('published')
    expect(first.numberOfClasses).toBe(1)
    expect(first.endDate ?? null).toBeNull()
    expect(first.daysOfWeek ?? []).toHaveLength(0)
    expect(first.priceCents).toBe(5500) // class default via applyClassDefaults
    expect(first.capacity).toBe(8)
    expect(first.label).toContain('Wheel Basics') // label defaulted from class title
  })

  it('skips dates that already have a non-cancelled instance of the same class', async () => {
    const res = await createSeries(payload, {
      classId, instructorId, dates: ['2027-03-02', '2027-03-30'], startTime: '18:00', endTime: '20:00',
    })
    expect(res).toMatchObject({ ok: true, created: 1 })
    if (!res.ok) return
    expect(res.skipped).toEqual([{ date: '2027-03-02', reason: 'already scheduled' }])
  })

  it('a cancelled instance does not block the date', async () => {
    const cancelled = await payload.create({
      collection: 'class-instances', overrideAccess: true,
      data: { class: classId, instructor: instructorId, startDate: '2027-04-06T07:00:00.000Z', startTime: '18:00', endTime: '20:00', numberOfClasses: 1, status: 'cancelled' },
    })
    expect(cancelled.status).toBe('cancelled')
    const res = await createSeries(payload, {
      classId, instructorId, dates: ['2027-04-06'], startTime: '18:00', endTime: '20:00',
    })
    expect(res).toMatchObject({ ok: true, created: 1, skipped: [] })
  })

  it('flags a conflict for an instance stored at a non-convention same-day instant', async () => {
    // 10:00 UTC = 3am Pacific on 2027-05-11 — not the studio-midnight convention
    // instant, but still the same studio calendar day.
    await payload.create({
      collection: 'class-instances', overrideAccess: true,
      data: { class: classId, instructor: instructorId, startDate: '2027-05-11T10:00:00.000Z', startTime: '18:00', endTime: '20:00', numberOfClasses: 1, status: 'published' },
    })
    const res = await createSeries(payload, {
      classId, instructorId, dates: ['2027-05-11'], startTime: '18:00', endTime: '20:00',
    })
    expect(res).toMatchObject({ ok: true, created: 0 })
    if (!res.ok) return
    expect(res.skipped).toEqual([{ date: '2027-05-11', reason: 'already scheduled' }])
  })

  it('validates inputs', async () => {
    expect(await createSeries(payload, { classId, instructorId, dates: [], startTime: '18:00', endTime: '20:00' }))
      .toMatchObject({ ok: false, status: 400 })
    expect(await createSeries(payload, { classId, instructorId, dates: ['2027-05-04'], startTime: '25:00', endTime: '20:00' }))
      .toMatchObject({ ok: false, status: 400 })
    expect(await createSeries(payload, { classId, instructorId, dates: ['not-a-date'], startTime: '18:00', endTime: '20:00' }))
      .toMatchObject({ ok: false, status: 400 })
    expect(await createSeries(payload, { classId: 999999, instructorId, dates: ['2027-05-04'], startTime: '18:00', endTime: '20:00' }))
      .toMatchObject({ ok: false, status: 404 })
    const tooMany = Array.from({ length: 53 }, (_, i) => `2027-06-${String((i % 28) + 1).padStart(2, '0')}`)
    expect(await createSeries(payload, { classId, instructorId, dates: tooMany, startTime: '18:00', endTime: '20:00' }))
      .toMatchObject({ ok: false, status: 400 })
  })
})

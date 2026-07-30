import { describe, it, expect } from 'vitest'
import { expandRule, MAX_SERIES_DATES } from '../../src/lib/recurrence'

describe('expandRule — weekly', () => {
  it('every Tuesday across a month boundary', () => {
    expect(expandRule({ kind: 'weekly', weekday: 'TU', interval: 1 }, { from: '2026-08-25', until: '2026-09-09' }))
      .toEqual(['2026-08-25', '2026-09-01', '2026-09-08'])
  })
  it('anchors on the first matching weekday ≥ from', () => {
    // 2026-08-01 is a Saturday; first Tuesday is 08-04.
    expect(expandRule({ kind: 'weekly', weekday: 'TU', interval: 1 }, { from: '2026-08-01', until: '2026-08-11' }))
      .toEqual(['2026-08-04', '2026-08-11'])
  })
  it('every other Saturday keeps a biweekly cadence', () => {
    expect(expandRule({ kind: 'weekly', weekday: 'SA', interval: 2 }, { from: '2026-08-01', until: '2026-09-30' }))
      .toEqual(['2026-08-01', '2026-08-15', '2026-08-29', '2026-09-12', '2026-09-26'])
  })
})

describe('expandRule — dayOfMonth', () => {
  it('the 1st of every month', () => {
    expect(expandRule({ kind: 'dayOfMonth', day: 1 }, { from: '2026-08-15', until: '2026-11-15' }))
      .toEqual(['2026-09-01', '2026-10-01', '2026-11-01'])
  })
  it('skips months without the day instead of shifting', () => {
    expect(expandRule({ kind: 'dayOfMonth', day: 31 }, { from: '2026-08-01', until: '2026-12-31' }))
      .toEqual(['2026-08-31', '2026-10-31', '2026-12-31']) // no Sep 31 / Nov 31
  })
  it('Feb 29 only exists in leap years', () => {
    expect(expandRule({ kind: 'dayOfMonth', day: 29 }, { from: '2027-02-01', until: '2027-03-01' })).toEqual([])
    expect(expandRule({ kind: 'dayOfMonth', day: 29 }, { from: '2028-02-01', until: '2028-03-01' }))
      .toEqual(['2028-02-29'])
  })
})

describe('expandRule — ordinalWeekday', () => {
  it('1st & 3rd Tuesday', () => {
    expect(expandRule({ kind: 'ordinalWeekday', weekday: 'TU', ordinals: [1, 3] }, { from: '2026-08-01', until: '2026-09-30' }))
      .toEqual(['2026-08-04', '2026-08-18', '2026-09-01', '2026-09-15'])
  })
  it('5th weekday only lands in months that have one', () => {
    // Sep 2026 has five Tuesdays (1, 8, 15, 22, 29); Aug 2026 has only four.
    expect(expandRule({ kind: 'ordinalWeekday', weekday: 'TU', ordinals: [5] }, { from: '2026-08-01', until: '2026-09-30' }))
      .toEqual(['2026-09-29'])
  })
  it('last Tuesday works in 4- and 5-Tuesday months', () => {
    expect(expandRule({ kind: 'ordinalWeekday', weekday: 'TU', ordinals: ['last'] }, { from: '2026-08-01', until: '2026-09-30' }))
      .toEqual(['2026-08-25', '2026-09-29'])
  })
  it('dedupes when 5th and last coincide', () => {
    expect(expandRule({ kind: 'ordinalWeekday', weekday: 'TU', ordinals: [5, 'last'] }, { from: '2026-09-01', until: '2026-09-30' }))
      .toEqual(['2026-09-29'])
  })
})

describe('expandRule — validation and bounds', () => {
  it('from and until are inclusive', () => {
    expect(expandRule({ kind: 'weekly', weekday: 'TU', interval: 1 }, { from: '2026-09-01', until: '2026-09-01' }))
      .toEqual(['2026-09-01'])
  })
  it('rejects until before from', () => {
    expect(() => expandRule({ kind: 'weekly', weekday: 'TU', interval: 1 }, { from: '2026-09-02', until: '2026-09-01' }))
      .toThrow(/until/i)
  })
  it('rejects invalid calendar dates', () => {
    expect(() => expandRule({ kind: 'weekly', weekday: 'TU', interval: 1 }, { from: '2026-02-30', until: '2026-03-30' }))
      .toThrow(/date/i)
  })
  it('rejects day-of-month outside 1–31 and empty ordinals', () => {
    expect(() => expandRule({ kind: 'dayOfMonth', day: 0 }, { from: '2026-01-01', until: '2026-02-01' })).toThrow()
    expect(() => expandRule({ kind: 'dayOfMonth', day: 32 }, { from: '2026-01-01', until: '2026-02-01' })).toThrow()
    expect(() => expandRule({ kind: 'ordinalWeekday', weekday: 'TU', ordinals: [] }, { from: '2026-01-01', until: '2026-02-01' })).toThrow()
  })
  it(`caps a batch at ${MAX_SERIES_DATES} dates`, () => {
    expect(() => expandRule({ kind: 'weekly', weekday: 'TU', interval: 1 }, { from: '2026-01-01', until: '2027-12-31' }))
      .toThrow(/52/)
  })
})

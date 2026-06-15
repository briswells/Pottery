import { describe, it, expect } from 'vitest'
import { splitByTiming, todayKey } from '../../src/lib/myClasses'

// Minimal instance shape splitByTiming cares about.
const inst = (startDate: string, endDate?: string | null) => ({ startDate, endDate })

describe('splitByTiming', () => {
  const today = '2026-06-15'

  it('buckets a multi-week run by its end date', () => {
    const ongoing = inst('2026-06-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z')
    const finished = inst('2026-04-01T00:00:00.000Z', '2026-05-06T00:00:00.000Z')
    const { upcoming, past } = splitByTiming([ongoing, finished], today)
    expect(upcoming).toEqual([ongoing])
    expect(past).toEqual([finished])
  })

  it('treats a run ending exactly today as upcoming/current', () => {
    const endsToday = inst('2026-06-01T00:00:00.000Z', '2026-06-15T00:00:00.000Z')
    const { upcoming, past } = splitByTiming([endsToday], today)
    expect(upcoming).toEqual([endsToday])
    expect(past).toEqual([])
  })

  it('buckets a single-session class (no endDate) by startDate', () => {
    const future = inst('2026-07-05T00:00:00.000Z', null)
    const pastOne = inst('2026-05-05T00:00:00.000Z')
    const { upcoming, past } = splitByTiming([future, pastOne], today)
    expect(upcoming).toEqual([future])
    expect(past).toEqual([pastOne])
  })

  it('sorts upcoming soonest-first and past most-recent-first', () => {
    const a = inst('2026-07-01T00:00:00.000Z', null)
    const b = inst('2026-06-20T00:00:00.000Z', null)
    const c = inst('2026-05-01T00:00:00.000Z', null)
    const d = inst('2026-03-01T00:00:00.000Z', null)
    const { upcoming, past } = splitByTiming([a, b, c, d], today)
    expect(upcoming).toEqual([b, a])
    expect(past).toEqual([c, d])
  })

  it('returns empty buckets for no instances', () => {
    expect(splitByTiming([], today)).toEqual({ upcoming: [], past: [] })
  })
})

describe('todayKey', () => {
  it('returns the UTC date-only key', () => {
    expect(todayKey(new Date('2026-06-15T23:30:00.000Z'))).toBe('2026-06-15')
  })
})

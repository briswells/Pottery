import { describe, it, expect } from 'vitest'
import { parseHHMM, dateParts, formatTime, formatDate, expandSessions, computeEndDate, monthGrid, scheduleSummary } from '../../src/lib/schedule'

describe('parseHHMM', () => {
  it('parses 24-hour times', () => {
    expect(parseHHMM('18:00')).toEqual([18, 0])
    expect(parseHHMM('09:30')).toEqual([9, 30])
  })
  it('throws on malformed input', () => {
    expect(() => parseHHMM('25:00')).toThrow()
    expect(() => parseHHMM('6pm')).toThrow()
  })
})

describe('dateParts', () => {
  it('extracts y/m/d from a UTC-midnight date-only ISO', () => {
    expect(dateParts('2026-07-03T00:00:00.000Z')).toEqual([2026, 7, 3])
  })
})

describe('formatTime', () => {
  it('formats midnight, noon, and an afternoon time', () => {
    expect(formatTime('00:00')).toBe('12:00 AM')
    expect(formatTime('12:00')).toBe('12:00 PM')
    expect(formatTime('18:30')).toBe('6:30 PM')
  })
})

describe('formatDate', () => {
  it('formats a UTC-midnight ISO date as a readable date', () => {
    expect(formatDate('2026-07-04T00:00:00.000Z')).toBe('Jul 4, 2026')
  })
})

describe('expandSessions', () => {
  const range = (a: string, b: string) => [new Date(a), new Date(b)] as const

  it('returns a single session when there is no endDate', () => {
    const [s, e] = range('2026-07-01', '2026-07-31')
    expect(
      expandSessions({ startDate: '2026-07-04T00:00:00.000Z' }, s, e),
    ).toEqual(['2026-07-04'])
  })

  it('expands weekly Tue/Fri occurrences within the range', () => {
    const [s, e] = range('2026-07-01', '2026-07-15')
    // Jul 2026: 7th=Tue, 10th=Fri, 14th=Tue
    const out = expandSessions(
      {
        startDate: '2026-07-07T00:00:00.000Z',
        endDate: '2026-07-15T00:00:00.000Z',
        daysOfWeek: ['TU', 'FR'],
      },
      s,
      e,
    )
    expect(out).toEqual(['2026-07-07', '2026-07-10', '2026-07-14'])
  })

  it('excludes skipDates', () => {
    const [s, e] = range('2026-07-01', '2026-07-15')
    const out = expandSessions(
      {
        startDate: '2026-07-07T00:00:00.000Z',
        endDate: '2026-07-15T00:00:00.000Z',
        daysOfWeek: ['TU', 'FR'],
        skipDates: [{ date: '2026-07-10T00:00:00.000Z' }],
      },
      s,
      e,
    )
    expect(out).toEqual(['2026-07-07', '2026-07-14'])
  })

  it('clips occurrences to the requested range', () => {
    const [s, e] = range('2026-07-08', '2026-07-12')
    const out = expandSessions(
      {
        startDate: '2026-07-07T00:00:00.000Z',
        endDate: '2026-07-31T00:00:00.000Z',
        daysOfWeek: ['TU', 'FR'],
      },
      s,
      e,
    )
    expect(out).toEqual(['2026-07-10']) // only the Fri inside 8th–12th
  })

  it('returns single session on startDate when daysOfWeek is empty and endDate is provided', () => {
    const [s, e] = range('2026-07-01', '2026-07-31')
    const out = expandSessions(
      {
        startDate: '2026-07-07T00:00:00.000Z',
        endDate: '2026-07-31T00:00:00.000Z',
        daysOfWeek: [],
      },
      s,
      e,
    )
    expect(out).toEqual(['2026-07-07'])
  })
})

describe('computeEndDate', () => {
  it('returns the date of the Nth weekly meeting', () => {
    // Sep 1 2026 is a Tuesday; six Tuesdays land on Oct 6.
    expect(computeEndDate('2026-09-01T00:00:00.000Z', ['TU'], 6)).toBe('2026-10-06T00:00:00.000Z')
  })

  it('counts across multiple meeting days', () => {
    // Jul 7 2026 is a Tuesday; Tue/Fri sessions: 7,10,14,17 → 4th is Jul 17.
    expect(computeEndDate('2026-07-07T00:00:00.000Z', ['TU', 'FR'], 4)).toBe('2026-07-17T00:00:00.000Z')
  })

  it('pushes the end date out past skipped dates so N sessions still occur', () => {
    // Skipping Sep 15 means the 6th Tuesday becomes Oct 13.
    expect(
      computeEndDate('2026-09-01T00:00:00.000Z', ['TU'], 6, [{ date: '2026-09-15T00:00:00.000Z' }]),
    ).toBe('2026-10-13T00:00:00.000Z')
  })

  it('returns the start date for a single session', () => {
    expect(computeEndDate('2026-09-01T00:00:00.000Z', ['TU'], 1)).toBe('2026-09-01T00:00:00.000Z')
  })

  it('returns null when no meeting days or count are given', () => {
    expect(computeEndDate('2026-09-01T00:00:00.000Z', [], 6)).toBeNull()
    expect(computeEndDate('2026-09-01T00:00:00.000Z', ['TU'], 0)).toBeNull()
  })
})

describe('monthGrid', () => {
  it('returns 6 weeks of 7 days, Sunday-first, padded with adjacent months', () => {
    const grid = monthGrid(2026, 7) // July 2026; 1st is a Wednesday
    expect(grid).toHaveLength(6)
    expect(grid[0]).toHaveLength(7)
    expect(grid[0][0]).toBe('2026-06-28') // Sunday before Jul 1
    expect(grid[0][3]).toBe('2026-07-01')
  })
})

describe('scheduleSummary', () => {
  it('summarizes a recurring course', () => {
    const s = scheduleSummary({
      startDate: '2026-07-07T00:00:00.000Z',
      endDate: '2026-08-11T00:00:00.000Z',
      daysOfWeek: ['TU', 'FR'],
      startTime: '18:00',
      endTime: '20:00',
    })
    expect(s).toContain('Tue')
    expect(s).toContain('Fri')
    expect(s).toContain('6:00')
    expect(s).toContain('8:00')
  })
  it('summarizes a single-day workshop', () => {
    const s = scheduleSummary({
      startDate: '2026-07-04T00:00:00.000Z',
      startTime: '10:00',
      endTime: '14:00',
    })
    expect(s).toContain('Jul')
    expect(s).toContain('10:00')
  })
})

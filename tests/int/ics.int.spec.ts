import { describe, it, expect } from 'vitest'
import { buildClassIcs } from '../../src/lib/ics'

const base = {
  id: 42,
  startDate: '2026-07-07T00:00:00.000Z',
  startTime: '18:00',
  endTime: '20:00',
  location: 'Studio A',
}

describe('buildClassIcs', () => {
  it('builds a single-session event with no RRULE', () => {
    const ics = buildClassIcs(base, '6-Week Wheel Throwing')
    expect(ics).toContain('BEGIN:VEVENT')
    expect(ics).toContain('SUMMARY:6-Week Wheel Throwing')
    expect(ics).toContain('LOCATION:Studio A')
    expect(ics).toContain('UID:class-instance-42@portsidepottery')
    // floating local time (no trailing Z) at 18:00
    expect(ics).toMatch(/DTSTART:20260707T180000(?!Z)/)
    expect(ics).not.toContain('RRULE')
  })

  it('builds a weekly recurring event with BYDAY, UNTIL and EXDATE', () => {
    const ics = buildClassIcs(
      {
        ...base,
        endDate: '2026-08-11T00:00:00.000Z',
        daysOfWeek: ['TU', 'FR'],
        skipDates: [{ date: '2026-07-10T00:00:00.000Z' }],
      },
      'Wheel Series',
    )
    expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=TU,FR;UNTIL=20260811T235959')
    expect(ics).not.toMatch(/UNTIL=[0-9T]*Z/)
    expect(ics).toContain('EXDATE:20260710T180000')
    expect(ics).not.toMatch(/EXDATE:[^\r\n]*Z/)
  })

  it('falls back to the studio location when none is provided', () => {
    const { location, ...noLoc } = base
    const ics = buildClassIcs(noLoc, 'Raku Day')
    expect(ics).toContain('LOCATION:Portside Pottery')
  })

  it('throws when the end time is not after the start time', () => {
    expect(() => buildClassIcs({ ...base, endTime: '18:00' }, 'Bad')).toThrow()
  })

  it('joins multiple skip dates into one EXDATE', () => {
    const ics = buildClassIcs({
      ...base, endDate: '2026-08-11T00:00:00.000Z', daysOfWeek: ['TU', 'FR'],
      skipDates: [{ date: '2026-07-10T00:00:00.000Z' }, { date: '2026-07-14T00:00:00.000Z' }],
    }, 'Series')
    expect(ics).toContain('EXDATE:20260710T180000,20260714T180000')
  })

  it('treats daysOfWeek without an endDate as a single session (no RRULE)', () => {
    const ics = buildClassIcs({ ...base, daysOfWeek: ['TU', 'FR'] }, 'One-off')
    expect(ics).not.toContain('RRULE')
    expect(ics).not.toContain('EXDATE')
  })
})

import { describe, it, expect } from 'vitest'
import { studioMidnightIso, toStudioLocal } from '../../src/lib/studio'

describe('studioMidnightIso', () => {
  it('resolves PDT dates to 07:00Z', () => {
    expect(studioMidnightIso('2026-07-18')).toBe('2026-07-18T07:00:00.000Z')
  })
  it('resolves PST dates to 08:00Z', () => {
    expect(studioMidnightIso('2026-01-15')).toBe('2026-01-15T08:00:00.000Z')
  })
  it('round-trips through toStudioLocal', () => {
    const iso = studioMidnightIso('2026-11-01') // DST fall-back day
    expect(toStudioLocal(iso)).toEqual({ date: '2026-11-01', time: '00:00' })
  })
})

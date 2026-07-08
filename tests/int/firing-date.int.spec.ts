import { describe, it, expect } from 'vitest'
import { lastFridayOfMonth, nextFiringDate } from '../../src/lib/firing-date'

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

describe('lastFridayOfMonth', () => {
  it('finds the last Friday of a month whose last day is not Friday', () => {
    // July 2026 last day is Friday the 31st.
    expect(ymd(lastFridayOfMonth(2026, 6))).toBe('2026-07-31')
  })
  it('finds the last Friday of a month whose last day IS Friday', () => {
    expect(ymd(lastFridayOfMonth(2026, 6))).toBe('2026-07-31')
    expect(lastFridayOfMonth(2026, 6).getDay()).toBe(5)
  })
})

describe('nextFiringDate', () => {
  it('mid-month: returns the last Friday of the same month', () => {
    expect(ymd(nextFiringDate(new Date(2026, 6, 15)))).toBe('2026-07-31')
  })
  it('on the last Friday itself: returns that same day', () => {
    expect(ymd(nextFiringDate(new Date(2026, 6, 31)))).toBe('2026-07-31')
  })
  it('the day after the last Friday: rolls to next month', () => {
    expect(ymd(nextFiringDate(new Date(2026, 7, 1)))).toBe('2026-08-28')
  })
  it('rolls across a year boundary', () => {
    expect(ymd(nextFiringDate(new Date(2026, 11, 30)))).toBe('2027-01-29')
  })
})

import { describe, it, expect } from 'vitest'
import { centsToDollars, dollarsToCents } from '../../src/lib/format'

describe('centsToDollars', () => {
  it('formats cents as 2-decimal dollars (no symbol)', () => {
    expect(centsToDollars(4500)).toBe('45.00')
    expect(centsToDollars(22000)).toBe('220.00')
    expect(centsToDollars(0)).toBe('0.00')
    expect(centsToDollars(5)).toBe('0.05')
  })
})

describe('dollarsToCents', () => {
  it('parses whole and decimal dollars to cents', () => {
    expect(dollarsToCents('45')).toBe(4500)
    expect(dollarsToCents('45.1')).toBe(4510)
    expect(dollarsToCents('45.5')).toBe(4550)
    expect(dollarsToCents('45.50')).toBe(4550)
    expect(dollarsToCents('0')).toBe(0)
    expect(dollarsToCents('.5')).toBe(50)
    expect(dollarsToCents('45.')).toBe(4500)
  })
  it('rounds to the nearest cent', () => {
    expect(dollarsToCents('45.999')).toBe(4600)
  })
  it('strips symbols and stray characters', () => {
    expect(dollarsToCents('$45.00')).toBe(4500)
    expect(dollarsToCents('45.00 USD')).toBe(4500)
    expect(dollarsToCents('1,234.50')).toBe(123450)
  })
  it('keeps only the first dot', () => {
    expect(dollarsToCents('45.1.2')).toBe(4512)
  })
  it('returns null for empty/invalid input', () => {
    expect(dollarsToCents('')).toBeNull()
    expect(dollarsToCents('abc')).toBeNull()
    expect(dollarsToCents('.')).toBeNull()
  })
  it('round-trips with centsToDollars', () => {
    expect(centsToDollars(dollarsToCents('45.10')!)).toBe('45.10')
  })
})

import { describe, it, expect } from 'vitest'
import { computeTotals } from '../../src/lib/tax'

describe('computeTotals', () => {
  it('taxes the exact table of known cases at 8.9%', () => {
    expect(computeTotals({ subtotalCents: 5000, discountCents: 0, taxRatePercent: 8.9 }))
      .toEqual({ taxableCents: 5000, taxCents: 445, totalCents: 5445 })
    expect(computeTotals({ subtotalCents: 2500, discountCents: 0, taxRatePercent: 8.9 }))
      .toEqual({ taxableCents: 2500, taxCents: 222, totalCents: 2722 }) // 222.5 rounds to even (222)
    expect(computeTotals({ subtotalCents: 1500, discountCents: 0, taxRatePercent: 8.9 }))
      .toEqual({ taxableCents: 1500, taxCents: 134, totalCents: 1634 }) // 133.5 rounds to even (134)
    expect(computeTotals({ subtotalCents: 5000, discountCents: 1000, taxRatePercent: 8.9 }))
      .toEqual({ taxableCents: 4000, taxCents: 356, totalCents: 4356 }) // coupon reduces taxable
    expect(computeTotals({ subtotalCents: 1, discountCents: 0, taxRatePercent: 8.9 }))
      .toEqual({ taxableCents: 1, taxCents: 0, totalCents: 1 })
  })

  it('rate 0 (or unset settings) reproduces pre-tax behavior exactly', () => {
    expect(computeTotals({ subtotalCents: 9500, discountCents: 500, taxRatePercent: 0 }))
      .toEqual({ taxableCents: 9000, taxCents: 0, totalCents: 9000 })
  })

  it('clamps a discount larger than the subtotal to a $0 total', () => {
    expect(computeTotals({ subtotalCents: 5000, discountCents: 5000, taxRatePercent: 8.9 }))
      .toEqual({ taxableCents: 0, taxCents: 0, totalCents: 0 })
    expect(computeTotals({ subtotalCents: 5000, discountCents: 9999, taxRatePercent: 8.9 }))
      .toEqual({ taxableCents: 0, taxCents: 0, totalCents: 0 })
  })

  it('treats invalid rates as 0', () => {
    for (const rate of [NaN, Infinity, -8.9]) {
      expect(computeTotals({ subtotalCents: 5000, discountCents: 0, taxRatePercent: rate }).taxCents).toBe(0)
    }
  })
})

import type { Payload } from 'payload'

/**
 * Sales-tax math shared by the server (authoritative charge) and the payment
 * forms (display). One pure function, integer cents throughout — the number
 * the customer sees is the number the card is charged, by construction.
 * WA treatment: seller-funded coupons reduce the taxable price, so tax is
 * computed on (subtotal − discount). Tax-cent rounding matches Square's
 * order-tax calculation (half-to-even), confirmed empirically by
 * scripts/square-tax-rounding-sweep.ts.
 */

export interface TotalsInput {
  subtotalCents: number
  discountCents: number
  /** e.g. 8.9 — from Site Settings. 0 (or invalid) disables tax. */
  taxRatePercent: number
}

export interface Totals {
  taxableCents: number
  taxCents: number
  totalCents: number
}

/**
 * taxable × rate% rounded half-to-even in exact integer arithmetic,
 * matching Square's order-tax rounding at any admin-entered rate
 * (up to 5 decimal places of percent). Float division (e.g. (5500 * 0.7) /
 * 100 === 38.49999999999999) would misclassify true half-cent cases at
 * rates other than 8.9%, so the half comparison is done over integers.
 */
function taxCentsHalfEven(taxableCents: number, taxRatePercent: number): number {
  const n = taxableCents * Math.round(taxRatePercent * 1e5)
  const d = 1e7 // 100 (percent) × 1e5 (rate scaling)
  const r = n % d
  const q = (n - r) / d
  if (r * 2 > d) return q + 1
  if (r * 2 < d) return q
  return q % 2 === 0 ? q : q + 1
}

export function computeTotals({ subtotalCents, discountCents, taxRatePercent }: TotalsInput): Totals {
  const taxableCents = Math.max(0, Math.round(subtotalCents) - Math.round(discountCents))
  const rate = Number.isFinite(taxRatePercent) && taxRatePercent > 0 ? taxRatePercent : 0
  const taxCents = taxCentsHalfEven(taxableCents, rate)
  return { taxableCents, taxCents, totalCents: taxableCents + taxCents }
}

/** Current checkout tax rate from Site Settings; 0 when unset (never throws). */
export async function getSalesTaxPercent(payload: Payload): Promise<number> {
  const settings = await payload.findGlobal({ slug: 'site-settings', depth: 0 })
  const rate = (settings as { salesTaxPercent?: number | null }).salesTaxPercent
  return typeof rate === 'number' && Number.isFinite(rate) && rate > 0 ? rate : 0
}

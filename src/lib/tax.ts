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

/** Round half-to-even, matching Square's order-tax rounding. */
function roundHalfEven(x: number): number {
  const floor = Math.floor(x)
  const diff = x - floor
  if (diff > 0.5) return floor + 1
  if (diff < 0.5) return floor
  return floor % 2 === 0 ? floor : floor + 1
}

export function computeTotals({ subtotalCents, discountCents, taxRatePercent }: TotalsInput): Totals {
  const taxableCents = Math.max(0, Math.round(subtotalCents) - Math.round(discountCents))
  const rate = Number.isFinite(taxRatePercent) && taxRatePercent > 0 ? taxRatePercent : 0
  const taxCents = roundHalfEven((taxableCents * rate) / 100)
  return { taxableCents, taxCents, totalCents: taxableCents + taxCents }
}

/** Current checkout tax rate from Site Settings; 0 when unset (never throws). */
export async function getSalesTaxPercent(payload: Payload): Promise<number> {
  const settings = await payload.findGlobal({ slug: 'site-settings', depth: 0 })
  const rate = (settings as { salesTaxPercent?: number | null }).salesTaxPercent
  return typeof rate === 'number' && Number.isFinite(rate) && rate > 0 ? rate : 0
}

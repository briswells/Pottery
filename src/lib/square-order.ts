import { randomUUID } from 'crypto'
import { getSquareClient, SQUARE_LOCATION_ID } from './square'

export interface ItemizedOrderInput {
  itemName: string        // e.g. 'Class: Wheel Throwing' | 'Firing: 3 half shelf(s)'
  subtotalCents: number   // pre-discount, pre-tax
  discountCents: number   // 0 when no coupon
  discountName?: string   // e.g. 'Coupon SUMMER10' — set whenever discountCents > 0
  taxRatePercent: number  // 0 → no tax line
  expectedTotalCents: number // totals.totalCents from computeTotals
  referenceId: string     // 'booking-<id>' | 'firing-<id>'
}

/**
 * Creates a Square order itemizing a sale (line item, coupon discount, WA
 * sales tax) so Square's tax reports see the collected tax. Returns the order
 * id only when Square's computed total exactly equals expectedTotalCents —
 * the payment amount must match the order total, and the customer must never
 * be charged a number the form didn't display. Every failure path returns
 * null so the caller falls back to an unitemized charge; never throws.
 */
export async function createItemizedOrder(input: ItemizedOrderInput): Promise<string | null> {
  const taxableCents = Math.max(0, input.subtotalCents - input.discountCents)
  try {
    const client = getSquareClient()
    const res = await client.orders.create({
      idempotencyKey: randomUUID(),
      order: {
        locationId: SQUARE_LOCATION_ID(),
        referenceId: input.referenceId,
        lineItems: [{
          name: input.itemName,
          quantity: '1',
          basePriceMoney: { amount: BigInt(input.subtotalCents), currency: 'USD' },
        }],
        ...(input.discountCents > 0 ? { discounts: [{
          name: input.discountName ?? 'Discount',
          type: 'FIXED_AMOUNT' as const,
          amountMoney: { amount: BigInt(input.discountCents), currency: 'USD' },
          scope: 'ORDER' as const,
        }] } : {}),
        ...(input.taxRatePercent > 0 && taxableCents > 0 ? { taxes: [{
          name: 'WA sales tax',
          type: 'ADDITIVE' as const,
          percentage: String(input.taxRatePercent),
          scope: 'ORDER' as const,
        }] } : {}),
      },
    })
    const order = res.order
    const squareTotal = order?.totalMoney?.amount != null ? Number(order.totalMoney.amount) : null
    if (!order?.id || squareTotal !== input.expectedTotalCents) {
      console.error(
        `CRITICAL: SQUARE ORDER TOTAL MISMATCH OR MISSING ID (${input.referenceId}): square=${squareTotal} expected=${input.expectedTotalCents} — charging unitemized`,
      )
      return null
    }
    return order.id
  } catch (e) {
    console.error(`Square order creation failed (${input.referenceId}) — charging unitemized:`, e)
    return null
  }
}

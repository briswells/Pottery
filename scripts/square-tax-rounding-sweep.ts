// scripts/square-tax-rounding-sweep.ts
//
// Empirically pins Square's order-tax cent-rounding by creating sandbox
// orders at 8.9% and diffing Square's computed tax against computeTotals.
// Run: npx tsx scripts/square-tax-rounding-sweep.ts
import 'dotenv/config'
import { randomUUID } from 'crypto'
import { SquareClient, SquareEnvironment } from 'square'
import { computeTotals } from '../src/lib/tax'

if (process.env.SQUARE_ENVIRONMENT === 'production') {
  console.error('Refusing to run against production Square.')
  process.exit(1)
}

const client = new SquareClient({
  token: process.env.SQUARE_ACCESS_TOKEN!,
  environment: SquareEnvironment.Sandbox,
})
const locationId = process.env.SQUARE_LOCATION_ID!
const RATE = 8.9

interface Case { subtotalCents: number; discountCents: number }

// taxable × 8.9% lands exactly on a half cent when taxable ≡ 500 (mod 1000),
// so 500/1500/2500/3500 are the rounding-mode discriminators. The 1000–1100
// range sweeps every fractional remainder; the discount cases prove the
// coupon path reaches the same taxable bucket.
const cases: Case[] = [
  ...[500, 1500, 2500, 3500].map((s) => ({ subtotalCents: s, discountCents: 0 })),
  ...Array.from({ length: 101 }, (_, i) => ({ subtotalCents: 1000 + i, discountCents: 0 })),
  { subtotalCents: 3000, discountCents: 500 },   // taxable 2500 via discount
  { subtotalCents: 5000, discountCents: 1000 },  // taxable 4000 (exact, sanity)
  { subtotalCents: 2500, discountCents: 1 },     // taxable 2499
]

async function squareTotals(c: Case) {
  const res = await client.orders.create({
    idempotencyKey: randomUUID(),
    order: {
      locationId,
      referenceId: `rounding-sweep-${c.subtotalCents}-${c.discountCents}`,
      lineItems: [{
        name: 'Rounding sweep', quantity: '1',
        basePriceMoney: { amount: BigInt(c.subtotalCents), currency: 'USD' },
      }],
      ...(c.discountCents > 0 ? { discounts: [{
        name: 'Sweep discount', type: 'FIXED_AMOUNT' as const,
        amountMoney: { amount: BigInt(c.discountCents), currency: 'USD' },
        scope: 'ORDER' as const,
      }] } : {}),
      taxes: [{
        name: 'WA sales tax', type: 'ADDITIVE' as const,
        percentage: String(RATE), scope: 'ORDER' as const,
      }],
    },
  })
  return {
    tax: Number(res.order?.totalTaxMoney?.amount ?? -1),
    total: Number(res.order?.totalMoney?.amount ?? -1),
  }
}

async function squareTotalsWithRetry(c: Case) {
  try {
    return await squareTotals(c)
  } catch (err) {
    console.error(`retrying sub=${c.subtotalCents} disc=${c.discountCents} after error:`, err instanceof Error ? err.message : err)
    return await squareTotals(c)
  }
}

async function main() {
  let mismatches = 0
  for (const c of cases) {
    const ours = computeTotals({ subtotalCents: c.subtotalCents, discountCents: c.discountCents, taxRatePercent: RATE })
    const theirs = await squareTotalsWithRetry(c)
    const ok = theirs.tax === ours.taxCents && theirs.total === ours.totalCents
    if (!ok) {
      mismatches++
      console.log(`MISMATCH sub=${c.subtotalCents} disc=${c.discountCents} taxable=${ours.taxableCents}: square tax=${theirs.tax} total=${theirs.total} | ours tax=${ours.taxCents} total=${ours.totalCents}`)
    }
  }
  console.log(mismatches === 0 ? `All ${cases.length} cases match — Square rounds half-up like computeTotals.` : `${mismatches}/${cases.length} cases mismatch.`)
  process.exit(mismatches === 0 ? 0 : 1)
}

main()

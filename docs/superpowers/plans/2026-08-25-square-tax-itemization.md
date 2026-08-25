# Square Tax Itemization (Orders API) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Attach every class-booking and firing charge to a Square Order that itemizes the sale (line item, coupon discount, WA sales tax) so Square's Sales-tax report shows collected tax.

**Architecture:** A new `createItemizedOrder` in `src/lib/square-order.ts` creates an ad-hoc Square order and returns its id only when Square's computed total exactly equals our `computeTotals` total (else `null`, logged). The two payment services call it via a new injected `deps.createOrder` immediately before charging; `chargeCard` gains an optional `orderId` passthrough. A sandbox sweep script pins Square's cent-rounding first, since the payment amount must exactly match Square's order total.

**Tech Stack:** Next.js 16, Payload CMS 3, `square` SDK v44 (camelCase fields, `BigInt` money amounts), vitest (int tests against the `portside_test` Postgres in Docker), `tsx` for scripts.

## Global Constraints

- **The displayed total is the charged total, always.** `charge` is always called with `totals.totalCents` from `computeTotals` — never with a Square-computed number.
- **Itemization never blocks checkout.** `createItemizedOrder` never throws; every failure path logs via `console.error` and returns `null`, and the caller charges unitemized exactly as today.
- **$0 totals create no order** (no payment to attach; an unpaid OPEN order would linger).
- **No Square catalog writes** — orders only, all ad hoc (`FIXED_AMOUNT` discount, `ADDITIVE` percentage tax, both `scope: 'ORDER'`). The sweep script and all testing use the **sandbox** environment only; it must refuse to run when `SQUARE_ENVIRONMENT === 'production'`.
- **No schema change, no migration.**
- Tax line name is exactly `WA sales tax`; discount name is exactly `Coupon <CODE>` with the code uppercased.
- Commit messages: conventional-commit style, **no AI attribution / Co-Authored-By lines**.
- Int tests: `pnpm run test:int <file...>` (needs the local Docker Postgres with the `portside_test` DB running; files run serially).

---

### Task 1: Sandbox rounding sweep — pin Square's tax rounding

Square computes order tax from the percentage itself and the payment must exactly equal the order total, so our `computeTotals` rounding (`Math.round`, half-up) must match Square's — otherwise every half-cent case falls back to unitemized charges. This task determines Square's US rounding empirically and aligns `computeTotals` if needed.

**Files:**
- Create: `scripts/square-tax-rounding-sweep.ts`
- Possibly modify: `src/lib/tax.ts` (only if Square disagrees with half-up)
- Possibly modify: `tests/int/tax.int.spec.ts` (only if rounding changes)

**Interfaces:**
- Consumes: `computeTotals` from `src/lib/tax.ts` (existing: `computeTotals({subtotalCents, discountCents, taxRatePercent}) → {taxableCents, taxCents, totalCents}`).
- Produces: a verdict (`half-up` | `half-even` | `floor`) recorded in the task report, and a `computeTotals` whose `taxCents` matches Square for every swept case. Tasks 2–3 rely on that equality.

- [ ] **Step 1: Write the sweep script**

```ts
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

let mismatches = 0
for (const c of cases) {
  const ours = computeTotals({ subtotalCents: c.subtotalCents, discountCents: c.discountCents, taxRatePercent: RATE })
  const theirs = await squareTotals(c)
  const ok = theirs.tax === ours.taxCents && theirs.total === ours.totalCents
  if (!ok) {
    mismatches++
    console.log(`MISMATCH sub=${c.subtotalCents} disc=${c.discountCents} taxable=${ours.taxableCents}: square tax=${theirs.tax} total=${theirs.total} | ours tax=${ours.taxCents} total=${ours.totalCents}`)
  }
}
console.log(mismatches === 0 ? `All ${cases.length} cases match — Square rounds half-up like computeTotals.` : `${mismatches}/${cases.length} cases mismatch.`)
process.exit(mismatches === 0 ? 0 : 1)
```

- [ ] **Step 2: Run the sweep against the sandbox**

Run: `npx tsx scripts/square-tax-rounding-sweep.ts` (repo root; `.env` already holds sandbox `SQUARE_ACCESS_TOKEN` / `SQUARE_LOCATION_ID` / `SQUARE_ENVIRONMENT=sandbox`).
Expected: either `All 108 cases match` (→ skip Steps 3–4) or a mismatch list.

- [ ] **Step 3 (only on mismatch): Identify Square's mode and align `computeTotals`**

Decision table using the two discriminator taxables (1500 → 133.5 raw; 2500 → 222.5 raw):

| Square tax on 1500 / 2500 | Mode | Change in `src/lib/tax.ts` |
|---|---|---|
| 134 / 223 | half-up | none (impossible here — Step 2 would have passed) |
| 134 / 222 | half-even (banker's) | replace `Math.round(...)` with a half-even rounder (below) |
| 133 / 222 | floor | replace `Math.round((taxableCents * rate) / 100)` with `Math.floor((taxableCents * rate) / 100)` |

Half-even rounder, if needed (place above `computeTotals`, use it in place of `Math.round`):

```ts
/** Round half-to-even, matching Square's order-tax rounding. */
function roundHalfEven(x: number): number {
  const floor = Math.floor(x)
  const diff = x - floor
  if (diff > 0.5) return floor + 1
  if (diff < 0.5) return floor
  return floor % 2 === 0 ? floor : floor + 1
}
```

Update the one rounding-sensitive expectation in `tests/int/tax.int.spec.ts`: the `2500 @ 8.9% → 223` (half-up) case becomes `222` under half-even or floor, and `1500 → 134` stays `134` under half-even but becomes `133` under floor (add the 1500 case if the file lacks it). All other table rows ($50.00 → 445, $40.00 → 356, 1¢ → 0, rate 0, discount ≥ subtotal) are rounding-mode-insensitive — verify they still pass unchanged. Also update the comment in `src/lib/tax.ts` to say the rounding matches Square's order calculation.

- [ ] **Step 4 (only on mismatch): Re-run tax tests and the sweep**

Run: `pnpm run test:int tests/int/tax.int.spec.ts` → PASS, then `npx tsx scripts/square-tax-rounding-sweep.ts` → `All 108 cases match`.

- [ ] **Step 5: Commit**

```bash
git add scripts/square-tax-rounding-sweep.ts src/lib/tax.ts tests/int/tax.int.spec.ts
git commit -m "feat(tax): sandbox sweep pinning Square order-tax rounding"
```

(If Steps 3–4 were skipped, only the script is added.) Report the verdict (half-up / half-even / floor) in the task report — the controller records it for the final review.

---

### Task 2: `createItemizedOrder` in `src/lib/square-order.ts`

**Files:**
- Create: `src/lib/square-order.ts`
- Test: `tests/int/square-order.int.spec.ts`

**Interfaces:**
- Consumes: `getSquareClient`, `SQUARE_LOCATION_ID` from `src/lib/square.ts`.
- Produces: `export interface ItemizedOrderInput { itemName: string; subtotalCents: number; discountCents: number; discountName?: string; taxRatePercent: number; expectedTotalCents: number; referenceId: string }` and `export async function createItemizedOrder(input: ItemizedOrderInput): Promise<string | null>`. Task 3 injects this as `deps.createOrder` in both services.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/int/square-order.int.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const ordersCreate = vi.fn()
vi.mock('../../src/lib/square', () => ({
  getSquareClient: () => ({ orders: { create: ordersCreate } }),
  SQUARE_LOCATION_ID: () => 'LOC123',
}))

import { createItemizedOrder } from '../../src/lib/square-order'

function squareOrderResponse(totalCents: number, id = 'order_abc') {
  return { order: { id, totalMoney: { amount: BigInt(totalCents), currency: 'USD' } } }
}

const baseInput = {
  itemName: 'Class: Wheel Throwing',
  subtotalCents: 5000,
  discountCents: 0,
  taxRatePercent: 8.9,
  expectedTotalCents: 5445,
  referenceId: 'booking-42',
}

describe('createItemizedOrder', () => {
  beforeEach(() => { ordersCreate.mockReset() })

  it('builds a line item + order-scope tax and returns the id on an exact total match', async () => {
    ordersCreate.mockResolvedValue(squareOrderResponse(5445))
    const id = await createItemizedOrder(baseInput)
    expect(id).toBe('order_abc')
    const body = ordersCreate.mock.calls[0][0]
    expect(body.order.locationId).toBe('LOC123')
    expect(body.order.referenceId).toBe('booking-42')
    expect(body.order.lineItems).toEqual([
      { name: 'Class: Wheel Throwing', quantity: '1', basePriceMoney: { amount: 5000n, currency: 'USD' } },
    ])
    expect(body.order.taxes).toEqual([
      { name: 'WA sales tax', type: 'ADDITIVE', percentage: '8.9', scope: 'ORDER' },
    ])
    expect(body.order.discounts).toBeUndefined()
    expect(body.idempotencyKey).toEqual(expect.any(String))
  })

  it('adds a fixed-amount order-scope discount when a coupon applied', async () => {
    ordersCreate.mockResolvedValue(squareOrderResponse(4356))
    const id = await createItemizedOrder({
      ...baseInput, discountCents: 1000, discountName: 'Coupon SUMMER10', expectedTotalCents: 4356,
    })
    expect(id).toBe('order_abc')
    expect(ordersCreate.mock.calls[0][0].order.discounts).toEqual([
      { name: 'Coupon SUMMER10', type: 'FIXED_AMOUNT', amountMoney: { amount: 1000n, currency: 'USD' }, scope: 'ORDER' },
    ])
  })

  it('omits the tax line when the rate is 0', async () => {
    ordersCreate.mockResolvedValue(squareOrderResponse(5000))
    const id = await createItemizedOrder({ ...baseInput, taxRatePercent: 0, expectedTotalCents: 5000 })
    expect(id).toBe('order_abc')
    expect(ordersCreate.mock.calls[0][0].order.taxes).toBeUndefined()
  })

  it('omits the tax line when the discount consumes the whole subtotal-adjacent taxable', async () => {
    // taxable 0 (100%-ish coupon but a positive total can't happen; this guards the boundary)
    ordersCreate.mockResolvedValue(squareOrderResponse(0))
    await createItemizedOrder({ ...baseInput, discountCents: 5000, discountName: 'Coupon ALL', expectedTotalCents: 0 })
    expect(ordersCreate.mock.calls[0][0].order.taxes).toBeUndefined()
  })

  it('returns null and logs when Square total mismatches ours', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    ordersCreate.mockResolvedValue(squareOrderResponse(5446))
    const id = await createItemizedOrder(baseInput)
    expect(id).toBeNull()
    expect(err).toHaveBeenCalledWith(expect.stringContaining('SQUARE ORDER TOTAL MISMATCH'))
    err.mockRestore()
  })

  it('returns null and logs when the Orders API throws', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    ordersCreate.mockRejectedValue(new Error('boom'))
    const id = await createItemizedOrder(baseInput)
    expect(id).toBeNull()
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })

  it('returns null when the response carries no order id', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    ordersCreate.mockResolvedValue({ order: undefined })
    expect(await createItemizedOrder(baseInput)).toBeNull()
    err.mockRestore()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run test:int tests/int/square-order.int.spec.ts`
Expected: FAIL — cannot resolve `../../src/lib/square-order`.

- [ ] **Step 3: Implement `src/lib/square-order.ts`**

```ts
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
        `SQUARE ORDER TOTAL MISMATCH (${input.referenceId}): square=${squareTotal} expected=${input.expectedTotalCents} — charging unitemized`,
      )
      return null
    }
    return order.id
  } catch (e) {
    console.error(`Square order creation failed (${input.referenceId}) — charging unitemized:`, e)
    return null
  }
}
```

If the SDK's types reject any field name, check `node_modules/square/api/resources/orders` for the v44 request shape rather than guessing.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm run test:int tests/int/square-order.int.spec.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/square-order.ts tests/int/square-order.int.spec.ts
git commit -m "feat(payments): createItemizedOrder builds Square orders with tax lines"
```

---

### Task 3: Wire orders into the charge path (services, routes, `chargeCard`)

**Files:**
- Modify: `src/lib/payments.ts` (ChargeInput + create call)
- Modify: `src/services/booking.ts` (deps + charge block, ~lines 12–16 and 99–110)
- Modify: `src/services/firing.ts` (deps + charge block, ~lines 12–16 and 96–107)
- Modify: `src/app/api/bookings/route.ts`, `src/app/api/firings/route.ts` (inject the real implementation)
- Test: extend `tests/int/booking-service.int.spec.ts`, `tests/int/booking-coupon.int.spec.ts`, `tests/int/firing-paid.int.spec.ts`

**Interfaces:**
- Consumes: `createItemizedOrder` / `ItemizedOrderInput` from Task 2; existing `ChargeInput`/`ChargeResult` from `src/lib/payments.ts`.
- Produces: `BookingDeps` and `FiringDeps` each gain a required `createOrder: (input: ItemizedOrderInput) => Promise<string | null>`; `ChargeInput` gains `orderId?: string`.

- [ ] **Step 1: Add `orderId` to `ChargeInput` and pass it through**

In `src/lib/payments.ts`: add `orderId?: string` to `ChargeInput` (after `note?`), and inside `client.payments.create({ ... })` add `orderId: input.orderId,` after `note: input.note,`. (Square requires the payment amount to equal the order total; the order was built from the same `totals`, and a mismatch already returned `null` upstream.)

- [ ] **Step 2: Extend the failing service tests — booking**

In `tests/int/booking-service.int.spec.ts`, add `createOrder` to the `deps` helper:

```ts
function deps(overrides = {}) {
  return {
    charge: vi.fn(async () => ({ paymentId: 'pay_123', status: 'COMPLETED' })),
    sendEmail: vi.fn(async () => {}),
    createOrder: vi.fn(async () => 'order_test_1'),
    ...overrides,
  }
}
```

Add these tests inside the existing `describe` (rate is pinned to 0 in this file, so `taxRatePercent: 0` is expected):

```ts
it('itemizes the charge with a Square order and passes the orderId to charge', async () => {
  const payload = await getTestPayload()
  const inst = await makeInstance(payload, 5)
  const d = deps()
  await createPaidBooking({ payload, ...d }, {
    classInstanceId: inst.id, sourceId: 'cnon:fake', customerName: 'Jo', customerEmail: 'jo@test.local',
  })
  expect(d.createOrder).toHaveBeenCalledWith(expect.objectContaining({
    itemName: expect.stringMatching(/^Class: /), subtotalCents: 22000, discountCents: 0,
    taxRatePercent: 0, expectedTotalCents: 22000, referenceId: expect.stringMatching(/^booking-\d+$/),
  }))
  expect(d.charge).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'order_test_1' }))
})

it('still charges (unitemized) when order creation returns null', async () => {
  const payload = await getTestPayload()
  const inst = await makeInstance(payload, 5)
  const d = deps({ createOrder: vi.fn(async () => null) })
  const booking = await createPaidBooking({ payload, ...d }, {
    classInstanceId: inst.id, sourceId: 'cnon:fake', customerName: 'Jo', customerEmail: 'jo2@test.local',
  })
  expect(booking.status).toBe('paid')
  const chargeArg: any = (d.charge as any).mock.calls[0][0]
  expect(chargeArg.orderId).toBeUndefined()
})
```

In `tests/int/booking-coupon.int.spec.ts`, add `createOrder: vi.fn(async () => 'order_test_1')` to that file's deps construction the same way, and add:

```ts
it('describes the coupon on the Square order and skips the order for $0 totals', async () => {
  const payload = await getTestPayload()
  // Partial coupon: order carries the discount line.
  const inst = await makeInstance(payload, 5)
  const coupon = await mkFixedCoupon(payload, 1000)
  const d = deps()
  await createPaidBooking({ payload, ...d }, {
    classInstanceId: inst.id, sourceId: 'cnon:fake', couponCode: coupon.code,
    customerName: 'Jo', customerEmail: 'co1@test.local',
  })
  expect(d.createOrder).toHaveBeenCalledWith(expect.objectContaining({
    discountCents: 1000, discountName: `Coupon ${coupon.code}`,
  }))

  // 100% coupon → $0 total → no charge and no order.
  const inst2 = await makeInstance(payload, 5)
  const full = await mkFixedCoupon(payload, 22000)
  const d2 = deps()
  await createPaidBooking({ payload, ...d2 }, {
    classInstanceId: inst2.id, couponCode: full.code, customerName: 'Jo', customerEmail: 'co2@test.local',
  })
  expect(d2.charge).not.toHaveBeenCalled()
  expect(d2.createOrder).not.toHaveBeenCalled()
})
```

Match that file's actual helper names — it has its own instance/coupon factories; reuse them rather than importing these names blindly (`mkFixedCoupon`/`makeInstance` here show intent; adapt to the file's existing helpers and default price).

- [ ] **Step 3: Extend the failing service tests — firing**

In `tests/int/firing-paid.int.spec.ts`, add `createOrder: vi.fn(async () => 'order_test_1')` to its deps helper and add:

```ts
it('itemizes the firing charge with a Square order', async () => {
  const payload = await getTestPayload()
  const d = deps()
  await createPaidFiring({ payload, ...d }, validFiringInput())  // adapt to the file's input factory
  expect(d.createOrder).toHaveBeenCalledWith(expect.objectContaining({
    itemName: expect.stringMatching(/^Firing: /),
    expectedTotalCents: expect.any(Number),
    referenceId: expect.stringMatching(/^firing-\d+$/),
  }))
  expect(d.charge).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'order_test_1' }))
})
```

(Adapt the input construction to that file's existing valid-input helper; do not invent new fixtures.)

- [ ] **Step 4: Run the extended tests to verify they fail**

Run: `pnpm run test:int tests/int/booking-service.int.spec.ts tests/int/booking-coupon.int.spec.ts tests/int/firing-paid.int.spec.ts`
Expected: FAIL — TypeScript errors on the new `createOrder` deps member / `createOrder` never called.

- [ ] **Step 5: Wire the services**

`src/services/booking.ts`:

1. Import the type: `import type { ItemizedOrderInput } from '../lib/square-order'`
2. `BookingDeps` gains `createOrder: (input: ItemizedOrderInput) => Promise<string | null>`
3. Hoist the rate (replacing the inline `getSalesTaxPercent` call):

```ts
const taxRatePercent = await getSalesTaxPercent(payload)
const totals = computeTotals({ subtotalCents: priceCents, discountCents, taxRatePercent })
```

4. Replace the charge block (current lines 99–110) with:

```ts
let charge: ChargeResult | null = null
if (totals.totalCents > 0) {
  // Best-effort itemization: a null orderId (API error or Square total
  // mismatch) falls back to today's unitemized charge — the customer is
  // always charged exactly totals.totalCents.
  const orderId = await deps.createOrder({
    itemName: `Class: ${cls.title}`,
    subtotalCents: priceCents,
    discountCents,
    discountName: couponId != null ? `Coupon ${input.couponCode!.trim().toUpperCase()}` : undefined,
    taxRatePercent,
    expectedTotalCents: totals.totalCents,
    referenceId: `booking-${pending.id}`,
  })
  try {
    charge = await deps.charge({
      sourceId: input.sourceId!, amountCents: totals.totalCents,
      referenceId: `booking-${pending.id}`, note: `Class: ${cls.title}`,
      ...(orderId ? { orderId } : {}),
    })
  } catch (e) {
    await payload.update({ collection: 'bookings', id: pending.id, overrideAccess: true, data: { status: 'cancelled' } })
    throw e
  }
}
```

`src/services/firing.ts`: the same four changes — import, `FiringDeps.createOrder`, hoist `taxRatePercent`, and the charge block (current lines 96–107) becomes:

```ts
let charge: ChargeResult | null = null
if (totals.totalCents > 0) {
  // Best-effort itemization: a null orderId (API error or Square total
  // mismatch) falls back to today's unitemized charge — the customer is
  // always charged exactly totals.totalCents.
  const orderId = await deps.createOrder({
    itemName: `Firing: ${input.halfShelves} half shelf(s)`,
    subtotalCents: priceCents,
    discountCents,
    discountName: couponId != null ? `Coupon ${input.couponCode!.trim().toUpperCase()}` : undefined,
    taxRatePercent,
    expectedTotalCents: totals.totalCents,
    referenceId: `firing-${pending.id}`,
  })
  try {
    charge = await deps.charge({
      sourceId: input.sourceId!, amountCents: totals.totalCents,
      referenceId: `firing-${pending.id}`, note: `Firing: ${input.halfShelves} half shelf(s)`,
      ...(orderId ? { orderId } : {}),
    })
  } catch (e) {
    await payload.update({ collection: 'firing-requests', id: pending.id, overrideAccess: true, data: { status: 'cancelled' } })
    throw e
  }
}
```

- [ ] **Step 6: Wire the routes**

In `src/app/api/bookings/route.ts` and `src/app/api/firings/route.ts`: add `import { createItemizedOrder } from '../../../lib/square-order'` and extend the deps object `{ payload, charge: chargeCard, sendEmail }` → `{ payload, charge: chargeCard, createOrder: createItemizedOrder, sendEmail }`.

Check `tests/int/firing-route.int.spec.ts` — it mocks the service module wholesale, so it should compile untouched; fix its mocks only if TypeScript complains about the new deps member.

- [ ] **Step 7: Run the touched test files**

Run: `pnpm run test:int tests/int/square-order.int.spec.ts tests/int/booking-service.int.spec.ts tests/int/booking-coupon.int.spec.ts tests/int/firing-paid.int.spec.ts tests/int/firing-route.int.spec.ts tests/int/tax.int.spec.ts`
Expected: PASS. Then `pnpm exec tsc --noEmit` → clean.

(The full int suite is long — the controller runs it after review rather than the implementer waiting on it.)

- [ ] **Step 8: Commit**

```bash
git add src/lib/payments.ts src/services/booking.ts src/services/firing.ts src/app/api/bookings/route.ts src/app/api/firings/route.ts tests/int/booking-service.int.spec.ts tests/int/booking-coupon.int.spec.ts tests/int/firing-paid.int.spec.ts
git commit -m "feat(payments): attach itemized Square orders to booking and firing charges"
```

---

## Rollout (controller/user work after the tasks — not implementer steps)

1. Controller: run the full int suite (`pnpm run test:int`) on a fresh `portside_test`.
2. Deploy to the dev droplet (sandbox). Manual verification: one booking with a coupon and one firing without, real sandbox card token; confirm in the Square **sandbox** dashboard that the transaction shows item/discount/tax lines, Reports → Sales taxes shows the collected tax, and the paid order isn't lingering OPEN.
3. Prod deploy only on Brian's explicit go (no migration). Accountant then reads Reports → Sales taxes from that deploy forward.

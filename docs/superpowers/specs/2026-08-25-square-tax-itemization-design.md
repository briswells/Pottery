# Square Tax Itemization (Orders API) — Design

**Date:** 2026-08-25
**Status:** Approved
**Problem:** Checkout charges reach Square as a single lump-sum payment, so the
accountant cannot see collected WA sales tax anywhere in Square. Square's
Sales-tax report is empty even though the site has been collecting 8.9% since
2026-08-18.

## Goal

Every card/wallet charge for a class booking or firing request is attached to
a Square **Order** that itemizes the sale — line item at the pre-tax price,
coupon as a discount, and sales tax as a percentage tax. Square then shows,
with no manual work:

- **Reports → Sales taxes:** aggregated collected tax per period (the filing
  number)
- **Per transaction:** item name, discount, and tax lines

Forward-only: payments already taken stay lump sums (explicitly accepted).
Memberships remain Square-invoice-side (tax applied in the dashboard by
Brian; no site code).

## Decisions (settled during brainstorming)

- **Mechanism:** Orders API with ad-hoc (non-catalog) line items, discounts,
  and taxes. No Square catalog objects are created — writes are limited to
  orders attached to normal customer charges, which is authorized normal site
  operation. Tested on the dev droplet (sandbox account) before any prod
  deploy.
- **The displayed total is the charged total, always.** Square computes order
  tax from the percentage itself and requires the payment to exactly match
  the order's `total_money`. If Square's computed total ever differs from our
  `computeTotals` total, we do NOT charge Square's number — we log loudly and
  fall back to today's lump-sum payment (correct charge, that one transaction
  unitemized in Square).
- **Rounding alignment is an implementation gate:** a sandbox sweep pins
  Square's US cent-rounding at 8.9%; if it differs from `Math.round`
  half-up, `computeTotals` is changed to match Square (it is the single
  shared display/charge function, so display and charge move together). The
  fallback is a safety net, not a steady state — after the sweep it should
  never fire.
- **$0 totals (100% coupons) create no order** — there is no payment to
  attach it to, and an unpaid OPEN order would linger in Square.
- **Order creation failure never blocks checkout.** Itemization is
  best-effort; the charge is the critical path. Any Orders API error → log,
  charge lump-sum as today.

## Architecture

```
services/booking.ts ─┐   totals (computeTotals, unchanged)
services/firing.ts  ─┤        │
                     ▼        ▼
        lib/square-order.ts: createItemizedOrder(...)  ──▶ Square POST /v2/orders
                     │ returns orderId when Square total === ours, else null
                     ▼
        lib/payments.ts: chargeCard({ ..., orderId? })  ──▶ payments.create
```

### 1. `src/lib/square-order.ts` (new)

```ts
export interface ItemizedOrderInput {
  itemName: string        // 'Class: Wheel Throwing' | 'Firing: 3 half shelf(s)'
  subtotalCents: number   // pre-discount, pre-tax
  discountCents: number   // 0 when no coupon
  discountName?: string   // 'Coupon SUMMER10' — required when discountCents > 0
  taxRatePercent: number  // from Site Settings; 0 → no tax line
  expectedTotalCents: number  // totals.totalCents from computeTotals
  referenceId: string     // 'booking-<id>' | 'firing-<id>'
}

/**
 * Creates a Square order itemizing the sale. Returns the order id when
 * Square's computed total exactly equals expectedTotalCents; returns null
 * (after logging) on any mismatch or API error so the caller falls back to
 * an unitemized charge. Never throws.
 */
export async function createItemizedOrder(input: ItemizedOrderInput): Promise<string | null>
```

Order body it builds:

- `location_id`: `SQUARE_LOCATION_ID()`; `reference_id`: `input.referenceId`;
  idempotency key `randomUUID()`
- `line_items`: one ad-hoc item — `name: itemName`, `quantity: '1'`,
  `base_price_money: { amount: subtotalCents, currency: 'USD' }`
- `discounts` (only when `discountCents > 0`): one ad-hoc
  `{ name: discountName, type: 'FIXED_AMOUNT', amount_money: discountCents, scope: 'ORDER' }`
- `taxes` (only when `taxRatePercent > 0` and taxable > 0): one ad-hoc
  `{ name: 'WA sales tax', type: 'ADDITIVE', percentage: String(taxRatePercent), scope: 'ORDER' }`

After creation, compare `order.totalMoney.amount` to `expectedTotalCents`:

- equal → return `order.id`
- unequal → `console.error('SQUARE ORDER TOTAL MISMATCH …', { squareTotal, expectedTotalCents, referenceId })`
  and return `null`. (The order is left unpaid/OPEN; Square garbage-collects
  or it sits harmless — no cancellation call, keep the failure path dumb.)
- thrown API error → `console.error` with detail, return `null`

### 2. `src/lib/payments.ts`

`ChargeInput` gains `orderId?: string`; `chargeCard` passes it through to
`payments.create` when present. Nothing else changes — decline mapping,
idempotency, `friendlyChargeError` untouched.

### 3. Services (`booking.ts`, `firing.ts`)

In the existing `totals.totalCents > 0` block, immediately before the charge:

```ts
const orderId = await createItemizedOrder({
  itemName: `Class: ${cls.title}`,          // firing: `Firing: ${n} half shelf(s)`
  subtotalCents: priceCents,
  discountCents,
  discountName: coupon ? `Coupon ${coupon.code}` : undefined,
  taxRatePercent,                            // already fetched for computeTotals
  expectedTotalCents: totals.totalCents,
  referenceId: `booking-${pending.id}`,
})
charge = await deps.charge({ …existing…, orderId: orderId ?? undefined })
```

`taxRatePercent` is currently fetched inline into the `computeTotals` call —
hoist it to a local so both calls share it. Everything downstream
(persistence, emails, expected-total guard) is untouched: the guard already
ran before this point, and the amount charged is still `totals.totalCents`.

For DI/testability, `createItemizedOrder` enters the services the same way
`charge` does — a `deps` member (`createOrder`) defaulting to the real
implementation at the route level, so existing service tests stub it.

### 4. Explicitly unchanged

- `computeTotals` display/guard flow, coupon semantics, $0-coupon flow
- Refunds (refund the payment id, as today — Square reconciles the order)
- Wallet buttons (Apple/Google Pay tokens flow through the same `chargeCard`)
- Memberships, gift/imported bookings, historical payments

## Error handling

| Failure | Behavior |
|---|---|
| Orders API error / timeout | log, `orderId = null`, lump-sum charge (today's behavior) |
| Square total ≠ our total | log CRITICAL-tagged mismatch with both numbers, lump-sum charge |
| Charge itself fails | unchanged (pending doc cancelled, friendly error) |

The customer can never be blocked or mischarged by itemization; the worst
outcome is one unitemized transaction plus a loud log line.

## Testing

- **Unit (`tests/int/square-order.int.spec.ts`, mocked Square client):**
  order body shape — no discount / with discount / rate 0 omits tax line;
  matching total returns id; mismatched total returns null and logs; thrown
  API error returns null; discount + tax + coupon-name propagation.
- **Service specs (extend existing booking/firing int tests):** charge
  receives the orderId from a stubbed `createOrder`; `createOrder` returning
  null still charges (fallback); $0-total path never calls `createOrder`;
  `createOrder` receives subtotal/discount/rate matching the coupon case.
- **Sandbox rounding sweep (implementation gate, dev droplet or local
  sandbox creds):** script creates orders at 8.9% across subtotals chosen to
  exercise fractional-cent boundaries (e.g. every cent from $10.00–$11.00
  plus known half-cent cases) and diffs Square's `total_tax_money` against
  `computeTotals`. Any divergence → change `computeTotals` rounding to match
  Square before shipping, and re-run the existing tax test table.
- **Manual on dev (sandbox):** booking with coupon + firing without; verify
  in Square sandbox dashboard that the transaction shows item/discount/tax
  lines, the Sales-tax report shows the collected tax, and the paid order
  does not linger OPEN.

## Rollout

1. Dev droplet: deploy, run the manual sandbox checks above.
2. Prod on Brian's explicit go: deploy (no migration — no schema change).
   From that deploy forward, every checkout appears itemized in Square and
   the accountant reads Reports → Sales taxes.
3. Brian separately (unchanged from tax launch): apply tax to membership
   invoices in the Square dashboard; accountant handles the Aug 18–deploy
   lump-sum week manually (explicitly accepted).

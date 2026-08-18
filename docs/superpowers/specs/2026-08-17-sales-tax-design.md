# Washington Sales Tax on Checkout — Design

**Date:** 2026-08-17
**Status:** Approved
**Urgency:** production charge-amount fix — the studio is currently absorbing uncollected tax.

## Goal

Collect Washington sales tax on the two site checkouts — class bookings and
custom firings — at an admin-editable rate (launching at **8.9%**, the
Vancouver WA combined rate after Clark County's April 2026 increase). Payment
forms itemize the tax before the customer pays; coupons reduce the taxable
amount; collected tax is stored per transaction for DOR filing.

## Decisions (settled during brainstorming)

- **Scope:** class bookings + firing requests. Memberships are billed as
  Square recurring invoices — tax there is a Square-dashboard setting (steps
  in Appendix A); no site code.
- **Rate:** `salesTaxPercent` number field on Site Settings, launch value
  8.9. Rate changes apply to new checkouts immediately, no deploy.
- **Coupons reduce the taxable price** (WA DOR treatment of seller-funded
  discounts): `taxable = subtotal − discount`, `tax = round(taxable × rate)`.
- **Tax is added on top** (not tax-inclusive pricing): displayed subtotal is
  the advertised price; total = taxable + tax.
- **Rounding:** half-up to the nearest cent, once, on the transaction total
  (not per unit).
- **`amountCents` keeps meaning "total actually charged"** (now
  tax-inclusive) on bookings, firing requests, and payments; a new
  `taxCents` field on all three records the collected tax for reporting.
- **One shared pure function computes totals on both server and client**, so
  the displayed number and the charged number cannot drift.

## Architecture

```
SiteSettings.salesTaxPercent ──▶ page (server) ──▶ form prop taxRatePercent
                                                        │
src/lib/tax.ts: computeTotals({subtotal, discount, rate}) — pure, shared
   ├─ client: BookingForm / FiringRequestForm breakdown display
   └─ server: booking.ts / firing.ts — charge totalCents, store taxCents
```

### 1. `src/lib/tax.ts` (new, pure)

```ts
export interface TotalsInput {
  subtotalCents: number
  discountCents: number      // 0 when no coupon
  taxRatePercent: number     // e.g. 8.9; 0 disables tax
}
export interface Totals {
  taxableCents: number       // max(0, subtotal − discount)
  taxCents: number           // round-half-up(taxable × rate/100)
  totalCents: number         // taxable + tax
}
export function computeTotals(input: TotalsInput): Totals
```

Integer-cent math: `taxCents = Math.round((taxableCents * taxRatePercent) / 100)`
(with a guard that non-finite/negative rates coerce to 0). No floating-point
dollars anywhere.

Also: `getSalesTaxPercent(payload): Promise<number>` — reads Site Settings,
`?? 0` when unset (pre-migration safety: missing rate means no tax rather
than a crash).

### 2. Site Settings — `salesTaxPercent`

Number field, `defaultValue: 8.9`, min 0, max 15, sidebar, description:
"Sales tax % applied at checkout (classes and firings). Vancouver WA
combined rate — update when the WA DOR rate changes." One generated
migration (numeric column, default 8.9).

### 3. Services

`createPaidBooking` (src/services/booking.ts) and `createPaidFiring`
(src/services/firing.ts), identically:

1. `subtotal` = instance price / shelf math (unchanged)
2. coupon check (unchanged) → `discountCents`
3. `const totals = computeTotals({ subtotalCents, discountCents, taxRatePercent: await getSalesTaxPercent(payload) })`
4. charge `totals.totalCents` (was: taxable only); skip charge when 0
   (unchanged behavior for 100% coupons)
5. persist `amountCents: totals.totalCents`, `taxCents: totals.taxCents`
   (+ existing `discountCents`) on the booking / firing request, and
   `taxCents` on the payment record

New fields (schema, same migration as §2): `taxCents` (number, admin
read-only, default 0) on `bookings`, `firing-requests`, `payments`.
`payments` admin list gains a Tax column (`defaultColumns`) for filing.
Historical rows: `taxCents` 0/null — correct (no tax was collected).

### 4. Coupon validate endpoint — `/api/coupons/validate`

Response gains nothing tax-related — it keeps returning
`{ code, discountCents, finalCents }` where `finalCents` remains the
post-discount, PRE-tax amount. The client recomputes the full breakdown
locally with `computeTotals` (rate is already in its props). This keeps the
coupon service tax-agnostic. (`finalCents` is renamed nowhere; its meaning
"taxable amount" is documented at the call sites.)

### 5. Payment forms

`BookingForm.tsx` and `FiringRequestForm.tsx`:

- New prop `taxRatePercent: number` passed from their server pages (which
  read Site Settings — both pages already run server-side).
- Price area becomes a small stacked breakdown (only rows that apply):

  | | |
  |---|---|
  | Subtotal | $50.00 |
  | Coupon SUMMER10 | −$10.00 |
  | Sales tax (8.9%) | $3.56 |
  | **Total** | **$43.56** |

- The pay button label uses the total ("Book & pay $43.56").
- Wallet buttons receive `totals.totalCents`.
- When `taxRatePercent` is 0 the tax row hides and behavior is exactly
  pre-change (also the graceful state if settings are unset).

### 6. Receipts / notification emails

The `amountLine` in booking and firing emails itemizes:
"$50.00 − $10.00 coupon + $3.56 tax = **$43.56 charged**" (wording per
implementation; must include the tax amount whenever tax > 0).

### 7. Explicitly unchanged

- Coupon semantics (validation, redemption counting, $0-total flow)
- Refunds (refund the charged total, as today)
- Memberships (Appendix A), gift/imported bookings (amountCents as-is)
- Advertised prices on class/firing pages stay pre-tax

## Error handling

- Missing/invalid `salesTaxPercent` → rate 0 (no tax) — never a crash, never
  a wrong charge; the launch migration sets 8.9 so this is transitional only.
- `computeTotals` clamps negative taxable to 0 (over-100% coupons).
- Client/server disagreement is structurally impossible (same function, same
  integer inputs); the server remains authoritative for the actual charge.

## Testing

- `tests/int/tax.int.spec.ts`: rounding table ($25.00 @ 8.9% → $2.23 tax;
  $0.01 @ 8.9% → $0.00; half-cent boundary $50 @ 8.9% = $4.45 exactly;
  rate 0 → all-zero; discount ≥ subtotal → 0/0/0; negative rate → 0).
- Booking + firing service specs (extend existing): charged amount =
  subtotal − discount + tax; `taxCents` persisted on the doc and payment;
  coupon-then-tax ordering ($50 sub, $10 coupon, 8.9% → tax $3.56 charged
  $43.56); rate 0 → identical to pre-change behavior.
- Manual on dev with the sandbox card: booking with and without coupon —
  form breakdown matches the charge to the cent (verify in Square sandbox
  dashboard); firing likewise; Apple Pay sheet shows the tax-inclusive total.

## Rollout (urgent path)

1. Dev droplet: deploy + migration; verify amounts end-to-end with sandbox
   cards.
2. Prod same session on Brian's go: deploy + migration (sets 8.9%). From
   that moment checkouts collect tax.
3. Brian separately: Square dashboard tax setting for membership invoices
   (Appendix A), and accountant follow-up on any back-tax remittance for
   past untaxed sales (out of scope for the site).

## Appendix A — memberships (Square dashboard, no code)

Square → Account & Settings → Business → Sales taxes → create "WA sales tax
8.9%" → then on the recurring invoice series/templates for memberships,
apply the tax. New invoices bill with tax; existing scheduled invoices may
need editing per Square's UI. (Read-only rule note: Brian performs these
Square-side changes in the dashboard.)

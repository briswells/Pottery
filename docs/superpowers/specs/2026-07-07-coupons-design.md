# Coupon Codes — Design Spec

**Date:** 2026-07-07
**Status:** Approved (design), pending implementation plan

## Goal

Admins create coupon codes in the Payload admin; customers enter a code at class
checkout and pay a discounted amount. Codes are fixed-amount or percentage, apply
to all classes or one specific class, and support expiry, redemption caps, a
per-customer limit, and an on/off toggle. A coupon that brings the total to $0
books the seat free with no card entry.

## Non-goals (YAGNI)

- No coupons on memberships or firing invoices (class bookings are the only
  self-serve checkout).
- No stacking — one code per booking.
- No separate redemptions collection: redemption usage is derived by counting
  bookings that reference the coupon (same derive-don't-store pattern as seat
  occupancy).
- No customer-visible coupon listing; codes are distributed out-of-band.

## Data model

### New collection: `coupons` (admin group "Studio")
- `code` — text, required, **unique, stored uppercase** (normalize on save via a
  beforeValidate hook; checkout lookup uppercases input). Friendly duplicate
  message via the existing `uniqueNameValidate` pattern (adapted for `code`).
- `discountType` — select, required: `percent` | `fixed`.
- Two amount fields instead of one polymorphic number (avoids unit ambiguity in
  a single column):
  - `percentOff` — number 1–100 (validated), shown only when
    `discountType = percent`.
  - `amountOffCents` — number stored in cents, using the same admin
    PriceField/PriceCell components as firing requests, shown only when
    `discountType = fixed`.
- `appliesTo` — select, required, default `all`: `all` | `class`.
- `class` — relationship → `classes` (the class template, so it covers every
  session/instance of that class), required+shown only when `appliesTo = class`.
- `active` — checkbox, default true.
- `expiresAt` — date, optional. Expired = `now > expiresAt`.
- `maxRedemptions` — number, optional (empty = unlimited).
- `onePerCustomer` — checkbox, default false. Keyed by customer email
  (case-insensitive).
- Access: read/create/update `isAdminOrEditor`, delete `isAdmin`.
- `defaultColumns`: code, discountType, appliesTo, active, expiresAt.

### Changes to `bookings`
- `coupon` — relationship → `coupons`, optional.
- `discountCents` — number, optional; the discount actually applied.
- `amountCents` semantics unchanged: the amount actually charged (now
  post-discount). Original price is recoverable as `amountCents + discountCents`.

## Behavior

### Validation service (`src/services/coupons.ts`)
- `computeDiscount(coupon, priceCents) → { discountCents, finalCents }` — pure
  function. Percent rounds to whole cents (`Math.round`); fixed clamps at
  `priceCents` (never negative). Exported and unit-tested.
- `validateCoupon({ payload }, { code, classInstanceId, customerEmail }) →
  { ok: true, coupon, discountCents, finalCents } | { ok: false, reason }`
  with specific human-readable reasons:
  - not found → "That code isn't valid."
  - inactive → "That code is no longer active."
  - expired → "That code has expired."
  - wrong class (`appliesTo = class` and the instance's class ≠ coupon.class) →
    "That code isn't valid for this class."
  - fully redeemed (count of `paid`/`pending` bookings with this coupon ≥
    `maxRedemptions`) → "That code has been fully redeemed."
  - per-customer repeat (`onePerCustomer` and a `paid`/`pending` booking with
    this coupon + same email, case-insensitive) → "That code has already been
    used with this email."
- Counting `pending` prevents double-spending a final redemption slot during a
  concurrent checkout; a cancelled pending booking releases it (same lifecycle
  as seats).

### Preview endpoint: `POST /api/coupons/validate`
- Body: `{ code, classInstanceId, email? }`. Public, unauthenticated.
- Returns the validation result (discounted total or reason) so the form can
  show "$220 → $154 (SUMMER30)" before payment. Cosmetic only — never trusted
  by the charge path.

### Charge path (`createPaidBooking`)
- `BookingInput` gains optional `couponCode`.
- After loading the instance and before creating the pending booking:
  re-run `validateCoupon` (authoritative). Invalid → throw with the same
  human-readable reason (surfaces in the form's error display).
- Pending booking is created with `coupon`, `discountCents`, and
  `amountCents = finalCents` — so the pending row itself occupies a redemption
  slot, closing the validate-then-charge race for `maxRedemptions`.
- **$0 total:** skip `deps.charge` entirely. Booking goes straight to `paid`
  with no `squarePaymentId`; the payments row records `amountCents: 0`,
  `squareId` null, `status: 'COMPLETED'`. (Confirm the payments collection
  allows a null squareId; adjust if required.)
- Confirmation email shows the discount: "Amount paid: $154.00 (SUMMER30
  applied)" / "Free with code SUMMER30".

### Booking form UI (`BookingForm.tsx`)
- "Coupon code" text input + Apply button above the card field. Apply calls the
  preview endpoint with the email field's current value; shows the new total or
  the rejection reason inline.
- When the previewed total is $0, hide/skip the Square card field and change the
  button to "Book free"; submit posts the coupon code with no `sourceId`.
- The booking POST includes `couponCode`; server re-validates regardless of what
  the preview showed. `sourceId` becomes optional in the API route only when the
  server-computed total is $0 (server decides, not the client).

## Edge cases
- Fixed discount > price → clamps to price (free, not negative).
- Code entered with different casing/whitespace → trimmed + uppercased before
  lookup.
- Coupon deleted after bookings used it → booking's `coupon` relationship nulls
  (FK set-null); `discountCents` remains for history.
- Two concurrent checkouts racing the last redemption slot → the pending-booking
  count makes the second validation fail at charge time.
- Email omitted at preview time for a `onePerCustomer` code → preview passes,
  charge-time check (which always has the email) is authoritative.

## Migration
One Drizzle migration (prod runs push-off): create `coupons` table (+ enums for
discountType/appliesTo), add `bookings.coupon_id` FK (set null) and
`bookings.discount_cents`. Generated via the throwaway dev-DB workflow.

## Testing (integration, `tests/int/`)
- `computeDiscount`: percent rounding, fixed clamp, 100%.
- Each rejection reason (not found, inactive, expired, wrong class, fully
  redeemed, per-customer repeat).
- `createPaidBooking` with a valid percent code: charged amount, booking fields,
  payments row.
- Free booking: no charge call (mock asserts uncalled), booking paid, $0 payment.
- maxRedemptions race: a pending booking consumes the slot.
- Case-insensitive code entry.

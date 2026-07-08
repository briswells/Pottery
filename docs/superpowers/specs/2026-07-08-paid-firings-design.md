# Pay-Up-Front Firings — Design Spec

**Date:** 2026-07-08
**Status:** Approved (design), pending implementation plan

## Goal

Replace the staff-quoted firing-invoice flow with self-serve, pay-up-front firing
requests: the customer picks a number of **half shelves** (11″×22″×6″) at
**$25 each**, uploads up to **5 photos** + details, confirms **stoneware only**,
and pays immediately (card/wallet, same Square flow as class bookings). Firings
happen at least the **last Friday of every month**; the page shows the computed
next date. Coupons work on firings.

## Non-goals (YAGNI)

- No staff quoting / Square invoices — that machinery is REMOVED (hook, service,
  gateway, webhook branch, admin quote field). No real firing data exists in prod.
- No automatic refund handling for firings (staff refund in the Square dashboard
  and set status `refunded` manually).
- No custom dimensions — the half shelf is the unit.

## Constants

- `FIRING_HALF_SHELF_CENTS = 2500` ($25); half shelf = 11″×22″×6″ (copy only).
- `MAX_HALF_SHELVES = 8`, min 1.
- `MAX_FIRING_PHOTOS = 5`, min 1 (photos required).
- Next firing date = last Friday of the current month; if already past
  (date-only, server TZ), last Friday of the next month.

## Data model

### `firing-requests` (rebuilt)
- Keep: `name`, `email` (required), `phone`, `description` (required), `notes`,
  `person`, `paidAt`, `completedAt` (+ its stamp hook), admin group/columns.
- Add: `halfShelves` (number, required, 1–8), `amountCents` (number, required,
  PriceField UI — the amount actually charged), `squarePaymentId` (text, index),
  `coupon` (relationship → coupons), `discountCents` (number, PriceField UI),
  `stonewareConfirmed` (checkbox, required true), `photos` (upload → media,
  `hasMany: true`, max 5).
- Replace `status` options with: `pending` (default) → `paid` → `completed`,
  plus `cancelled`, `refunded`.
- Remove: `quotedPriceCents`, `squareCustomerId`, `squareInvoiceId`,
  `squareInvoiceUrl`, `invoicedAt`, `lastInvoiceError`, `heightIn`, `widthIn`,
  `depthIn`, `quantity`, `photo` (single), and the `sendFiringInvoice` hook.
- Delete files: `src/hooks/sendFiringInvoice.ts`, `src/services/firing-invoice.ts`,
  `src/lib/firing-invoice-gateway.ts`, and the firing-invoice branch in the
  Square webhook (`invoice.*` handling that targets firing requests — membership
  invoice handling stays). Their tests are removed/replaced.
- `expire-firing-media` updates to delete ALL `photos` (array) 2 weeks after
  completion.

### Coupons — firing scope
- `appliesTo` gains option `firing` ("Firings only"). Semantics:
  `all` = class bookings AND firings; `class` = that class only (invalid for
  firings); `firing` = firings only (invalid for class bookings).
- `validateCoupon(deps, args)` signature generalizes:
  `args: { code: string; priceCents: number; customerEmail?: string; target: { kind: 'class'; classId: number } | { kind: 'firing' } }`.
  New rejection reasons (exact): class-scoped code on a firing →
  "That code isn't valid for firings." ; firing-scoped code on a class booking →
  "That code isn't valid for this class."
- Usage counting (`maxRedemptions`, `onePerCustomer`) counts `paid` + `pending`
  rows across **both** `bookings` and `firing-requests`.

## Behavior

### `createPaidFiring` service (`src/services/firing.ts`)
Mirrors `createPaidBooking`'s order and invariants exactly:
1. Validate input (halfShelves 1–8, stonewareConfirmed, ≥1 photo id).
2. `priceCents = 2500 × halfShelves`; authoritative coupon check
   (target `{kind:'firing'}`) → throw exact reason on failure.
3. `finalCents > 0` and no `sourceId` → throw 'Payment information is required'.
4. Create the `pending` firing-request (carries coupon/discount/amountCents —
   holds the redemption slot).
5. Charge via `chargeCard` (skipped when `finalCents === 0`); charge failure →
   request `cancelled`, rethrow (friendly decline messages come from chargeCard).
6. Mark `paid` (+ `squarePaymentId`, `paidAt`); payments row `type: 'firing'`
   (no `squareId` when free).
7. Link Person by email (best-effort), confirmation email (shelf count, total,
   coupon line variants exactly like bookings, next-firing-date mention), staff
   notify via `getNotifyEmail` — email failures never fail the paid request.

### API route `POST /api/firings` (rewritten)
- Multipart form: `name`, `email`, `phone?`, `description`, `notes?`,
  `halfShelves`, `stonewareConfirmed`, `couponCode?`, `sourceId?`, and 1–5
  `photos` files (each image/*, ≤10MB — same caps as today).
- Uploads photos to media first (alt "Firing request photo from <name>"), then
  calls `createPaidFiring`; on service failure deletes the just-uploaded photos
  (no orphans — same pattern as today's route).
- Coupon preview: `POST /api/coupons/validate` gains firing support — body
  `{ code, firing: true, halfShelves, email? }` (server computes priceCents) —
  alongside the existing class shape.

### Page `/firings` (unhidden, rewritten)
- Remove `FIRINGS_PAGE_HIDDEN`/notFound. Restore "Firings" nav links (desktop
  Header + MobileNav, between Membership and Gallery as before).
- Copy: stoneware only (prominent), half shelf = 11″×22″×6″ at $25,
  "Firings happen at least once a month — next firing: <computed date>".
- `nextFiringDate(now?) → Date` util in `src/lib/schedule.ts` (or new
  `src/lib/firings.ts`): last Friday of month, roll to next month when past.
  Unit-tested (month ends Friday, past-date rollover, year boundary).
- Form (`FiringRequestForm` rewritten as a client payment form): identity
  fields, half-shelf stepper (1–8) with live total, photo picker (1–5, previews
  optional), description/notes, stoneware checkbox, coupon field + Apply
  (preview), Square card + wallets (same SDK patterns as `BookingForm`,
  including the free-path rules: card kept mounted CSS-hidden, wallets get the
  discounted amount + remount key).
- The existing `firings-page` global (headline/intro/steps) stays as CMS copy
  where it fits; hard requirements (price, size, stoneware, next date) are code.

### Admin
- FiringRequests admin shows: name, halfShelves, status, amountCents, paidAt
  (default columns). `maxRedemptions` field description on coupons already
  generic — no change.

## Migration
One migration: new enum values for firing status (Postgres enum: create new
enum/`ALTER TYPE ADD VALUE` per what Payload generates), new columns
(half_shelves, amount_cents, square_payment_id, coupon_id FK set-null,
discount_cents, stoneware_confirmed), `firing_requests_rels` for photos
(hasMany upload), DROP of removed columns, coupon `applies_to` enum gains
`firing`. Dev-DB generate → verify up/down/re-up (IF EXISTS discipline in
down()). No data backfill (prod has no firing rows; dev's are disposable).

## Testing (integration)
- `nextFiringDate`: mid-month, month ending on Friday, last-Friday-today,
  after-last-Friday rollover, December→January.
- Coupon scope matrix: all/class/firing × class-target/firing-target.
- Cross-collection redemption: a paid firing consumes a maxRedemptions slot
  that then blocks a booking (and vice versa); onePerCustomer across both.
- `createPaidFiring`: paid with discount, free (no charge call, $0 payment,
  no squareId), missing sourceId, declined→cancelled rollback, photo linkage.
- Route: happy path (mock service or real with test nonce), photo-count
  bounds, orphan cleanup on failure.
- expire-firing-media: multiple photos deleted after 2 weeks completed.
- Removed-machinery check: no references to sendFiringInvoice / firing-invoice
  gateway remain; webhook suite still green.

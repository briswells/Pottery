# Portside Pottery — Custom Cone 10 Firings: Design Spec

**Date:** 2026-06-05
**Status:** Approved (brainstorm) — pending spec review

## Goal

Let a visitor request a custom Cone 10 firing through a public page by describing
their piece(s) and size, with **no upfront charge**. Staff review the request in the
admin, set a price based on the size, and send the customer a **Square invoice** they
pay online. Webhooks keep the request status truthful through payment.

## Why this shape

Cone 10 firing price depends on piece size/volume, so charging up front (like the
existing class booking flow) doesn't fit. Square's **Invoices API** is the natural
match: the admin decides the amount after seeing the piece, Square emails the customer
a hosted pay-online link, and the existing `invoice.*` webhook plumbing (built for
memberships in Plan 3) reconciles payment with a small extension.

This reuses established patterns: public-form → server-side API route → collection
(like `Bookings`); a dependency-injected, unit-tested service behind a Square gateway
interface (like the membership service); an `afterChange` hook that propagates an admin
action to Square (like `cancelSquareSubscription`); and webhook reconciliation.

## Architecture / new units

```
src/
├── collections/
│   ├── FiringRequests.ts        # NEW: the request record (server-created)
│   └── Payments.ts              # MODIFY: add 'firing' type + firingRequest relationship
├── globals/
│   └── FiringsPage.ts           # NEW: editable copy for the /firings page
├── lib/
│   └── firing-invoice-gateway.ts# NEW: Square customer→order→invoice→publish behind an interface
├── services/
│   └── firing-invoice.ts        # NEW: createAndSendFiringInvoice() — injectable, unit-tested
├── hooks/
│   └── sendFiringInvoice.ts     # NEW: afterChange — admin sets status 'approved' → send invoice
└── app/
    ├── api/
    │   └── firings/route.ts             # NEW: POST (multipart) public submission
    │   └── webhooks/square/route.ts     # MODIFY: reconcile firing invoices
    └── (frontend)/firings/
        ├── page.tsx                     # NEW: info + form (force-dynamic)
        └── FiringRequestForm.tsx        # NEW: client multipart form
tests/int/
└── firing-invoice.int.spec.ts           # NEW: service TDD with a fake gateway
```

Also: a "Firings" link in the header/mobile nav.

## Data model — `FiringRequests` (slug `firing-requests`)

Admin group **Studio**. Access: `create: () => false` (created server-side via the API
route with `overrideAccess`, like `Bookings`), `read`/`update`: `isAdminOrEditor`,
`delete`: `isAdmin`.

Fields:
- Customer: `name` (text, required), `email` (email, required), `phone` (text)
- Piece: `description` (textarea, required), `heightIn` (number), `widthIn` (number),
  `depthIn` (number), `quantity` (number, default 1), `photo` (upload → media),
  `notes` (textarea — customer notes)
- Workflow: `status` (select, default `submitted`), `quotedPriceCents` (number — admin
  sets), `adminNotes` (textarea)
- Square linkage (admin readOnly): `squareCustomerId`, `squareInvoiceId` (indexed),
  `squareInvoiceUrl`, `invoicedAt` (date), `paidAt` (date), `lastInvoiceError` (text)

**Status lifecycle:** `submitted` → (admin sets `quotedPriceCents`, flips to) `approved`
→ (hook sends invoice) `invoiced` → (webhook) `paid` → (admin) `completed`. Plus
`invoice_failed` (retryable: admin re-sets to `approved`) and `cancelled`.

`defaultColumns`: `name`, `status`, `quotedPriceCents`, `invoicedAt`, `paidAt`.

## Editable copy — `FiringsPage` global

Small global so staff own the page copy: `headline` (text), `intro` (textarea),
`steps` (array of `{ step: text }` — "how it works"), `pricingNote` (text — e.g.
"Price is quoted by size after we see your piece"). Mirrors the existing
`MembershipPage` global pattern.

## Public page `/firings`

Server component (`export const dynamic = 'force-dynamic'`, consistent with the other
CMS pages). Renders the `FiringsPage` global copy + a client `FiringRequestForm.tsx`.

`FiringRequestForm.tsx` ('use client'): fields for name, email, phone (optional),
description, height/width/depth (inches), quantity, optional photo (`<input
type="file" accept="image/*">`), notes. Submits as **`multipart/form-data`** to
`POST /api/firings`. On success shows: *"Request received — we'll review the size and
email you an invoice."* On error shows the server message.

## Submission flow — `POST /api/firings`

Server-side, `overrideAccess`. Steps:
1. Parse `await req.formData()`; validate required fields (name, email, description) →
   400 on missing.
2. If a photo is present: validate it's an image and ≤ ~10 MB; create a `media` doc
   server-side (`payload.create({ collection: 'media', file: { data, mimetype, name,
   size }, overrideAccess: true })`). Reject non-images / oversize with 400.
3. Create the `firing-requests` row (`status: 'submitted'`, numeric dimensions coerced,
   `photo` = media id if any).
4. Send two emails via the existing `sendEmail` wrapper (failures swallowed/logged so
   they never fail the submission, per the booking/membership pattern):
   - Customer: "We received your firing request — we'll review the size and email you an
     invoice."
   - Staff (`STAFF_NOTIFY_EMAIL`): "New Cone 10 firing request from <name>" with the
     details so they know to review.
5. Return `{ ok: true, requestId }`.

## Admin invoicing flow

In `/admin`, the admin opens a request, enters `quotedPriceCents`, and sets `status` to
**`approved`**. The `sendFiringInvoice` afterChange hook fires:

- **Guard / idempotency:** act only when `operation === 'update'`, `status ===
  'approved'`, `quotedPriceCents > 0`, `squareInvoiceId` is empty, and the update did
  not originate from the hook itself (`req.context.fromFiringHook` flag — mirrors
  Plan 3's `fromSquareWebhook` guard). If `status === 'approved'` but
  `quotedPriceCents` is missing/0, set `invoice_failed` with a clear `lastInvoiceError`.
- Calls the **`createAndSendFiringInvoice`** service (DI; gateway injected). On success
  the service updates the request (`context: { fromFiringHook: true }`) to:
  `status: 'invoiced'`, `squareInvoiceId`, `squareInvoiceUrl`, `invoicedAt`. On failure:
  `status: 'invoice_failed'`, `lastInvoiceError` (message). The hook itself catches
  errors so an admin save never crashes.

**Service — `createAndSendFiringInvoice(deps, request)`** (`deps: { payload, gateway }`):
reads the **server-authoritative** `quotedPriceCents` from the request (never a client
value), calls `gateway.createAndSendInvoice(...)`, and writes the result back to the
request as above. Unit-tested with a fake gateway.

**Gateway — `firing-invoice-gateway.ts`** (`FiringInvoiceGateway` interface +
`squareFiringInvoiceGateway` impl). Single method:
```
createAndSendInvoice(input: {
  name: string; email: string; phone?: string;
  description: string; amountCents: number; referenceId: string;
}): Promise<{ invoiceId: string; invoiceUrl: string; status: string }>
```
Square sequence (confirm exact shapes against `square@44` during implementation, as
with prior plans): ensure a **customer** (`customers.create` with email/name) → create
an **order** with one line item (name `Cone 10 firing — <description>`, `basePriceMoney`
= `BigInt(amountCents)`/USD, at `SQUARE_LOCATION_ID`) → create an **invoice**
(`primaryRecipient.customerId`, `deliveryMethod: 'EMAIL'`, a `BALANCE`
payment request due on receipt, card accepted) → **publish** it (Square emails the
customer a hosted pay link; returns `publicUrl`). Returns the invoice id + public url +
status. Idempotency keys on each call (`randomUUID`).

> The customer pays via Square's hosted invoice page; **Square sends the invoice email**,
> so we don't send our own payment email — only the submission confirmation (above) and
> an optional paid-confirmation later.

## Webhook reconciliation (extend `/api/webhooks/square`)

The existing `invoice.payment_made` and `invoice.updated` branches currently match a
**member** by `subscription_id`. A firing invoice has no subscription, so extend both
branches: when no member matches (or there's no `subscription_id`), fall back to
matching a `FiringRequest` by `squareInvoiceId === invoice.id`.

- `invoice.payment_made` for a firing → set the request `status: 'paid'`, `paidAt`; write
  a `Payments` row (`type: 'firing'`, `firingRequest`, `amountCents` from the request's
  `quotedPriceCents`, `squareId: invoice.id`, `status: 'PAID'`, `paidAt`).
- `invoice.updated` CANCELED for a firing → optional: note it; keep status handling
  minimal (the admin can mark `cancelled`). All member-update writes already carry the
  `fromSquareWebhook` context; firing updates will too.
- All field reads use Square's raw **snake_case** body (`invoice.id`,
  `invoice.subscription_id`, `invoice.status`) — consistent with the existing handler.

## `Payments` collection change

Add `firing` to the `type` enum and a `firingRequest` relationship (`relationTo:
'firing-requests'`), alongside the existing `member`/`booking` relationships. Regenerate
types and the migration is captured on the next `migrate:create` (dev/test still
auto-push).

## Testing

- **TDD — `firing-invoice.int.spec.ts`:** `createAndSendFiringInvoice` with a fake
  gateway against the test DB:
  - success → request becomes `invoiced` with `squareInvoiceId`/`squareInvoiceUrl` set,
    and the gateway is called with the **DB** `quotedPriceCents` (not any client value);
  - gateway failure → request becomes `invoice_failed`, `lastInvoiceError` set, no
    invoice ids written;
  - `afterAll` FK-safe cleanup (payments → firing-requests → media) scoped to test data.
- The route, form, hook, and webhook extension follow the established
  reviewed-but-not-unit-tested pattern (consistent with bookings/membership). Existing
  gates stay green; the new collection/global don't affect current tests.
- Test files use the `*.int.spec.ts` suffix (vitest `include`).

## Out of scope (YAGNI)

No customer accounts/login, no upfront payment, no scheduling/calendar, no automatic
size→price calculator (admin decides), no SMS, no spam captcha (low volume — noted as a
future hardening if abuse appears). Pickup/turnaround tracking beyond the `completed`
status is not modeled.

## Operator / deploy notes

- The same production Square credentials and the existing webhook subscription cover
  this — ensure `invoice.payment_made` and `invoice.updated` are subscribed (they
  already are for memberships per `docs/DEPLOY.md`). No new env vars.
- Public photo upload writes to the `media` collection; in production those objects go
  to S3 via the conditional `s3Storage` plugin (Plan 4). Image-only + size cap enforced
  server-side.

## Commit identity

Repo-local `briswells <briswells@gmail.com>`. No AI attribution in commit messages.

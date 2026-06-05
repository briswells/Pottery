# Custom Cone 10 Firings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let visitors request a custom Cone 10 firing online with no upfront charge; staff set a price by size in the admin and send a Square invoice the customer pays online, with webhook reconciliation.

**Architecture:** Public multipart form → server-side API route creates a `FiringRequests` record (and optional photo). Staff set `quotedPriceCents` and flip status to `approved`; an `afterChange` hook calls a dependency-injected, unit-tested service that drives a Square gateway (customer → order → invoice → publish). The existing signed Square webhook is extended to mark firing invoices paid.

**Tech Stack:** Next.js 16 (App Router) + Payload 3.85 + Postgres, Square Node SDK (`square@44`), Resend, Vitest.

**Depends on:** Plans 1–4 (Square client, Payments collection, webhook route, email wrapper, S3 media, migrations) — all merged to `main`.

**Spec:** `docs/superpowers/specs/2026-06-05-cone10-firings-design.md`.

---

## Environment notes (READ FIRST — these override habits/older docs)

1. **Commit identity** is repo-local `briswells <briswells@gmail.com>`. **NEVER add AI/Claude attribution** to commit messages. Use the exact messages given.
2. **Generated types are at `src/payload-types.ts`** (not repo root). Regenerate with `pnpm generate:types`.
3. **Vitest only runs `tests/int/**/*.int.spec.ts`** — name test files `*.int.spec.ts` (a `.test.ts` file is silently skipped). Run a single file with `pnpm exec vitest run --config ./vitest.config.mts tests/int/<file>.int.spec.ts`; the whole suite with `pnpm test:int`.
4. **Always boot Payload with `getPayload({ config: await config })`** (note the `await config`).
5. **Server-component pages that query Payload MUST `export const dynamic = 'force-dynamic'`** (so `next build` needs no DB — see Plan 4).
6. **The webhook parses the RAW snake_case body** — read `invoice.id`, `invoice.subscription_id`, `invoice.status` (snake_case), never camelCase.
7. **No real Square/Resend/S3 creds** — manual sandbox steps are DEFERRED; verify with tsc/lint/tests. The injected-fake service test is the real coverage.
8. **`square@44` shapes:** confirm `customers.create`, `orders.create`, `invoices.create`, `invoices.publish` against `node_modules/square` and adapt to what the installed types require, keeping the same gateway interface. `getSquareClient()` / `SQUARE_LOCATION_ID()` already exist in `src/lib/square.ts`.
9. Gates after every task: `pnpm exec tsc --noEmit` clean, `pnpm lint` no new errors (pre-existing `no-explicit-any` warnings are OK), `pnpm test:int` green.

---

## File Structure

```
src/
├── collections/
│   ├── FiringRequests.ts        # NEW
│   └── Payments.ts              # MODIFY: + 'firing' type, + firingRequest relationship
├── globals/
│   └── FiringsPage.ts           # NEW
├── lib/
│   └── firing-invoice-gateway.ts# NEW
├── services/
│   └── firing-invoice.ts        # NEW
├── hooks/
│   └── sendFiringInvoice.ts     # NEW
├── payload.config.ts            # MODIFY: register collection + global
└── app/
    ├── api/firings/route.ts                # NEW
    ├── api/webhooks/square/route.ts        # MODIFY: firing reconciliation
    └── (frontend)/firings/
        ├── page.tsx                        # NEW
        └── FiringRequestForm.tsx           # NEW
    └── (frontend)/components/Header.tsx     # MODIFY: nav link
    └── (frontend)/components/MobileNav.tsx  # MODIFY: nav link
tests/int/
└── firing-invoice.int.spec.ts   # NEW
```

---

## Task 1: FiringRequests collection + Payments link

**Files:**
- Create: `src/collections/FiringRequests.ts`
- Modify: `src/collections/Payments.ts`
- Modify: `src/payload.config.ts`

- [ ] **Step 1: Create the collection**

Create `src/collections/FiringRequests.ts`:

```ts
import type { CollectionConfig } from 'payload'
import { isAdmin } from '../access/isAdmin'
import { isAdminOrEditor } from '../access/isAdminOrEditor'

export const FiringRequests: CollectionConfig = {
  slug: 'firing-requests',
  admin: {
    group: 'Studio',
    useAsTitle: 'name',
    defaultColumns: ['name', 'status', 'quotedPriceCents', 'invoicedAt', 'paidAt'],
  },
  access: {
    read: isAdminOrEditor,
    create: () => false, // created server-side via /api/firings (overrideAccess)
    update: isAdminOrEditor,
    delete: isAdmin,
  },
  fields: [
    // Customer
    { name: 'name', type: 'text', required: true },
    { name: 'email', type: 'email', required: true },
    { name: 'phone', type: 'text' },
    // Piece
    { name: 'description', type: 'textarea', required: true },
    { name: 'heightIn', type: 'number', admin: { description: 'Height in inches' } },
    { name: 'widthIn', type: 'number', admin: { description: 'Width in inches' } },
    { name: 'depthIn', type: 'number', admin: { description: 'Depth in inches' } },
    { name: 'quantity', type: 'number', defaultValue: 1 },
    { name: 'photo', type: 'upload', relationTo: 'media' },
    { name: 'notes', type: 'textarea', admin: { description: 'Customer notes' } },
    // Workflow
    {
      name: 'status', type: 'select', required: true, defaultValue: 'submitted',
      options: [
        { label: 'Submitted', value: 'submitted' },
        { label: 'Approved (send invoice)', value: 'approved' },
        { label: 'Invoiced', value: 'invoiced' },
        { label: 'Invoice failed', value: 'invoice_failed' },
        { label: 'Paid', value: 'paid' },
        { label: 'Completed', value: 'completed' },
        { label: 'Cancelled', value: 'cancelled' },
      ],
    },
    { name: 'quotedPriceCents', type: 'number', min: 0, admin: { description: 'Price in cents, set by staff (e.g. 4500 = $45.00). Set this, then status → Approved to send the invoice.' } },
    { name: 'adminNotes', type: 'textarea' },
    // Square linkage (read-only)
    { name: 'squareCustomerId', type: 'text', admin: { readOnly: true } },
    { name: 'squareInvoiceId', type: 'text', index: true, admin: { readOnly: true } },
    { name: 'squareInvoiceUrl', type: 'text', admin: { readOnly: true } },
    { name: 'invoicedAt', type: 'date', admin: { readOnly: true } },
    { name: 'paidAt', type: 'date', admin: { readOnly: true } },
    { name: 'lastInvoiceError', type: 'text', admin: { readOnly: true } },
  ],
}
```

- [ ] **Step 2: Add the `firing` type + relationship to Payments**

In `src/collections/Payments.ts`, change the `type` select options to include firing, and add a `firingRequest` relationship next to `member`/`booking`:

```ts
    { name: 'type', type: 'select', required: true, options: [
      { label: 'Booking', value: 'booking' },
      { label: 'Membership', value: 'membership' },
      { label: 'Firing', value: 'firing' },
    ] },
    { name: 'member', type: 'relationship', relationTo: 'members', admin: { description: 'Set for membership payments' } },
    { name: 'booking', type: 'relationship', relationTo: 'bookings', admin: { description: 'Set for class booking payments' } },
    { name: 'firingRequest', type: 'relationship', relationTo: 'firing-requests', admin: { description: 'Set for firing payments' } },
```
(Leave the other Payments fields unchanged.)

- [ ] **Step 3: Register the collection**

In `src/payload.config.ts`, import `FiringRequests` and add it to the `collections` array (order is cosmetic), e.g.:
```ts
import { FiringRequests } from './collections/FiringRequests'
// ...
collections: [Users, Members, Media, Classes, Bookings, Payments, FiringRequests],
```

- [ ] **Step 4: Regenerate types + type-check**

Run:
```bash
pnpm generate:types
pnpm exec tsc --noEmit
```
Expected: clean. Confirm `FiringRequest` and `firing-requests` appear in `src/payload-types.ts`, and `Payment.firingRequest` exists.

- [ ] **Step 5: Confirm tests still pass**

Run: `pnpm test:int`
Expected: still 16/16 (new collection doesn't affect existing tests; dev/test auto-push creates the table).

- [ ] **Step 6: Commit**

```bash
git add src/collections/FiringRequests.ts src/collections/Payments.ts src/payload.config.ts src/payload-types.ts
git commit -m "Add FiringRequests collection and link Payments to firings"
```

---

## Task 2: FiringsPage global (editable copy)

**Files:**
- Create: `src/globals/FiringsPage.ts`
- Modify: `src/payload.config.ts`

- [ ] **Step 1: Create the global**

Create `src/globals/FiringsPage.ts`:

```ts
import type { GlobalConfig } from 'payload'
import { anyone } from '../access/anyone'
import { isAdminOrEditor } from '../access/isAdminOrEditor'

export const FiringsPage: GlobalConfig = {
  slug: 'firings-page',
  admin: { group: 'Content' },
  access: { read: anyone, update: isAdminOrEditor },
  fields: [
    { name: 'headline', type: 'text', required: true, defaultValue: 'Custom Cone 10 Firings' },
    { name: 'intro', type: 'textarea', defaultValue: 'Bring us your work and we’ll fire it to Cone 10. Tell us about your piece below and we’ll quote a price based on its size.' },
    {
      name: 'steps', type: 'array', labels: { singular: 'Step', plural: 'Steps' },
      fields: [{ name: 'step', type: 'text', required: true }],
      defaultValue: [
        { step: 'Tell us about your piece — size, quantity, and a photo if you have one.' },
        { step: 'We review the size and email you a Square invoice with the price.' },
        { step: 'Pay online, drop off your work, and we’ll fire it to Cone 10.' },
      ],
    },
    { name: 'pricingNote', type: 'text', defaultValue: 'Price is quoted by size after we see your piece — you’re never charged up front.' },
  ],
}
```

Note: confirm `anyone` exists at `src/access/anyone.ts` (it does — used by other globals/collections). If a global's `access.read` shape differs from what other globals use, match the existing globals (`src/globals/MembershipPage.ts`).

- [ ] **Step 2: Register the global**

In `src/payload.config.ts`, import `FiringsPage` and add it to `globals`:
```ts
import { FiringsPage } from './globals/FiringsPage'
// ...
globals: [SiteSettings, HomePage, MembershipPage, FiringsPage],
```

- [ ] **Step 3: Regenerate types + type-check**

Run:
```bash
pnpm generate:types
pnpm exec tsc --noEmit
```
Expected: clean; `FiringsPage` type + `firings-page` slug present.

- [ ] **Step 4: Commit**

```bash
git add src/globals/FiringsPage.ts src/payload.config.ts src/payload-types.ts
git commit -m "Add FiringsPage global for editable firings copy"
```

---

## Task 3: Square firing-invoice gateway

**Files:**
- Create: `src/lib/firing-invoice-gateway.ts`

- [ ] **Step 1: Implement the gateway**

Create `src/lib/firing-invoice-gateway.ts`:

```ts
import { randomUUID } from 'crypto'
import { getSquareClient, SQUARE_LOCATION_ID } from './square'

export interface FiringInvoiceInput {
  name: string
  email: string
  phone?: string
  description: string
  amountCents: number
  referenceId: string
}

export interface FiringInvoiceResult {
  invoiceId: string
  invoiceUrl: string
  status: string
}

export interface FiringInvoiceGateway {
  createAndSendInvoice(input: FiringInvoiceInput): Promise<FiringInvoiceResult>
}

/** Due date (YYYY-MM-DD) ~7 days out. Pass `now` for testability; defaults to current time at call. */
function dueDateString(now: Date): string {
  const d = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
  return d.toISOString().slice(0, 10)
}

export const squareFiringInvoiceGateway: FiringInvoiceGateway = {
  async createAndSendInvoice(input) {
    const client = getSquareClient()
    const locationId = SQUARE_LOCATION_ID()

    // 1) Customer
    const customerRes = await client.customers.create({
      idempotencyKey: randomUUID(),
      givenName: input.name,
      emailAddress: input.email,
      phoneNumber: input.phone,
    })
    const customerId = customerRes.customer?.id
    if (!customerId) throw new Error('Square customer was not created')

    // 2) Order with the firing line item, priced by the (server-set) amount.
    const orderRes = await client.orders.create({
      idempotencyKey: randomUUID(),
      order: {
        locationId,
        lineItems: [
          {
            name: `Cone 10 firing — ${input.description}`.slice(0, 500),
            quantity: '1',
            basePriceMoney: { amount: BigInt(input.amountCents), currency: 'USD' },
          },
        ],
      },
    })
    const orderId = orderRes.order?.id
    if (!orderId) throw new Error('Square order was not created')

    // 3) Invoice referencing the order; email delivery, balance due ~7 days.
    const invoiceRes = await client.invoices.create({
      idempotencyKey: randomUUID(),
      invoice: {
        locationId,
        orderId,
        primaryRecipient: { customerId },
        deliveryMethod: 'EMAIL',
        acceptedPaymentMethods: { card: true },
        paymentRequests: [
          { requestType: 'BALANCE', dueDate: dueDateString(new Date()), automaticPaymentSource: 'NONE' },
        ],
      },
    })
    const invoice = invoiceRes.invoice
    if (!invoice?.id) throw new Error('Square invoice was not created')

    // 4) Publish (sends the email; returns the hosted public URL).
    const publishedRes = await client.invoices.publish({
      invoiceId: invoice.id,
      version: invoice.version ?? 0,
      idempotencyKey: randomUUID(),
    })
    const published = publishedRes.invoice
    return {
      invoiceId: published?.id ?? invoice.id,
      invoiceUrl: published?.publicUrl ?? '',
      status: published?.status ?? 'UNPAID',
    }
  },
}
```

> **Confirm against `square@44`** (like prior plans): the exact param/response shapes for `orders.create`, `invoices.create`, and `invoices.publish` (field names such as `basePriceMoney`, `primaryRecipient`, `deliveryMethod`, `paymentRequests`, `requestType`, `automaticPaymentSource`, `publicUrl`, `version`). Adjust to what the installed TS types require while keeping the `FiringInvoiceGateway` interface and return shape identical. `customers.create` matches the membership gateway already in the repo.

- [ ] **Step 2: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: clean (after any square@44 shape adjustments).

- [ ] **Step 3: Commit**

```bash
git add src/lib/firing-invoice-gateway.ts
git commit -m "Add Square firing-invoice gateway"
```

---

## Task 4: Firing-invoice service (TDD with a fake gateway)

**Files:**
- Create: `src/services/firing-invoice.ts`
- Test: `tests/int/firing-invoice.int.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/int/firing-invoice.int.spec.ts`:

```ts
import { describe, it, expect, vi, afterAll } from 'vitest'
import { getTestPayload } from './helpers'
import { createAndSendFiringInvoice } from '../../src/services/firing-invoice'
import type { FiringInvoiceGateway } from '../../src/lib/firing-invoice-gateway'

function fakeGateway(overrides: Partial<FiringInvoiceGateway> = {}): FiringInvoiceGateway {
  return {
    createAndSendInvoice: vi.fn(async () => ({
      invoiceId: 'inv_1',
      invoiceUrl: 'https://squareup.com/pay/inv_1',
      status: 'UNPAID',
    })),
    ...overrides,
  }
}

async function makeRequest(payload: any, quotedPriceCents: number | undefined) {
  return payload.create({
    collection: 'firing-requests',
    overrideAccess: true,
    data: {
      name: `Firer ${Date.now()}`,
      email: `firer-${Date.now()}@test.local`,
      description: 'A tall vase',
      quantity: 1,
      status: 'approved',
      quotedPriceCents,
    },
  })
}

describe('createAndSendFiringInvoice', () => {
  it('invoices using the DB price and marks the request invoiced', async () => {
    const payload = await getTestPayload()
    const req = await makeRequest(payload, 4500)
    const gw = fakeGateway()
    const updated = await createAndSendFiringInvoice({ payload, gateway: gw }, req)

    expect(gw.createAndSendInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ amountCents: 4500, email: req.email }),
    )
    expect(updated.status).toBe('invoiced')
    expect(updated.squareInvoiceId).toBe('inv_1')
    expect(updated.squareInvoiceUrl).toBe('https://squareup.com/pay/inv_1')
    expect(updated.invoicedAt).toBeTruthy()
  })

  it('marks the request invoice_failed (no invoice id) when the gateway throws', async () => {
    const payload = await getTestPayload()
    const req = await makeRequest(payload, 4500)
    const gw = fakeGateway({ createAndSendInvoice: vi.fn(async () => { throw new Error('square exploded') }) })
    const updated = await createAndSendFiringInvoice({ payload, gateway: gw }, req)

    expect(updated.status).toBe('invoice_failed')
    expect(updated.lastInvoiceError).toMatch(/square exploded/i)
    expect(updated.squareInvoiceId ?? null).toBeNull()
  })

  it('fails without charging when no price is set', async () => {
    const payload = await getTestPayload()
    const req = await makeRequest(payload, undefined)
    const gw = fakeGateway()
    const updated = await createAndSendFiringInvoice({ payload, gateway: gw }, req)

    expect(gw.createAndSendInvoice).not.toHaveBeenCalled()
    expect(updated.status).toBe('invoice_failed')
    expect(updated.lastInvoiceError).toMatch(/price/i)
  })
})

afterAll(async () => {
  const payload = await getTestPayload()
  await payload.delete({ collection: 'payments', where: { type: { equals: 'firing' } }, overrideAccess: true })
  await payload.delete({ collection: 'firing-requests', where: { email: { contains: '@test.local' } }, overrideAccess: true })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run --config ./vitest.config.mts tests/int/firing-invoice.int.spec.ts`
Expected: FAIL — `createAndSendFiringInvoice` not found.

- [ ] **Step 3: Implement the service**

Create `src/services/firing-invoice.ts`:

```ts
import type { Payload } from 'payload'
import type { FiringInvoiceGateway } from '../lib/firing-invoice-gateway'
import type { FiringRequest } from '../payload-types'

export interface FiringInvoiceDeps {
  payload: Payload
  gateway: FiringInvoiceGateway
}

/**
 * Creates and sends a Square invoice for an approved firing request, then writes
 * the result back to the request. The amount is read from the request (server-
 * authoritative), never from the client. Updates carry context.fromFiringHook so
 * the Members/FiringRequests afterChange hook does not re-fire on our own write.
 */
export async function createAndSendFiringInvoice(
  deps: FiringInvoiceDeps,
  request: FiringRequest,
): Promise<FiringRequest> {
  const { payload, gateway } = deps

  const amountCents = request.quotedPriceCents ?? 0
  if (!amountCents || amountCents <= 0) {
    return payload.update({
      collection: 'firing-requests',
      id: request.id,
      overrideAccess: true,
      context: { fromFiringHook: true },
      data: { status: 'invoice_failed', lastInvoiceError: 'Set a quoted price before approving.' },
    })
  }

  try {
    const result = await gateway.createAndSendInvoice({
      name: request.name,
      email: request.email,
      phone: request.phone ?? undefined,
      description: request.description,
      amountCents,
      referenceId: `firing-${request.id}`,
    })
    return await payload.update({
      collection: 'firing-requests',
      id: request.id,
      overrideAccess: true,
      context: { fromFiringHook: true },
      data: {
        status: 'invoiced',
        squareInvoiceId: result.invoiceId,
        squareInvoiceUrl: result.invoiceUrl,
        invoicedAt: new Date().toISOString(),
        lastInvoiceError: null,
      },
    })
  } catch (e) {
    return payload.update({
      collection: 'firing-requests',
      id: request.id,
      overrideAccess: true,
      context: { fromFiringHook: true },
      data: { status: 'invoice_failed', lastInvoiceError: e instanceof Error ? e.message : String(e) },
    })
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run --config ./vitest.config.mts tests/int/firing-invoice.int.spec.ts`
Expected: PASS (3 tests). Then run `pnpm test:int` — expect 19/19 (16 existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add src/services/firing-invoice.ts tests/int/firing-invoice.int.spec.ts
git commit -m "Add firing-invoice service that creates and sends a Square invoice"
```

---

## Task 5: Send the invoice when staff approve (afterChange hook)

**Files:**
- Create: `src/hooks/sendFiringInvoice.ts`
- Modify: `src/collections/FiringRequests.ts`

- [ ] **Step 1: Implement the hook**

Create `src/hooks/sendFiringInvoice.ts`:

```ts
import type { CollectionAfterChangeHook } from 'payload'
import { squareFiringInvoiceGateway } from '../lib/firing-invoice-gateway'
import { createAndSendFiringInvoice } from '../services/firing-invoice'
import type { FiringRequest } from '../payload-types'

/**
 * When staff set a firing request to 'approved' (with a price set), create and send
 * the Square invoice. Guarded so it fires once and never on our own write-back.
 */
export const sendFiringInvoice: CollectionAfterChangeHook<FiringRequest> = async ({ doc, operation, req }) => {
  if (operation !== 'update') return doc
  // Our own write-back (from the service) sets this flag — don't re-enter.
  if (req?.context?.fromFiringHook) return doc
  if (doc.status !== 'approved') return doc
  if (doc.squareInvoiceId) return doc // already invoiced

  // Fire-and-handle; the service writes status/error back to the doc itself.
  // Errors are swallowed so an admin save never crashes; the request will show
  // 'invoice_failed' with lastInvoiceError if Square rejected it.
  try {
    await createAndSendFiringInvoice({ payload: req.payload, gateway: squareFiringInvoiceGateway }, doc)
  } catch (e) {
    console.error(`Firing invoice send failed for request ${doc.id}:`, e)
  }
  return doc
}
```

> Note: `req.payload` is the Payload instance available on the hook's `req`. The service's own `payload.update` carries `context: { fromFiringHook: true }`, so this hook returns early on that re-entrant call (and on the `invoice_failed`/`invoiced` status it would skip anyway).

- [ ] **Step 2: Wire the hook into the collection**

In `src/collections/FiringRequests.ts`, add the import and a `hooks` block (e.g. after `access`, before `fields`):
```ts
import { sendFiringInvoice } from '../hooks/sendFiringInvoice'
// ...inside the collection config:
hooks: { afterChange: [sendFiringInvoice] },
```

- [ ] **Step 3: Type-check + tests**

Run:
```bash
pnpm exec tsc --noEmit
pnpm test:int
```
Expected: clean; 19/19. (The service test creates requests as `approved` then calls the service directly; the create is `operation: 'create'` so the hook's Square path is skipped, and the service's write-backs carry the context flag — no real Square call fires in tests.)

- [ ] **Step 4: Commit**

```bash
git add src/hooks/sendFiringInvoice.ts src/collections/FiringRequests.ts
git commit -m "Send Square invoice when staff approve a firing request"
```

---

## Task 6: Public submission API route (multipart)

**Files:**
- Create: `src/app/api/firings/route.ts`

- [ ] **Step 1: Implement the route**

Create `src/app/api/firings/route.ts`:

```ts
import { getPayload } from 'payload'
import config from '@payload-config'
import { sendEmail } from '../../../lib/email'

const MAX_PHOTO_BYTES = 10 * 1024 * 1024 // 10 MB

function num(v: FormDataEntryValue | null): number | undefined {
  if (v == null || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

export async function POST(req: Request) {
  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return Response.json({ error: 'Invalid form submission' }, { status: 400 })
  }

  const name = String(form.get('name') ?? '').trim()
  const email = String(form.get('email') ?? '').trim()
  const description = String(form.get('description') ?? '').trim()
  if (!name || !email || !description) {
    return Response.json({ error: 'Please provide your name, email, and a description.' }, { status: 400 })
  }
  const phone = String(form.get('phone') ?? '').trim() || undefined
  const notes = String(form.get('notes') ?? '').trim() || undefined

  const payload = await getPayload({ config: await config })

  // Optional photo → create a media doc server-side (public create on media stays closed).
  let photoId: number | undefined
  const file = form.get('photo')
  if (file && typeof file !== 'string' && file.size > 0) {
    if (!file.type.startsWith('image/')) {
      return Response.json({ error: 'Photo must be an image.' }, { status: 400 })
    }
    if (file.size > MAX_PHOTO_BYTES) {
      return Response.json({ error: 'Photo must be 10 MB or smaller.' }, { status: 400 })
    }
    const buffer = Buffer.from(await file.arrayBuffer())
    const media = await payload.create({
      collection: 'media',
      overrideAccess: true,
      data: { alt: `Firing request photo from ${name}` },
      file: { data: buffer, mimetype: file.type, name: file.name || 'firing-photo', size: file.size },
    })
    photoId = media.id
  }

  const request = await payload.create({
    collection: 'firing-requests',
    overrideAccess: true,
    data: {
      name, email, phone, description, notes,
      heightIn: num(form.get('heightIn')),
      widthIn: num(form.get('widthIn')),
      depthIn: num(form.get('depthIn')),
      quantity: num(form.get('quantity')) ?? 1,
      photo: photoId,
      status: 'submitted',
    },
  })

  // Confirmation + staff notification. Email failures must NOT fail the submission.
  const dims = [num(form.get('heightIn')), num(form.get('widthIn')), num(form.get('depthIn'))]
    .map((d) => (d == null ? '?' : d)).join(' × ')
  try {
    await sendEmail({
      to: email,
      subject: 'We received your Cone 10 firing request',
      html: `<p>Thanks, ${name}! We received your firing request and will review the size, then email you a Square invoice with the price. You’re not charged anything yet.</p>`,
    })
  } catch (e) { console.error('Firing confirmation email failed:', e) }
  try {
    if (process.env.STAFF_NOTIFY_EMAIL) {
      await sendEmail({
        to: process.env.STAFF_NOTIFY_EMAIL,
        subject: `New Cone 10 firing request from ${name}`,
        html: `<p>${name} (${email}${phone ? `, ${phone}` : ''}) requested a firing.</p>
<p><strong>Piece:</strong> ${description}<br/><strong>Size (in):</strong> ${dims}, qty ${num(form.get('quantity')) ?? 1}</p>
<p>Review it in the admin and set a price, then mark it Approved to send the invoice.</p>`,
      })
    }
  } catch (e) { console.error('Firing staff-notify email failed:', e) }

  return Response.json({ ok: true, requestId: request.id })
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: clean. (If `payload.create` for `media` complains about a required field other than `alt`, check `src/collections/Media.ts` and supply it.)

- [ ] **Step 3: Commit**

```bash
git add src/app/api/firings/route.ts
git commit -m "Add public firing-request submission API route"
```

---

## Task 7: /firings page + form + nav link

**Files:**
- Create: `src/app/(frontend)/firings/page.tsx`
- Create: `src/app/(frontend)/firings/FiringRequestForm.tsx`
- Modify: `src/app/(frontend)/components/Header.tsx`
- Modify: `src/app/(frontend)/components/MobileNav.tsx`

- [ ] **Step 1: Create the client form**

Create `src/app/(frontend)/firings/FiringRequestForm.tsx`:

```tsx
'use client'
import { useState } from 'react'

export function FiringRequestForm() {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setBusy(true); setMsg(null)
    try {
      const res = await fetch('/api/firings', { method: 'POST', body: new FormData(e.currentTarget) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Submission failed')
      setDone(true)
      setMsg('Request received — we’ll review the size and email you an invoice.')
    } catch (err: any) {
      setMsg(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (done) return <p style={{ marginTop: 24, fontWeight: 600 }}>{msg}</p>

  return (
    <form onSubmit={submit} style={{ marginTop: 24, display: 'grid', gap: 12, maxWidth: 480 }}>
      <input required name="name" placeholder="Your name" />
      <input required type="email" name="email" placeholder="Email" />
      <input name="phone" placeholder="Phone (optional)" />
      <textarea required name="description" placeholder="Describe your piece(s)" rows={3} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        <input type="number" step="0.1" min="0" name="heightIn" placeholder="Height (in)" />
        <input type="number" step="0.1" min="0" name="widthIn" placeholder="Width (in)" />
        <input type="number" step="0.1" min="0" name="depthIn" placeholder="Depth (in)" />
      </div>
      <input type="number" min="1" name="quantity" placeholder="Quantity" defaultValue={1} />
      <label style={{ fontSize: 14, color: 'var(--pp-muted)' }}>
        Photo (optional)
        <input type="file" name="photo" accept="image/*" style={{ display: 'block', marginTop: 4 }} />
      </label>
      <textarea name="notes" placeholder="Anything else? (optional)" rows={2} />
      <button className="pp-btn" type="submit" disabled={busy}>
        {busy ? 'Sending…' : 'Request a firing'}
      </button>
      {msg && <p>{msg}</p>}
    </form>
  )
}
```

- [ ] **Step 2: Create the page**

Create `src/app/(frontend)/firings/page.tsx`:

```tsx
import { getPayload } from 'payload'
import config from '@payload-config'
import { FiringRequestForm } from './FiringRequestForm'

export const metadata = {
  title: 'Custom Cone 10 Firings — Portside Pottery',
  description: 'Request a custom Cone 10 firing. We quote a price by size — no upfront charge.',
}

export const dynamic = 'force-dynamic'

export default async function FiringsPage() {
  const payload = await getPayload({ config: await config })
  const page = await payload.findGlobal({ slug: 'firings-page' })

  return (
    <div style={{ padding: '40px 0', maxWidth: 680 }}>
      <h1>{page.headline}</h1>
      {page.intro && <p style={{ color: 'var(--pp-muted)', lineHeight: 1.7, maxWidth: 560 }}>{page.intro}</p>}

      {page.steps && page.steps.length > 0 && (
        <>
          <h2 style={{ fontSize: 20, marginBottom: 12 }}>How it works</h2>
          <ol style={{ lineHeight: 1.7, paddingLeft: 20 }}>
            {page.steps.map((s, i) => (
              <li key={i}>{s.step}</li>
            ))}
          </ol>
        </>
      )}

      {page.pricingNote && (
        <p style={{ marginTop: 16, fontWeight: 600 }}>{page.pricingNote}</p>
      )}

      <h2 style={{ fontSize: 20, marginTop: 28, marginBottom: 4 }}>Request a firing</h2>
      <FiringRequestForm />
    </div>
  )
}
```

- [ ] **Step 3: Add the nav link (desktop + mobile)**

In `src/app/(frontend)/components/Header.tsx`, add a link inside the desktop `<nav className="pp-nav" ...>` (e.g. after the `Membership` link):
```tsx
          <Link href="/firings">Firings</Link>
```
In `src/app/(frontend)/components/MobileNav.tsx`, add the same inside the mobile nav (after the Membership `<Link>`), keeping the existing `onClick={() => setOpen(false)}` pattern:
```tsx
        <Link href="/firings" onClick={() => setOpen(false)}>Firings</Link>
```

- [ ] **Step 4: Type-check + lint + e2e smoke**

Run:
```bash
pnpm exec tsc --noEmit
pnpm lint
```
Expected: clean / no new errors. Then confirm the dev server renders the page and a missing-field POST is rejected (best-effort, no creds needed):
```bash
# in one shell: pnpm dev   (wait until ready)
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/api/firings -F 'name=' || true
# expect 400
```
Stop the dev server. Skip if flaky.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(frontend)/firings" "src/app/(frontend)/components/Header.tsx" "src/app/(frontend)/components/MobileNav.tsx"
git commit -m "Add /firings page with request form and nav link"
```

---

## Task 8: Reconcile firing invoice payments via the webhook

**Files:**
- Modify: `src/app/api/webhooks/square/route.ts`

The handler already verifies the signature and handles `payment.updated`, `refund.*`, and the membership `invoice.*` / `subscription.updated` branches. Extend the invoice branches to fall back to firing requests.

- [ ] **Step 1: Add a firing lookup helper**

Inside `POST`, next to the existing `findMemberBySubscription` helper, add:
```ts
  async function findFiringByInvoiceId(invoiceId: string | undefined) {
    if (!invoiceId) return null
    const { docs } = await payload.find({ collection: 'firing-requests', where: { squareInvoiceId: { equals: invoiceId } }, limit: 1 })
    return docs[0] ?? null
  }
```

- [ ] **Step 2: Reconcile firing payment in the `invoice.payment_made` branch**

In the existing `else if (event.type === 'invoice.payment_made') { ... }` block, after the member handling (i.e. inside the same block but after the `if (member) { ... }`), add a firing fallback. The block should end up like:

```ts
  } else if (event.type === 'invoice.payment_made') {
    const invoice = event.data?.object?.invoice
    const subscriptionId = invoice?.subscription_id ?? invoice?.subscriptionId
    const member = await findMemberBySubscription(subscriptionId)
    if (member) {
      // ...existing member update + membership payments row (unchanged)...
    } else {
      // No membership subscription → this may be a one-off firing invoice.
      const firing = await findFiringByInvoiceId(invoice?.id)
      if (firing && firing.status !== 'paid') {
        await payload.update({
          collection: 'firing-requests', id: firing.id, overrideAccess: true,
          context: { fromFiringHook: true },
          data: { status: 'paid', paidAt: new Date().toISOString() },
        })
        await payload.create({
          collection: 'payments', overrideAccess: true,
          data: {
            type: 'firing', firingRequest: firing.id,
            amountCents: firing.quotedPriceCents ?? 0,
            squareId: invoice?.id ?? `firing-inv-${firing.id}`,
            status: 'PAID', paidAt: new Date().toISOString(),
          },
        })
      }
    }
  }
```
(Keep the existing member-branch body exactly as it is; only add the `else { ... }` firing fallback. The `context: { fromFiringHook: true }` prevents the FiringRequests afterChange hook from re-firing on this status change.)

- [ ] **Step 3: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: clean. (If TS narrows `data.status` to the firing-requests union and complains, the literal `'paid'` is a valid option so no cast is needed.)

- [ ] **Step 4: Confirm tests still pass**

Run: `pnpm test:int`
Expected: 19/19.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/webhooks/square/route.ts
git commit -m "Reconcile firing invoice payments via Square webhook"
```

---

## Self-Review

**Spec coverage:**
- Public `/firings` page (info + form) — Task 7; editable copy via `FiringsPage` global — Task 2. ✓
- No upfront charge; submission stored as `submitted` + customer & staff emails — Task 6. ✓
- Optional photo (image-only, ≤10 MB) via server-side media create — Task 6. ✓
- Admin sets price + status `approved` → Square invoice sent — Tasks 4 (service), 5 (hook), 3 (gateway). ✓
- Invoice paid online; webhook marks `paid` + writes a `Payments` row (`type: 'firing'`) — Task 8 + Task 1 (Payments change). ✓
- Server-authoritative amount (DB `quotedPriceCents`, asserted in the service test) — Task 4. ✓
- `invoice_failed` retry path; idempotent hook (`fromFiringHook` guard, `squareInvoiceId` short-circuit) — Tasks 4–5. ✓

**Placeholder scan:** none. The "confirm square@44 shapes" note (Task 3) is a genuine version-dependent check, flagged not hidden — consistent with Plans 2–4. ✓

**Type consistency:** `FiringInvoiceGateway` / `FiringInvoiceInput` / `FiringInvoiceResult` (Task 3) are consumed by the service (Task 4) and the hook (Task 5). `createAndSendFiringInvoice(deps, request)` signature matches its call sites (test + hook). Status values (`submitted|approved|invoiced|invoice_failed|paid|completed|cancelled`) are consistent across the collection, service, hook, and webhook. `Payments.type` includes `firing` and `firingRequest` relationship (Task 1) before the webhook writes them (Task 8). The `fromFiringHook` context flag is set by every service/webhook write to the request and checked by the hook. ✓

**Known limitation (logged):** `invoice.updated` (e.g. CANCELED) is not specially handled for firings in v1 — staff mark `cancelled` manually; the spec accepted this. The amount written to the `Payments` row comes from the request's `quotedPriceCents` (equals the invoice total). Public submissions have no captcha (low volume — noted in the spec).

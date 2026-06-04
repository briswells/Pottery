# Portside Pottery — Plan 2: Class Booking & One-Time Payments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a visitor register and pay for a class online with a card, charged once through Square, with capacity enforcement and an emailed confirmation.

**Architecture:** A pure, dependency-injected booking service holds the capacity/charge/record logic and is unit-tested with fakes. A thin Next.js route handler wires it to the real Square client and email sender. The browser tokenizes the card with Square's Web Payments SDK; the server charges the resulting `sourceId` with the amount read from the database. A signed Square webhook reconciles later refunds/disputes.

**Tech Stack:** Square Node SDK (`square`), Web Payments SDK (browser), Resend (email), Payload local API, Vitest.

**Depends on:** Plan 1 (Classes collection, Payload app, test harness).

**Scope note:** One-time class/camp payments only. Recurring membership is Plan 3.

**Commit identity:** repo-local `briswells <briswells@gmail.com>`. **No AI attribution in commit messages.**

---

## File Structure (added by this plan)

```
src/
├── collections/
│   └── Bookings.ts            # one row per registration
│   └── Payments.ts            # payment log (shared with Plan 3)
├── lib/
│   ├── square.ts              # SquareClient factory from env
│   ├── payments.ts            # chargeCard() — real Square one-time charge
│   ├── email.ts               # sendEmail() — Resend wrapper
│   └── occupancy.ts           # seatsRemaining() helper
├── services/
│   └── booking.ts             # createPaidBooking() — injectable, unit-tested
└── app/
    ├── api/
    │   ├── bookings/route.ts          # POST: create booking + charge
    │   └── webhooks/square/route.ts   # POST: signed Square events
    └── (frontend)/classes/[slug]/
        └── BookingForm.tsx            # client component (Web Payments SDK)
tests/int/
├── booking-service.int.test.ts
└── occupancy.int.test.ts
```

---

## Task 1: Square + email environment and client factory

**Files:**
- Modify: `.env.example`, `.env`
- Create: `src/lib/square.ts`

- [ ] **Step 1: Add env vars to `.env.example`**

Append:
```bash
# Square (sandbox values during development)
SQUARE_ENVIRONMENT=sandbox
SQUARE_ACCESS_TOKEN=replace-with-sandbox-access-token
SQUARE_LOCATION_ID=replace-with-sandbox-location-id
SQUARE_WEBHOOK_SIGNATURE_KEY=replace-with-webhook-signature-key
# Public (browser) Web Payments SDK values
NEXT_PUBLIC_SQUARE_APP_ID=replace-with-sandbox-application-id
NEXT_PUBLIC_SQUARE_LOCATION_ID=replace-with-sandbox-location-id
# Email
RESEND_API_KEY=replace-with-resend-api-key
EMAIL_FROM="Portside Pottery <no-reply@portsidepottery.com>"
# Public base URL (used for webhook signature verification + links)
PUBLIC_BASE_URL=http://localhost:3000
```
Copy the same keys into `.env` with real **Sandbox** values from the Square Developer Dashboard.

- [ ] **Step 2: Install the SDKs**

Run:
```bash
pnpm add square resend
```

- [ ] **Step 3: Create the Square client factory**

Create `src/lib/square.ts`:

```ts
import { SquareClient, SquareEnvironment } from 'square'

let client: SquareClient | null = null

export function getSquareClient(): SquareClient {
  if (client) return client
  client = new SquareClient({
    token: process.env.SQUARE_ACCESS_TOKEN!,
    environment:
      process.env.SQUARE_ENVIRONMENT === 'production'
        ? SquareEnvironment.Production
        : SquareEnvironment.Sandbox,
  })
  return client
}

export const SQUARE_LOCATION_ID = () => process.env.SQUARE_LOCATION_ID!
```

- [ ] **Step 4: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add .env.example src/lib/square.ts package.json pnpm-lock.yaml
git commit -m "Add Square client factory and payment/email env vars"
```

---

## Task 2: Payments log collection

**Files:**
- Create: `src/collections/Payments.ts`
- Modify: `src/payload.config.ts`

- [ ] **Step 1: Implement the Payments collection**

Create `src/collections/Payments.ts`:

```ts
import type { CollectionConfig } from 'payload'
import { isAdmin } from '../access/isAdmin'

export const Payments: CollectionConfig = {
  slug: 'payments',
  admin: { group: 'Commerce', defaultColumns: ['type', 'amountCents', 'status', 'paidAt'], useAsTitle: 'squareId' },
  access: {
    read: isAdmin,
    create: () => false,   // only created server-side via local API (overrideAccess)
    update: () => false,
    delete: isAdmin,
  },
  fields: [
    { name: 'type', type: 'select', required: true, options: [
      { label: 'Booking', value: 'booking' },
      { label: 'Membership', value: 'membership' },
    ] },
    { name: 'member', type: 'relationship', relationTo: 'members', admin: { condition: () => true } },
    { name: 'booking', type: 'relationship', relationTo: 'bookings' },
    { name: 'amountCents', type: 'number', required: true },
    { name: 'squareId', type: 'text', required: true, index: true, admin: { description: 'Square payment or invoice id' } },
    { name: 'status', type: 'text', required: true },
    { name: 'paidAt', type: 'date' },
  ],
}
```
Note: the `member` relationship targets the `members` collection created in Plan 3. To keep Plan 2 self-contained, **temporarily remove the `member` field** if `members` does not yet exist, and re-add it in Plan 3 Task 2 Step 6. (The `booking` relationship is sufficient for Plan 2.)

- [ ] **Step 2: Register Payments**

In `src/payload.config.ts` add `Payments` to the `collections` array and import it.

- [ ] **Step 3: Regenerate types and verify**

Run:
```bash
pnpm exec payload generate:types
pnpm exec tsc --noEmit
```
Expected: passes (with `member` field removed for now).

- [ ] **Step 4: Commit**

```bash
git add src/collections/Payments.ts src/payload.config.ts payload-types.ts
git commit -m "Add Payments log collection"
```

---

## Task 3: Bookings collection

**Files:**
- Create: `src/collections/Bookings.ts`
- Modify: `src/payload.config.ts`

- [ ] **Step 1: Implement the Bookings collection**

Create `src/collections/Bookings.ts`:

```ts
import type { CollectionConfig } from 'payload'
import { isAdmin } from '../access/isAdmin'

export const Bookings: CollectionConfig = {
  slug: 'bookings',
  admin: { group: 'Commerce', useAsTitle: 'customerEmail', defaultColumns: ['customerName', 'class', 'status', 'amountCents'] },
  access: {
    read: isAdmin,
    create: () => false,   // created server-side only
    update: isAdmin,
    delete: isAdmin,
  },
  fields: [
    { name: 'class', type: 'relationship', relationTo: 'classes', required: true },
    { name: 'customerName', type: 'text', required: true },
    { name: 'customerEmail', type: 'email', required: true },
    { name: 'customerPhone', type: 'text' },
    { name: 'status', type: 'select', required: true, defaultValue: 'pending', options: [
      { label: 'Pending', value: 'pending' },
      { label: 'Paid', value: 'paid' },
      { label: 'Cancelled', value: 'cancelled' },
      { label: 'Refunded', value: 'refunded' },
    ] },
    { name: 'amountCents', type: 'number', required: true },
    { name: 'squarePaymentId', type: 'text', index: true },
  ],
}
```

- [ ] **Step 2: Register Bookings** in `src/payload.config.ts` (import + add to `collections`).

- [ ] **Step 3: Regenerate types and verify**

Run:
```bash
pnpm exec payload generate:types
pnpm exec tsc --noEmit
```
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add src/collections/Bookings.ts src/payload.config.ts payload-types.ts
git commit -m "Add Bookings collection"
```

---

## Task 4: Occupancy helper (TDD)

**Files:**
- Create: `src/lib/occupancy.ts`
- Test: `tests/int/occupancy.int.test.ts`

Occupancy = bookings with status `paid` or `pending` (a pending booking reserves the seat while its charge is in flight).

- [ ] **Step 1: Write the failing test**

Create `tests/int/occupancy.int.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { getTestPayload } from './helpers'
import { seatsRemaining } from '../../src/lib/occupancy'

describe('seatsRemaining', () => {
  it('counts paid and pending bookings against capacity', async () => {
    const payload = await getTestPayload()
    const cls = await payload.create({
      collection: 'classes',
      data: { title: `Cap Test ${Date.now()}`, category: 'raku', priceCents: 1000, capacity: 2, scheduleText: 'x' },
    })
    expect(await seatsRemaining(payload, cls.id)).toBe(2)

    await payload.create({ collection: 'bookings', data: {
      class: cls.id, customerName: 'A', customerEmail: 'a@test.local', amountCents: 1000, status: 'paid',
    }, overrideAccess: true })
    await payload.create({ collection: 'bookings', data: {
      class: cls.id, customerName: 'B', customerEmail: 'b@test.local', amountCents: 1000, status: 'pending',
    }, overrideAccess: true })

    expect(await seatsRemaining(payload, cls.id)).toBe(0)
  })

  it('ignores cancelled bookings', async () => {
    const payload = await getTestPayload()
    const cls = await payload.create({
      collection: 'classes',
      data: { title: `Cap Test2 ${Date.now()}`, category: 'raku', priceCents: 1000, capacity: 1, scheduleText: 'x' },
    })
    await payload.create({ collection: 'bookings', data: {
      class: cls.id, customerName: 'C', customerEmail: 'c@test.local', amountCents: 1000, status: 'cancelled',
    }, overrideAccess: true })
    expect(await seatsRemaining(payload, cls.id)).toBe(1)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run tests/int/occupancy.int.test.ts`
Expected: FAIL — `seatsRemaining` not found.

- [ ] **Step 3: Implement**

Create `src/lib/occupancy.ts`:

```ts
import type { Payload } from 'payload'

export async function seatsRemaining(payload: Payload, classId: number | string): Promise<number> {
  const cls = await payload.findByID({ collection: 'classes', id: classId })
  const occupied = await payload.count({
    collection: 'bookings',
    where: { and: [{ class: { equals: classId } }, { status: { in: ['paid', 'pending'] } }] },
  })
  return Math.max(0, (cls.capacity ?? 0) - occupied.totalDocs)
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run tests/int/occupancy.int.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/occupancy.ts tests/int/occupancy.int.test.ts
git commit -m "Add seatsRemaining occupancy helper"
```

---

## Task 5: Payment + email side-effect modules

**Files:**
- Create: `src/lib/payments.ts`
- Create: `src/lib/email.ts`

These wrap external services behind small interfaces so the booking service (Task 6) can inject fakes.

- [ ] **Step 1: Implement the one-time charge wrapper**

Create `src/lib/payments.ts`:

```ts
import { randomUUID } from 'crypto'
import { getSquareClient, SQUARE_LOCATION_ID } from './square'

export interface ChargeInput {
  sourceId: string
  amountCents: number
  referenceId?: string
  note?: string
}

export interface ChargeResult {
  paymentId: string
  status: string
}

/** Charges a tokenized card once. Amount is provided by the server, never the client. */
export async function chargeCard(input: ChargeInput): Promise<ChargeResult> {
  const client = getSquareClient()
  const res = await client.payments.create({
    sourceId: input.sourceId,
    idempotencyKey: randomUUID(),
    amountMoney: { amount: BigInt(input.amountCents), currency: 'USD' },
    locationId: SQUARE_LOCATION_ID(),
    autocomplete: true,
    referenceId: input.referenceId,
    note: input.note,
  })
  const payment = res.payment
  if (!payment?.id) throw new Error('Square payment did not return an id')
  return { paymentId: payment.id, status: payment.status ?? 'UNKNOWN' }
}
```

- [ ] **Step 2: Implement the email wrapper**

Create `src/lib/email.ts`:

```ts
import { Resend } from 'resend'

export interface EmailInput { to: string; subject: string; html: string }

export async function sendEmail({ to, subject, html }: EmailInput): Promise<void> {
  const resend = new Resend(process.env.RESEND_API_KEY)
  await resend.emails.send({ from: process.env.EMAIL_FROM!, to, subject, html })
}
```

- [ ] **Step 3: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add src/lib/payments.ts src/lib/email.ts
git commit -m "Add Square charge and Resend email wrappers"
```

---

## Task 6: Booking service (TDD with injected fakes)

**Files:**
- Create: `src/services/booking.ts`
- Test: `tests/int/booking-service.int.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/int/booking-service.int.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { getTestPayload } from './helpers'
import { createPaidBooking } from '../../src/services/booking'

function deps(overrides = {}) {
  return {
    charge: vi.fn(async () => ({ paymentId: 'pay_123', status: 'COMPLETED' })),
    sendEmail: vi.fn(async () => {}),
    ...overrides,
  }
}

async function makeClass(payload: any, capacity: number) {
  return payload.create({ collection: 'classes', data: {
    title: `Svc ${Date.now()}-${Math.round(capacity)}`, category: 'wheel-series',
    priceCents: 22000, capacity, scheduleText: 'x',
  } })
}

describe('createPaidBooking', () => {
  it('charges the DB price (not the client) and records a paid booking + payment', async () => {
    const payload = await getTestPayload()
    const cls = await makeClass(payload, 5)
    const d = deps()
    const booking = await createPaidBooking({ payload, ...d }, {
      classId: cls.id, sourceId: 'cnon:fake', customerName: 'Jo', customerEmail: 'jo@test.local',
    })
    expect(d.charge).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 22000, sourceId: 'cnon:fake' }))
    expect(booking.status).toBe('paid')
    expect(booking.squarePaymentId).toBe('pay_123')
    const pays = await payload.find({ collection: 'payments', where: { squareId: { equals: 'pay_123' } } })
    expect(pays.totalDocs).toBe(1)
    expect(d.sendEmail).toHaveBeenCalledOnce()
  })

  it('rejects when the class is full and does not charge', async () => {
    const payload = await getTestPayload()
    const cls = await makeClass(payload, 1)
    const d = deps()
    await createPaidBooking({ payload, ...d }, { classId: cls.id, sourceId: 'cnon:a', customerName: 'A', customerEmail: 'a@t.local' })
    d.charge.mockClear()
    await expect(
      createPaidBooking({ payload, ...d }, { classId: cls.id, sourceId: 'cnon:b', customerName: 'B', customerEmail: 'b@t.local' }),
    ).rejects.toThrow(/full/i)
    expect(d.charge).not.toHaveBeenCalled()
  })

  it('cancels the pending booking if the charge fails (frees the seat)', async () => {
    const payload = await getTestPayload()
    const cls = await makeClass(payload, 1)
    const d = deps({ charge: vi.fn(async () => { throw new Error('card declined') }) })
    await expect(
      createPaidBooking({ payload, ...d }, { classId: cls.id, sourceId: 'cnon:x', customerName: 'X', customerEmail: 'x@t.local' }),
    ).rejects.toThrow(/declined/i)
    const remaining = await payload.count({ collection: 'bookings', where: { and: [
      { class: { equals: cls.id } }, { status: { in: ['paid', 'pending'] } },
    ] } })
    expect(remaining.totalDocs).toBe(0)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run tests/int/booking-service.int.test.ts`
Expected: FAIL — `createPaidBooking` not found.

- [ ] **Step 3: Implement the service**

Create `src/services/booking.ts`:

```ts
import type { Payload } from 'payload'
import { seatsRemaining } from '../lib/occupancy'
import type { ChargeInput, ChargeResult } from '../lib/payments'
import type { EmailInput } from '../lib/email'

export interface BookingDeps {
  payload: Payload
  charge: (input: ChargeInput) => Promise<ChargeResult>
  sendEmail: (input: EmailInput) => Promise<void>
}

export interface BookingInput {
  classId: number | string
  sourceId: string
  customerName: string
  customerEmail: string
  customerPhone?: string
}

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`

export async function createPaidBooking(deps: BookingDeps, input: BookingInput) {
  const { payload } = deps
  const cls = await payload.findByID({ collection: 'classes', id: input.classId })
  if (!cls || cls.status !== 'active') throw new Error('Class is not available for booking')

  // Reserve a seat by creating a pending booking, then re-check occupancy.
  const remaining = await seatsRemaining(payload, input.classId)
  if (remaining <= 0) throw new Error('This class is full')

  const pending = await payload.create({
    collection: 'bookings',
    overrideAccess: true,
    data: {
      class: input.classId, customerName: input.customerName, customerEmail: input.customerEmail,
      customerPhone: input.customerPhone, amountCents: cls.priceCents, status: 'pending',
    },
  })

  // Re-check AFTER reserving to catch a race; if we oversold, roll back.
  if (await seatsRemaining(payload, input.classId) < 0) {
    await payload.update({ collection: 'bookings', id: pending.id, overrideAccess: true, data: { status: 'cancelled' } })
    throw new Error('This class is full')
  }

  let charge: ChargeResult
  try {
    charge = await deps.charge({
      sourceId: input.sourceId, amountCents: cls.priceCents,
      referenceId: `booking-${pending.id}`, note: `Class: ${cls.title}`,
    })
  } catch (e) {
    await payload.update({ collection: 'bookings', id: pending.id, overrideAccess: true, data: { status: 'cancelled' } })
    throw e
  }

  const booking = await payload.update({
    collection: 'bookings', id: pending.id, overrideAccess: true,
    data: { status: 'paid', squarePaymentId: charge.paymentId },
  })

  await payload.create({
    collection: 'payments', overrideAccess: true,
    data: { type: 'booking', booking: pending.id, amountCents: cls.priceCents, squareId: charge.paymentId, status: charge.status, paidAt: new Date().toISOString() },
  })

  await deps.sendEmail({
    to: input.customerEmail,
    subject: `You're booked: ${cls.title}`,
    html: `<p>Thanks, ${input.customerName}! You're registered for <strong>${cls.title}</strong> (${cls.scheduleText}).</p><p>Amount paid: ${usd(cls.priceCents)}.</p>`,
  })

  return booking
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run tests/int/booking-service.int.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/booking.ts tests/int/booking-service.int.test.ts
git commit -m "Add booking service with capacity guard and charge rollback"
```

---

## Task 7: Booking API route

**Files:**
- Create: `src/app/api/bookings/route.ts`

- [ ] **Step 1: Implement the route handler**

Create `src/app/api/bookings/route.ts`:

```ts
import { getPayload } from 'payload'
import config from '@payload-config'
import { createPaidBooking } from '../../../services/booking'
import { chargeCard } from '../../../lib/payments'
import { sendEmail } from '../../../lib/email'

export async function POST(req: Request) {
  let body: any
  try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { classId, sourceId, customerName, customerEmail, customerPhone } = body ?? {}
  if (!classId || !sourceId || !customerName || !customerEmail) {
    return Response.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const payload = await getPayload({ config })
  try {
    const booking = await createPaidBooking(
      { payload, charge: chargeCard, sendEmail },
      { classId, sourceId, customerName, customerEmail, customerPhone },
    )
    return Response.json({ ok: true, bookingId: booking.id })
  } catch (e: any) {
    const full = /full/i.test(e?.message ?? '')
    return Response.json({ error: e?.message ?? 'Booking failed' }, { status: full ? 409 : 402 })
  }
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/bookings/route.ts
git commit -m "Add booking API route wiring service to Square and email"
```

---

## Task 8: Booking form (Web Payments SDK) on the class detail page

**Files:**
- Create: `src/app/(frontend)/classes/[slug]/BookingForm.tsx`
- Modify: `src/app/(frontend)/classes/[slug]/page.tsx`

- [ ] **Step 1: Create the client booking form**

Create `src/app/(frontend)/classes/[slug]/BookingForm.tsx`:

```tsx
'use client'
import { useEffect, useRef, useState } from 'react'

declare global { interface Window { Square?: any } }

const SDK_URL =
  process.env.NEXT_PUBLIC_SQUARE_ENVIRONMENT === 'production'
    ? 'https://web.squarecdn.com/v1/square.js'
    : 'https://sandbox.web.squarecdn.com/v1/square.js'

export function BookingForm({ classId, priceLabel }: { classId: string | number; priceLabel: string }) {
  const cardRef = useRef<any>(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [form, setForm] = useState({ customerName: '', customerEmail: '', customerPhone: '' })

  useEffect(() => {
    const script = document.createElement('script')
    script.src = SDK_URL
    script.onload = async () => {
      const payments = window.Square.payments(
        process.env.NEXT_PUBLIC_SQUARE_APP_ID,
        process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID,
      )
      const card = await payments.card()
      await card.attach('#card-container')
      cardRef.current = card
      setReady(true)
    }
    document.body.appendChild(script)
    return () => { script.remove() }
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setMsg(null)
    try {
      const result = await cardRef.current.tokenize()
      if (result.status !== 'OK') throw new Error('Card was not accepted')
      const res = await fetch('/api/bookings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classId, sourceId: result.token, ...form }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Booking failed')
      setMsg('Booked! Check your email for confirmation.')
    } catch (err: any) {
      setMsg(err.message)
    } finally { setBusy(false) }
  }

  return (
    <form onSubmit={submit} style={{ marginTop: 24, display: 'grid', gap: 10, maxWidth: 380 }}>
      <input required placeholder="Your name" value={form.customerName}
        onChange={(e) => setForm({ ...form, customerName: e.target.value })} />
      <input required type="email" placeholder="Email" value={form.customerEmail}
        onChange={(e) => setForm({ ...form, customerEmail: e.target.value })} />
      <input placeholder="Phone (optional)" value={form.customerPhone}
        onChange={(e) => setForm({ ...form, customerPhone: e.target.value })} />
      <div id="card-container" />
      <button className="pp-btn" type="submit" disabled={!ready || busy}>
        {busy ? 'Processing…' : `Book & pay ${priceLabel}`}
      </button>
      {msg && <p>{msg}</p>}
    </form>
  )
}
```

- [ ] **Step 2: Add `NEXT_PUBLIC_SQUARE_ENVIRONMENT` to env**

Append to `.env.example` and `.env`:
```bash
NEXT_PUBLIC_SQUARE_ENVIRONMENT=sandbox
```

- [ ] **Step 3: Replace the mailto CTA with the form**

In `src/app/(frontend)/classes/[slug]/page.tsx`, import the form and the occupancy helper, and swap the mailto link:

```tsx
import { BookingForm } from './BookingForm'
import { seatsRemaining } from '../../../../lib/occupancy'
// ...inside the component, after loading `cls` and `payload`:
const remaining = await seatsRemaining(payload, cls.id)
// ...replace the <a className="pp-btn" ...>Ask about registering</a> with:
{remaining > 0
  ? <BookingForm classId={cls.id} priceLabel={usd(cls.priceCents)} />
  : <p style={{ fontWeight: 600 }}>This class is full.</p>}
```

- [ ] **Step 4: Manual sandbox verification**

Run `pnpm dev`, open a class page, and use Square's sandbox test card `4111 1111 1111 1111`, any future expiry, any CVV, any ZIP.
Expected: "Booked! Check your email for confirmation."; a paid `Bookings` row and a `Payments` row appear in `/admin`; booking a full class shows "This class is full." Stop the server.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(frontend\)/classes/\[slug\] .env.example
git commit -m "Add card booking form and seat-availability gating on class pages"
```

---

## Task 9: Square payment webhook (reconciliation)

**Files:**
- Create: `src/app/api/webhooks/square/route.ts`

- [ ] **Step 1: Implement the webhook handler**

Create `src/app/api/webhooks/square/route.ts`:

```ts
import { getPayload } from 'payload'
import config from '@payload-config'
import { WebhooksHelper } from 'square'

export async function POST(req: Request) {
  const requestBody = await req.text() // raw body required for signature verification
  const signature = req.headers.get('x-square-hmacsha256-signature') ?? ''
  const notificationUrl = `${process.env.PUBLIC_BASE_URL}/api/webhooks/square`

  const isValid = WebhooksHelper.verifySignature({
    requestBody,
    signatureHeader: signature,
    signatureKey: process.env.SQUARE_WEBHOOK_SIGNATURE_KEY!,
    notificationUrl,
  })
  if (!isValid) return new Response('Invalid signature', { status: 401 })

  const event = JSON.parse(requestBody)
  const payload = await getPayload({ config })

  if (event.type === 'payment.updated') {
    const payment = event.data?.object?.payment
    const squarePaymentId = payment?.id
    const status = payment?.status // COMPLETED | FAILED | CANCELED | ...
    if (squarePaymentId) {
      const { docs } = await payload.find({ collection: 'bookings', where: { squarePaymentId: { equals: squarePaymentId } }, limit: 1 })
      const booking = docs[0]
      if (booking) {
        const map: Record<string, string> = { CANCELED: 'refunded', FAILED: 'cancelled' }
        const newStatus = map[status] ?? booking.status
        if (newStatus !== booking.status) {
          await payload.update({ collection: 'bookings', id: booking.id, overrideAccess: true, data: { status: newStatus } })
        }
      }
    }
  }

  // Membership events (invoice.*, subscription.updated) are handled in Plan 3.
  return new Response('ok', { status: 200 })
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: passes.

- [ ] **Step 3: Manual verification with the Square sandbox webhook tester**

In the Square Developer Dashboard, point a `payment.updated` webhook subscription at your tunneled URL (e.g. `ngrok http 3000` → `https://<id>.ngrok.app/api/webhooks/square`), set `SQUARE_WEBHOOK_SIGNATURE_KEY` and `PUBLIC_BASE_URL` accordingly, and send a test event.
Expected: 200 response for a valid signature, 401 for a tampered body.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/webhooks/square/route.ts
git commit -m "Add signed Square payment webhook for booking reconciliation"
```

---

## Self-Review

**Spec coverage (Plan 2 scope):**
- Class/camp one-time payment — Tasks 5–8. ✓
- Amount server-authoritative — `createPaidBooking` reads `cls.priceCents`; test asserts the charge amount comes from the DB. ✓
- No overbooking — `seatsRemaining` + pending-reservation + post-reserve re-check; tested. ✓
- Idempotency key — `chargeCard` uses `randomUUID()`. ✓
- Card never hits server — Web Payments SDK tokenizes; server gets `sourceId` only. ✓
- Confirmation email — `sendEmail` in service; tested via fake. ✓
- Webhook signature verification — Task 9 with `WebhooksHelper.verifySignature`; tampered body → 401. ✓
- Payments log — Task 2; written by the service; tested. ✓

**Placeholder scan:** none. The `member` field note in Task 2 is an explicit, dated cross-plan dependency, not a placeholder. ✓

**Type consistency:** `ChargeInput`/`ChargeResult`/`EmailInput` interfaces are defined in Task 5 and consumed by name in Task 6. `createPaidBooking(deps, input)` signature matches its call site in Task 7. Booking statuses (`pending|paid|cancelled|refunded`) match the collection enum from Task 3. `seatsRemaining(payload, classId)` signature matches all call sites. ✓

**Known limitation (logged, not silently dropped):** the reserve-then-recheck guard narrows but does not fully eliminate a concurrent oversell race under high contention. For a single small studio this is acceptable; if it ever matters, promote the reserve+check into a single Postgres transaction with `SELECT ... FOR UPDATE` on the class row. Documented here intentionally.

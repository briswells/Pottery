# Portside Pottery — Plan 3: Membership & Recurring Subscriptions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a visitor sign up for the $200/month membership online — creating a Square customer, card on file, and recurring subscription — and give staff a members admin that always shows current status, shelf, and recent-payment state, kept truthful by Square webhooks.

**Architecture:** A `Members` auth-enabled collection is the record (and the foundation for the Plan-? member portal). A dependency-injected membership service performs the Square customer→card→subscription sequence and is unit-tested with a fake gateway. Webhooks update `Members` (`subscriptionStatus`, `lastPaymentDate/Status`) and append `Payments` rows. A failed renewal flags the member "past due" and notifies staff + member — no automatic lockout. Staff cancel/pause by changing `status` in the admin, which an `afterChange` hook propagates to Square.

**Tech Stack:** Square Node SDK (customers, cards, subscriptions, catalog), Payload auth + hooks, Resend, Vitest.

**Depends on:** Plan 1 (app, access helpers, email) and Plan 2 (Square client, `Payments` collection, webhook route, email wrapper).

**Commit identity:** repo-local `briswells <briswells@gmail.com>`. **No AI attribution in commit messages.**

---

## File Structure (added/modified by this plan)

```
src/
├── collections/
│   ├── Members.ts                 # NEW: auth-enabled member records
│   └── Payments.ts                # MODIFY: re-add `member` relationship
├── lib/
│   └── membership-gateway.ts      # NEW: real Square customer/card/subscription calls
├── services/
│   └── membership.ts              # NEW: createMembership() — injectable, unit-tested
├── hooks/
│   └── cancelSquareSubscription.ts# NEW: afterChange propagates cancel/pause to Square
└── app/
    ├── api/
    │   ├── membership/route.ts            # NEW: POST signup
    │   └── webhooks/square/route.ts       # MODIFY: handle invoice/subscription events
    └── (frontend)/membership/
        ├── page.tsx                        # MODIFY: render signup form
        └── MembershipForm.tsx              # NEW: client Web Payments SDK form
tests/int/
└── membership-service.int.test.ts          # NEW
```

---

## Task 1: Membership plan configuration

**Files:**
- Modify: `.env.example`, `.env`

Square recurring billing needs a Catalog **subscription plan variation**. Create it once in the Square Dashboard (Subscriptions → create a plan: "Studio Membership", $200.00/month), then copy its **plan variation ID** here. (It can also be created via the Catalog API, but the one-time Dashboard setup is simpler and less error-prone.)

- [ ] **Step 1: Add env vars**

Append to `.env.example` (and set the real Sandbox value in `.env`):
```bash
# Square subscription plan variation id for the $200/mo membership
SQUARE_MEMBERSHIP_PLAN_VARIATION_ID=replace-with-plan-variation-id
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "Add Square membership plan variation env var"
```

---

## Task 2: Members collection (+ re-add Payments.member)

**Files:**
- Create: `src/collections/Members.ts`
- Modify: `src/collections/Payments.ts`
- Modify: `src/payload.config.ts`

- [ ] **Step 1: Implement the Members collection**

Create `src/collections/Members.ts`:

```ts
import type { CollectionConfig } from 'payload'
import { isAdmin } from '../access/isAdmin'
import { isAdminOrEditor } from '../access/isAdminOrEditor'

export const Members: CollectionConfig = {
  slug: 'members',
  auth: true, // foundation for the future member portal; staff-managed for now
  admin: {
    group: 'People',
    useAsTitle: 'name',
    defaultColumns: ['name', 'status', 'shelfLabel', 'subscriptionStatus', 'lastPaymentDate'],
  },
  access: {
    read: isAdminOrEditor,
    create: isAdminOrEditor,
    update: isAdminOrEditor,
    delete: isAdmin,
  },
  fields: [
    { name: 'name', type: 'text', required: true },
    // email/password are provided by `auth: true`
    { name: 'phone', type: 'text' },
    { name: 'status', type: 'select', required: true, defaultValue: 'active', options: [
      { label: 'Active', value: 'active' },
      { label: 'Past due', value: 'past_due' },
      { label: 'Paused', value: 'paused' },
      { label: 'Cancelled', value: 'cancelled' },
    ] },
    { name: 'joinedDate', type: 'date' },
    { name: 'shelfLabel', type: 'text', admin: { description: 'e.g. "Shelf B-12"' } },
    { name: 'notes', type: 'textarea' },
    // Square linkage
    { name: 'squareCustomerId', type: 'text', index: true, admin: { readOnly: true } },
    { name: 'squareSubscriptionId', type: 'text', index: true, admin: { readOnly: true } },
    { name: 'subscriptionStatus', type: 'text', admin: { readOnly: true } },
    { name: 'lastPaymentDate', type: 'date', admin: { readOnly: true } },
    { name: 'lastPaymentStatus', type: 'text', admin: { readOnly: true } },
  ],
}
```

- [ ] **Step 2: Re-add the `member` relationship to Payments**

In `src/collections/Payments.ts`, ensure this field is present (it was removed for Plan 2 self-containment):

```ts
{ name: 'member', type: 'relationship', relationTo: 'members' },
```

- [ ] **Step 3: Register Members** in `src/payload.config.ts` (import + add to `collections`, before or after `Users` — order is cosmetic).

- [ ] **Step 4: Regenerate types and verify**

Run:
```bash
pnpm exec payload generate:types
pnpm exec tsc --noEmit
pnpm dev
```
Expected: `/admin` shows "Members" under People with the listed columns; the Payments `member` relationship resolves. Stop the server.

- [ ] **Step 5: Commit**

```bash
git add src/collections/Members.ts src/collections/Payments.ts src/payload.config.ts payload-types.ts
git commit -m "Add Members collection and link Payments to members"
```

---

## Task 3: Membership gateway (real Square calls)

**Files:**
- Create: `src/lib/membership-gateway.ts`

This isolates the Square customer/card/subscription calls behind an interface the service can fake.

- [ ] **Step 1: Implement the gateway**

Create `src/lib/membership-gateway.ts`:

```ts
import { randomUUID } from 'crypto'
import { getSquareClient, SQUARE_LOCATION_ID } from './square'

export interface MembershipGateway {
  createCustomer(input: { name: string; email: string; phone?: string }): Promise<{ customerId: string }>
  saveCard(input: { customerId: string; sourceId: string }): Promise<{ cardId: string }>
  createSubscription(input: { customerId: string; cardId: string }): Promise<{ subscriptionId: string; status: string }>
}

export const squareMembershipGateway: MembershipGateway = {
  async createCustomer({ name, email, phone }) {
    const client = getSquareClient()
    const res = await client.customers.create({
      idempotencyKey: randomUUID(),
      givenName: name,
      emailAddress: email,
      phoneNumber: phone,
    })
    const id = res.customer?.id
    if (!id) throw new Error('Square customer was not created')
    return { customerId: id }
  },

  async saveCard({ customerId, sourceId }) {
    const client = getSquareClient()
    const res = await client.cards.create({
      idempotencyKey: randomUUID(),
      sourceId,
      card: { customerId },
    })
    const id = res.card?.id
    if (!id) throw new Error('Square card was not saved')
    return { cardId: id }
  },

  async createSubscription({ customerId, cardId }) {
    const client = getSquareClient()
    const res = await client.subscriptions.create({
      idempotencyKey: randomUUID(),
      locationId: SQUARE_LOCATION_ID(),
      planVariationId: process.env.SQUARE_MEMBERSHIP_PLAN_VARIATION_ID!,
      customerId,
      cardId,
    })
    const sub = res.subscription
    if (!sub?.id) throw new Error('Square subscription was not created')
    return { subscriptionId: sub.id, status: sub.status ?? 'ACTIVE' }
  },
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/lib/membership-gateway.ts
git commit -m "Add Square membership gateway (customer, card, subscription)"
```

---

## Task 4: Membership service (TDD with a fake gateway)

**Files:**
- Create: `src/services/membership.ts`
- Test: `tests/int/membership-service.int.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/int/membership-service.int.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { getTestPayload } from './helpers'
import { createMembership } from '../../src/services/membership'

function fakeGateway(overrides = {}) {
  return {
    createCustomer: vi.fn(async () => ({ customerId: 'cus_1' })),
    saveCard: vi.fn(async () => ({ cardId: 'card_1' })),
    createSubscription: vi.fn(async () => ({ subscriptionId: 'sub_1', status: 'ACTIVE' })),
    ...overrides,
  }
}

describe('createMembership', () => {
  it('creates a customer, card, subscription, and an active Member', async () => {
    const payload = await getTestPayload()
    const gw = fakeGateway()
    const sendEmail = vi.fn(async () => {})
    const member = await createMembership({ payload, gateway: gw, sendEmail }, {
      name: 'Pat', email: `pat-${Date.now()}@test.local`, phone: '555', sourceId: 'cnon:fake',
    })
    expect(gw.createCustomer).toHaveBeenCalledOnce()
    expect(gw.saveCard).toHaveBeenCalledWith(expect.objectContaining({ customerId: 'cus_1', sourceId: 'cnon:fake' }))
    expect(gw.createSubscription).toHaveBeenCalledWith(expect.objectContaining({ customerId: 'cus_1', cardId: 'card_1' }))
    expect(member.status).toBe('active')
    expect(member.squareSubscriptionId).toBe('sub_1')
    expect(member.subscriptionStatus).toBe('ACTIVE')
    expect(sendEmail).toHaveBeenCalledOnce()
  })

  it('does not create a Member if the subscription call fails', async () => {
    const payload = await getTestPayload()
    const email = `fail-${Date.now()}@test.local`
    const gw = fakeGateway({ createSubscription: vi.fn(async () => { throw new Error('subscription failed') }) })
    await expect(
      createMembership({ payload, gateway: gw, sendEmail: vi.fn(async () => {}) }, { name: 'No', email, sourceId: 'cnon:x' }),
    ).rejects.toThrow(/subscription failed/i)
    const found = await payload.find({ collection: 'members', where: { email: { equals: email } } })
    expect(found.totalDocs).toBe(0)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run tests/int/membership-service.int.test.ts`
Expected: FAIL — `createMembership` not found.

- [ ] **Step 3: Implement the service**

Create `src/services/membership.ts`:

```ts
import type { Payload } from 'payload'
import type { MembershipGateway } from '../lib/membership-gateway'
import type { EmailInput } from '../lib/email'

export interface MembershipDeps {
  payload: Payload
  gateway: MembershipGateway
  sendEmail: (input: EmailInput) => Promise<void>
}

export interface MembershipInput {
  name: string
  email: string
  phone?: string
  sourceId: string
  password?: string // optional now; member sets/uses it when the portal launches
}

export async function createMembership(deps: MembershipDeps, input: MembershipInput) {
  const { payload, gateway } = deps

  // Square side first — if any step throws, no Member row is written.
  const { customerId } = await gateway.createCustomer({ name: input.name, email: input.email, phone: input.phone })
  const { cardId } = await gateway.saveCard({ customerId, sourceId: input.sourceId })
  const { subscriptionId, status } = await gateway.createSubscription({ customerId, cardId })

  const member = await payload.create({
    collection: 'members',
    overrideAccess: true,
    data: {
      name: input.name,
      email: input.email,
      password: input.password ?? randomPassword(),
      phone: input.phone,
      status: 'active',
      joinedDate: new Date().toISOString(),
      squareCustomerId: customerId,
      squareSubscriptionId: subscriptionId,
      subscriptionStatus: status,
    },
  })

  await deps.sendEmail({
    to: input.email,
    subject: 'Welcome to Portside Pottery',
    html: `<p>Welcome, ${input.name}! Your $200/month studio membership is active. Stop by and we'll get you set up with a shelf.</p>`,
  })

  return member
}

function randomPassword(): string {
  // Members don't log in yet; a strong placeholder password satisfies the auth collection.
  return require('crypto').randomBytes(24).toString('hex')
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run tests/int/membership-service.int.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/membership.ts tests/int/membership-service.int.test.ts
git commit -m "Add membership service creating Square subscription and Member"
```

---

## Task 5: Membership API route

**Files:**
- Create: `src/app/api/membership/route.ts`

- [ ] **Step 1: Implement the route**

Create `src/app/api/membership/route.ts`:

```ts
import { getPayload } from 'payload'
import config from '@payload-config'
import { createMembership } from '../../../services/membership'
import { squareMembershipGateway } from '../../../lib/membership-gateway'
import { sendEmail } from '../../../lib/email'

export async function POST(req: Request) {
  let body: any
  try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { name, email, phone, sourceId } = body ?? {}
  if (!name || !email || !sourceId) return Response.json({ error: 'Missing required fields' }, { status: 400 })

  const payload = await getPayload({ config })

  // Block duplicate active memberships for the same email.
  const existing = await payload.find({ collection: 'members', where: { email: { equals: email } }, limit: 1 })
  if (existing.totalDocs > 0) return Response.json({ error: 'A membership already exists for this email' }, { status: 409 })

  try {
    const member = await createMembership(
      { payload, gateway: squareMembershipGateway, sendEmail },
      { name, email, phone, sourceId },
    )
    return Response.json({ ok: true, memberId: member.id })
  } catch (e: any) {
    return Response.json({ error: e?.message ?? 'Membership signup failed' }, { status: 402 })
  }
}
```

- [ ] **Step 2: Type-check** — `pnpm exec tsc --noEmit` (expected: passes).

- [ ] **Step 3: Commit**

```bash
git add src/app/api/membership/route.ts
git commit -m "Add membership signup API route"
```

---

## Task 6: Membership signup form

**Files:**
- Create: `src/app/(frontend)/membership/MembershipForm.tsx`
- Modify: `src/app/(frontend)/membership/page.tsx`

- [ ] **Step 1: Create the client form**

Create `src/app/(frontend)/membership/MembershipForm.tsx`:

```tsx
'use client'
import { useEffect, useRef, useState } from 'react'

declare global { interface Window { Square?: any } }

const SDK_URL =
  process.env.NEXT_PUBLIC_SQUARE_ENVIRONMENT === 'production'
    ? 'https://web.squarecdn.com/v1/square.js'
    : 'https://sandbox.web.squarecdn.com/v1/square.js'

export function MembershipForm({ priceLabel }: { priceLabel: string }) {
  const cardRef = useRef<any>(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', email: '', phone: '' })

  useEffect(() => {
    const script = document.createElement('script')
    script.src = SDK_URL
    script.onload = async () => {
      const payments = window.Square.payments(
        process.env.NEXT_PUBLIC_SQUARE_APP_ID,
        process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID,
      )
      const card = await payments.card()
      await card.attach('#membership-card')
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
      const res = await fetch('/api/membership', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, sourceId: result.token }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Signup failed')
      setMsg("You're a member! Check your email — see you at the studio.")
    } catch (err: any) {
      setMsg(err.message)
    } finally { setBusy(false) }
  }

  return (
    <form onSubmit={submit} style={{ marginTop: 24, display: 'grid', gap: 10, maxWidth: 380 }}>
      <input required placeholder="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      <input required type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      <input placeholder="Phone (optional)" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
      <div id="membership-card" />
      <button className="pp-btn" type="submit" disabled={!ready || busy}>
        {busy ? 'Processing…' : `Join — ${priceLabel}`}
      </button>
      {msg && <p>{msg}</p>}
    </form>
  )
}
```

- [ ] **Step 2: Render the form on the membership page**

In `src/app/(frontend)/membership/page.tsx`, import `MembershipForm` and replace the mailto link:

```tsx
import { MembershipForm } from './MembershipForm'
// replace the <a className="pp-btn" ...>Ask about membership</a> with:
<MembershipForm priceLabel={m.priceLabel} />
```

- [ ] **Step 3: Manual sandbox verification**

Run `pnpm dev`, open `/membership`, submit with sandbox test card `4111 1111 1111 1111`.
Expected: success message; a new active `Members` row with `squareCustomerId`/`squareSubscriptionId` set; an active subscription visible in the Square sandbox dashboard. Stop the server.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(frontend\)/membership
git commit -m "Add membership signup form to the membership page"
```

---

## Task 7: Subscription webhooks (payment status → Member truth)

**Files:**
- Modify: `src/app/api/webhooks/square/route.ts`

Extend the existing (signature-verified) handler with membership branches. Exact failure-event semantics should be confirmed against the Square webhook catalog during implementation (logged as an open item in the spec §11); the structure below maps the events we rely on.

- [ ] **Step 1: Add a helper to find a member by Square ids**

At the top of the webhook file (after imports), add:

```ts
async function findMemberBySubscription(payload: any, subscriptionId?: string) {
  if (!subscriptionId) return null
  const { docs } = await payload.find({ collection: 'members', where: { squareSubscriptionId: { equals: subscriptionId } }, limit: 1 })
  return docs[0] ?? null
}
```

- [ ] **Step 2: Add the membership event branches**

Inside `POST`, after the existing `payment.updated` block and before `return new Response('ok'...)`, add:

```ts
if (event.type === 'invoice.payment_made') {
  const invoice = event.data?.object?.invoice
  const subscriptionId = invoice?.subscriptionId
  const member = await findMemberBySubscription(payload, subscriptionId)
  if (member) {
    await payload.update({ collection: 'members', id: member.id, overrideAccess: true, data: {
      status: 'active', subscriptionStatus: 'ACTIVE',
      lastPaymentDate: new Date().toISOString(), lastPaymentStatus: 'PAID',
    } })
    await payload.create({ collection: 'payments', overrideAccess: true, data: {
      type: 'membership', member: member.id, amountCents: 20000,
      squareId: invoice?.id ?? `inv-${Date.now()}`, status: 'PAID', paidAt: new Date().toISOString(),
    } })
  }
}

if (event.type === 'invoice.updated') {
  const invoice = event.data?.object?.invoice
  const status = invoice?.status // e.g. UNPAID, PAYMENT_PENDING, CANCELED
  if (status === 'UNPAID' || status === 'PAYMENT_PENDING') {
    const member = await findMemberBySubscription(payload, invoice?.subscriptionId)
    if (member && member.status !== 'past_due') {
      await payload.update({ collection: 'members', id: member.id, overrideAccess: true, data: {
        status: 'past_due', lastPaymentStatus: 'FAILED',
      } })
      // Notify staff + member; no automatic lockout (per design decision).
      await sendEmail({ to: process.env.STAFF_NOTIFY_EMAIL!, subject: `Membership payment failed: ${member.name}`,
        html: `<p>${member.name} (${member.email}) has a failed/overdue membership payment. Square will retry; follow up as needed.</p>` })
      await sendEmail({ to: member.email, subject: 'Your Portside Pottery payment needs attention',
        html: `<p>Hi ${member.name}, we couldn't process your latest membership payment. Please update your card or contact the studio. Your access is unchanged for now.</p>` })
    }
  }
}

if (event.type === 'subscription.updated') {
  const sub = event.data?.object?.subscription
  const member = await findMemberBySubscription(payload, sub?.id)
  if (member && sub?.status) {
    const map: Record<string, string> = { ACTIVE: 'active', PAUSED: 'paused', CANCELED: 'cancelled', DEACTIVATED: 'cancelled' }
    await payload.update({ collection: 'members', id: member.id, overrideAccess: true, data: {
      subscriptionStatus: sub.status, status: map[sub.status] ?? member.status,
    } })
  }
}
```

- [ ] **Step 3: Import `sendEmail` and add `STAFF_NOTIFY_EMAIL`**

At the top of the webhook file add `import { sendEmail } from '../../../../lib/email'`. Append to `.env.example` and `.env`:
```bash
STAFF_NOTIFY_EMAIL=getcreative@portsidepottery.com
```

- [ ] **Step 4: Type-check** — `pnpm exec tsc --noEmit` (expected: passes).

- [ ] **Step 5: Manual verification with sandbox webhook tester**

Send sample `invoice.payment_made`, `invoice.updated` (status UNPAID), and `subscription.updated` events to the tunneled webhook URL (signed).
Expected: a matching member's `subscriptionStatus`/`status`/`lastPayment*` update; a `Payments` row on payment-made; staff + member emails on the UNPAID event.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/webhooks/square/route.ts .env.example
git commit -m "Handle membership invoice and subscription webhooks; flag past-due"
```

---

## Task 8: Staff cancel/pause propagates to Square

**Files:**
- Create: `src/hooks/cancelSquareSubscription.ts`
- Modify: `src/collections/Members.ts`

When staff set a member's `status` to `cancelled` or `paused` in the admin, propagate that to Square.

- [ ] **Step 1: Implement the afterChange hook**

Create `src/hooks/cancelSquareSubscription.ts`:

```ts
import type { CollectionAfterChangeHook } from 'payload'
import { getSquareClient } from '../lib/square'

/** When a member is set to cancelled/paused in the admin, reflect it in Square. */
export const cancelSquareSubscription: CollectionAfterChangeHook = async ({ doc, previousDoc, operation }) => {
  if (operation !== 'update') return doc
  const becameCancelled = doc.status === 'cancelled' && previousDoc?.status !== 'cancelled'
  const becamePaused = doc.status === 'paused' && previousDoc?.status !== 'paused'
  if (!doc.squareSubscriptionId || (!becameCancelled && !becamePaused)) return doc

  const client = getSquareClient()
  try {
    if (becameCancelled) await client.subscriptions.cancel({ subscriptionId: doc.squareSubscriptionId })
    if (becamePaused) await client.subscriptions.pause({ subscriptionId: doc.squareSubscriptionId, body: {} })
  } catch (e) {
    // Surface but don't crash the admin save; staff can retry.
    console.error('Failed to propagate membership status to Square:', e)
  }
  return doc
}
```
Note: confirm the exact `subscriptions.pause` request shape against the installed SDK version during implementation; `cancel` takes `{ subscriptionId }`.

- [ ] **Step 2: Wire the hook into Members**

In `src/collections/Members.ts` add:

```ts
import { cancelSquareSubscription } from '../hooks/cancelSquareSubscription'
// inside the collection config:
hooks: { afterChange: [cancelSquareSubscription] },
```

- [ ] **Step 3: Type-check** — `pnpm exec tsc --noEmit` (expected: passes).

- [ ] **Step 4: Manual verification**

In `/admin`, change a sandbox member's `status` to `cancelled`.
Expected: the corresponding subscription is canceled in the Square sandbox dashboard; admin save succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/cancelSquareSubscription.ts src/collections/Members.ts
git commit -m "Propagate staff cancel/pause of a member to Square"
```

---

## Self-Review

**Spec coverage (Plan 3 scope):**
- Recurring $200/mo membership via Square subscriptions (customer + card on file + subscription) — Tasks 3–6. ✓
- Members record with status, shelf, payment fields — Task 2. ✓
- Auth foundation for member portal — `Members` is `auth: true` (portal UI deferred to a later plan). ✓
- Webhooks keep `Members` truthful (`subscriptionStatus`, `lastPaymentDate/Status`) + `Payments` history — Task 7. ✓
- Failed payment → flag past-due + notify staff and member, no auto-lockout — Task 7 `invoice.updated` branch. ✓ (matches the design decision exactly)
- Staff pause/cancel from admin → Square — Task 8. ✓
- Members admin sortable/filterable with overdue visible — `defaultColumns` include `status`, `subscriptionStatus`, `lastPaymentDate`; Payload list view sorts/filters these. ✓

**Placeholder scan:** none. The `member` re-add (Task 2) and the membership-plan Dashboard setup (Task 1) are explicit setup steps, not placeholders. Two "confirm against the installed SDK" notes (pause shape; failure event names) are genuine, spec-acknowledged open items (§11), not vague hand-waving. ✓

**Type consistency:** `MembershipGateway` interface (Task 3) is consumed by `createMembership` (Task 4) and implemented by `squareMembershipGateway` used in the route (Task 5). Member statuses (`active|past_due|paused|cancelled`) are consistent across the collection, service, webhooks, and cancel hook. `EmailInput` reused from Plan 2. ✓

**Hardcoded amount note:** the membership `Payments` row uses `amountCents: 20000` ($200). If the plan price ever changes, read it from the invoice's `paymentRequests`/`computedAmountMoney` instead. Documented here so it isn't a silent assumption.

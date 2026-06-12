# Person Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve the `members` collection into a single per-human `people` collection, link bookings and firing-requests to a Person, and backfill existing data — so every class-taker, firing customer, and member is one record and "member" just means "has a plan."

**Architecture:** Rename the `members` slug to `people` (it stays the auth collection); membership is derived from having a `plan` (no separate flag). A new `upsertPersonByEmail` service is the find-or-create seam reused by the booking path, the firing path, a one-time backfill script, and (later) the Square sync. Bookings and firing-requests keep their inline customer snapshot fields and gain a nullable `person` link. A single hand-authored, data-preserving migration handles the table rename + new `person` columns for production (tests use Payload `push`, so they don't need it).

**Tech Stack:** Payload 3.85 (Postgres adapter), Next.js 16, Square SDK, Vitest integration tests against a dedicated `portside_test` DB.

**Spec:** `docs/superpowers/specs/2026-06-12-person-foundation-design.md`

---

## File Structure

- `src/collections/People.ts` — renamed from `Members.ts`; slug `people`, auth, membership fields conditional on `plan`.
- `src/collections/Payments.ts` — `member` relationship `relationTo` → `people`.
- `src/collections/Bookings.ts` — add nullable `person` relationship.
- `src/collections/FiringRequests.ts` — add nullable `person` relationship.
- `src/services/people.ts` — **new**; `upsertPersonByEmail` find-or-create.
- `src/services/booking.ts` — wire `upsertPersonByEmail` into `createPaidBooking`.
- `src/services/firing-invoice.ts` — wire `upsertPersonByEmail` into `createAndSendFiringInvoice`.
- `src/services/membership.ts`, `src/services/membership-cancel.ts`, `src/hooks/cancelSquareSubscriptionOnDelete.ts`, `src/hooks/reconcileMemberSubscription.ts`, `src/app/api/webhooks/square/route.ts`, `scripts/import-square-members.ts` — update `collection: 'members'` → `'people'` and the `Member` type → `Person`.
- `src/payload.config.ts` — import `People` instead of `Members`.
- `scripts/backfill-people.ts` — **new**; one-time idempotent backfill.
- `src/migrations/<generated>_person_foundation.ts` — **new**; hand-authored rename + `person` columns.
- Tests: `tests/int/people-upsert.int.spec.ts`, `tests/int/backfill-people.int.spec.ts`, plus additions to `tests/int/booking-service.int.spec.ts` and a new firing test.

---

## Task 1: Rename `members` collection → `people`

This is one atomic refactor — the slug, every string reference, and the generated `Member` type all change together, so the build stays green only when done as a unit.

**Files:**
- Create: `src/collections/People.ts` (from `src/collections/Members.ts`)
- Delete: `src/collections/Members.ts`
- Modify: `src/payload.config.ts`, `src/collections/Payments.ts`, `src/services/membership.ts`, `src/services/membership-cancel.ts`, `src/hooks/cancelSquareSubscriptionOnDelete.ts`, `src/hooks/reconcileMemberSubscription.ts`, `src/app/api/webhooks/square/route.ts`, `scripts/import-square-members.ts`

- [ ] **Step 1: Create `src/collections/People.ts`**

```ts
import type { CollectionConfig } from 'payload'
import { isAdmin } from '../access/isAdmin'
import { isAdminOrEditor } from '../access/isAdminOrEditor'
import { cancelSquareSubscription } from '../hooks/cancelSquareSubscription'
import { cancelSquareSubscriptionOnDelete } from '../hooks/cancelSquareSubscriptionOnDelete'
import { reconcileMemberSubscription } from '../hooks/reconcileMemberSubscription'

// One record per human. Everyone who interacts with the studio (class booking,
// firing request, membership) is a Person; "being a member" means having a `plan`.
// Still the auth collection (local strategy disabled — no member login yet).
export const People: CollectionConfig = {
  slug: 'people',
  labels: { singular: 'Person', plural: 'People' },
  auth: { disableLocalStrategy: { enableFields: true, optionalPassword: true } },
  admin: {
    group: 'People',
    useAsTitle: 'name',
    defaultColumns: ['name', 'plan', 'status', 'shelfLabel', 'subscriptionStatus'],
  },
  access: {
    read: isAdminOrEditor,
    create: isAdminOrEditor,
    update: isAdminOrEditor,
    delete: isAdmin,
  },
  hooks: {
    afterChange: [reconcileMemberSubscription, cancelSquareSubscription],
    beforeDelete: [cancelSquareSubscriptionOnDelete],
  },
  fields: [
    { name: 'name', type: 'text', required: true },
    {
      name: 'plan',
      type: 'relationship',
      relationTo: 'membership-plans',
      hasMany: false,
      // Optional: a person need not be a member. Assigning a plan makes them one
      // (the reconcile hook then provisions a Square subscription). Leave empty
      // for a non-member contact (class-taker, firing customer).
      admin: { description: 'Assign a plan to make this person a member; leave empty for a non-member contact.' },
    },
    // email is provided by the auth config (local login disabled — see `auth` above)
    { name: 'phone', type: 'text' },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'none',
      label: 'Membership status',
      admin: { condition: (data) => Boolean(data?.plan) },
      options: [
        { label: 'Not a member', value: 'none' },
        { label: 'Active', value: 'active' },
        { label: 'Past due', value: 'past_due' },
        { label: 'Paused', value: 'paused' },
        { label: 'Cancelled', value: 'cancelled' },
      ],
    },
    { name: 'joinedDate', type: 'date' },
    { name: 'shelfLabel', type: 'text', admin: { description: 'e.g. "Shelf B-12"', condition: (data) => Boolean(data?.plan) } },
    { name: 'notes', type: 'textarea' },
    // Square linkage
    { name: 'squareCustomerId', type: 'text', index: true, admin: { readOnly: true } },
    { name: 'squareSubscriptionId', type: 'text', index: true, admin: { readOnly: true, condition: (data) => Boolean(data?.plan) } },
    { name: 'subscriptionStatus', type: 'text', admin: { readOnly: true, condition: (data) => Boolean(data?.plan) } },
    { name: 'lastPaymentDate', type: 'date', admin: { readOnly: true, condition: (data) => Boolean(data?.plan) } },
    { name: 'lastPaymentStatus', type: 'text', admin: { readOnly: true, condition: (data) => Boolean(data?.plan) } },
    // Internal: single-use, expiring token for passwordless self-serve cancellation.
    { name: 'cancelTokenHash', type: 'text', admin: { hidden: true } },
    { name: 'cancelTokenExpiresAt', type: 'date', admin: { hidden: true } },
  ],
}
```

- [ ] **Step 2: Delete the old collection file**

```bash
rm src/collections/Members.ts
```

- [ ] **Step 3: Update `src/payload.config.ts`**

Change the import (line ~10) and the `collections` array (line ~51):

```ts
import { People } from './collections/People'
```
```ts
  collections: [Users, People, MembershipPlans, Media, Classes, Bookings, Payments, FiringRequests],
```

- [ ] **Step 4: Update `Payments.ts` relationTo** (`src/collections/Payments.ts:19`)

```ts
    { name: 'member', type: 'relationship', relationTo: 'people', admin: { description: 'Set for membership payments' } },
```

- [ ] **Step 5: Update every `collection: 'members'` string to `'people'`**

In these exact locations:
- `src/services/membership.ts:28` and `:99`
- `src/services/membership-cancel.ts:29`, `:39`, `:62`, `:94`
- `src/hooks/cancelSquareSubscriptionOnDelete.ts:15`
- `src/app/api/webhooks/square/route.ts:49`, `:78`, `:115`, `:134`
- `scripts/import-square-members.ts:56`, `:73`

```bash
grep -rln "collection: 'members'" src scripts
# edit each to: collection: 'people'
```

Verify none remain:

```bash
grep -rn "'members'" src scripts | grep -v payload-types
# expected: no output
```

- [ ] **Step 6: Update the `Member` type to `Person`** (`src/hooks/reconcileMemberSubscription.ts`)

Line 4 and line 13:

```ts
import type { Person } from '../payload-types'
```
```ts
export const reconcileMemberSubscription: CollectionAfterChangeHook<Person> = async ({ doc, previousDoc, operation, req }) => {
```

- [ ] **Step 7: Regenerate Payload types**

```bash
pnpm generate:types
```
Expected: `src/payload-types.ts` now exports `Person` and a `people` collection; `Member`/`members` are gone.

- [ ] **Step 8: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: PASS (no references to a missing `Member` type or `'members'` collection).

- [ ] **Step 9: Update existing tests that hard-code the `members` collection**

Five test files reference `collection: 'members'` and break on the rename. Change every `collection: 'members'` → `'people'` in:
- `tests/int/membership-provision.int.spec.ts` (lines 10, 21)
- `tests/int/membership-cancel-fields.int.spec.ts` (lines 8, 14, 24)
- `tests/int/membership-plans.int.spec.ts` (lines 17, 33, 44, 54)
- `tests/int/membership-service.int.spec.ts` (line 41)
- `tests/int/membership-cancel.int.spec.ts` (line 86 — inside an `expect.objectContaining`)

Then **rewrite the now-invalid validation test** in `tests/int/membership-plans.int.spec.ts` (lines 25–39). We removed the "plan required on create" rule, so an admin creating a person with no plan must now **succeed** (a non-member contact). Replace that `it(...)` block with:

```ts
  it('lets an admin create a non-member person with no plan (status none)', async () => {
    const payload = await getTestPayload()
    const staff = await payload.create({
      collection: 'users',
      data: { name: 'Staff', email: `staff-${Date.now()}@test.local`, password: 'test12345' },
    })
    const person = await payload.create({
      collection: 'people',
      overrideAccess: false,
      user: staff,
      data: { name: 'NoPlan', email: `noplan-${Date.now()}@test.local` },
    })
    expect(person.id).toBeTruthy()
    expect(person.plan).toBeFalsy()
    expect(person.status).toBe('none')
  })
```

- [ ] **Step 10: Run the full integration suite** (push recreates the test schema from the new config)

Run: `pnpm run test:int`
Expected: PASS across all suites. Tests that exercise membership via the services keep working because the services now point at `people`.

- [ ] **Step 11: Lint + commit**

```bash
pnpm run lint
git add -A
git commit -m "Rename members collection to people (one record per human)"
```

---

## Task 2: `upsertPersonByEmail` service

The find-or-create seam. Find a person by lowercased email; create with `status: none` if absent; otherwise enrich only the empty fields. A created/enriched person never triggers Square — a new person has no plan (so `reconcileMemberPlan` returns early) and an enrich-update never changes `status`/`plan`.

**Files:**
- Create: `src/services/people.ts`
- Test: `tests/int/people-upsert.int.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, afterAll } from 'vitest'
import { getTestPayload } from './helpers'
import { upsertPersonByEmail } from '../../src/services/people'

describe('upsertPersonByEmail', () => {
  afterAll(async () => {
    const payload = await getTestPayload()
    await payload.delete({ collection: 'people', where: { email: { like: '@upsert.local' } } })
  })

  it('creates a new non-member person (status none, no plan)', async () => {
    const payload = await getTestPayload()
    const p = await upsertPersonByEmail({ payload }, { name: 'New Person', email: 'new@upsert.local', phone: '555' })
    expect(p.status).toBe('none')
    expect(p.plan).toBeFalsy()
    expect(p.phone).toBe('555')
  })

  it('matches case-insensitively and does not create a duplicate', async () => {
    const payload = await getTestPayload()
    const a = await upsertPersonByEmail({ payload }, { name: 'Dup', email: 'dup@upsert.local' })
    const b = await upsertPersonByEmail({ payload }, { name: 'Dup', email: 'DUP@UPSERT.LOCAL' })
    expect(b.id).toBe(a.id)
    const found = await payload.count({ collection: 'people', where: { email: { equals: 'dup@upsert.local' } } })
    expect(found.totalDocs).toBe(1)
  })

  it('enriches missing fields without clobbering existing ones', async () => {
    const payload = await getTestPayload()
    const first = await upsertPersonByEmail({ payload }, { name: 'Enrich', email: 'enrich@upsert.local', phone: '111' })
    const second = await upsertPersonByEmail({ payload }, { name: 'Should Not Win', email: 'enrich@upsert.local', phone: '222', squareCustomerId: 'cus_1' })
    expect(second.id).toBe(first.id)
    expect(second.phone).toBe('111') // existing phone kept
    expect(second.name).toBe('Enrich') // existing name kept
    expect(second.squareCustomerId).toBe('cus_1') // empty field filled
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test:int tests/int/people-upsert.int.spec.ts`
Expected: FAIL — `upsertPersonByEmail` is not a module export.

- [ ] **Step 3: Write the implementation**

```ts
import type { Payload, PayloadRequest } from 'payload'
import type { Person } from '../payload-types'

export interface UpsertPersonDeps {
  payload: Payload
  req?: PayloadRequest
}

export interface UpsertPersonInput {
  name: string
  email: string
  phone?: string | null
  squareCustomerId?: string | null
}

/**
 * Find-or-create a Person keyed on lowercased email. New people are non-members
 * (status 'none', no plan). On a match, fill only empty fields — never clobber
 * data already on the record. Safe re: Square: a planless person doesn't trigger
 * the reconcile hook, and an enrich update never changes status or plan.
 */
export async function upsertPersonByEmail(
  { payload, req }: UpsertPersonDeps,
  input: UpsertPersonInput,
): Promise<Person> {
  const email = input.email.trim().toLowerCase()

  const { docs } = await payload.find({
    collection: 'people',
    where: { email: { equals: email } },
    limit: 1,
    overrideAccess: true,
    req,
  })

  const existing = docs[0] as Person | undefined
  if (existing) {
    const patch: Record<string, unknown> = {}
    if (!existing.phone && input.phone) patch.phone = input.phone
    if (!existing.squareCustomerId && input.squareCustomerId) patch.squareCustomerId = input.squareCustomerId
    if (Object.keys(patch).length === 0) return existing
    return (await payload.update({
      collection: 'people',
      id: existing.id,
      overrideAccess: true,
      req,
      data: patch,
    })) as Person
  }

  return (await payload.create({
    collection: 'people',
    overrideAccess: true,
    req,
    data: {
      name: input.name,
      email,
      phone: input.phone ?? undefined,
      status: 'none',
      squareCustomerId: input.squareCustomerId ?? undefined,
    },
  })) as Person
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run test:int tests/int/people-upsert.int.spec.ts`
Expected: PASS (all three cases).

- [ ] **Step 5: Commit**

```bash
git add src/services/people.ts tests/int/people-upsert.int.spec.ts
git commit -m "Add upsertPersonByEmail find-or-create service"
```

---

## Task 3: Link bookings to a Person

Add the `person` relationship to `bookings` and wire `createPaidBooking` to upsert + link. The link write must not fail a paid booking (the payment already succeeded) — swallow + log on error, same pattern as the confirmation email.

**Files:**
- Modify: `src/collections/Bookings.ts`, `src/services/booking.ts`
- Test: `tests/int/booking-service.int.spec.ts`

- [ ] **Step 1: Add the `person` field to `Bookings.ts`**

After the `class` field (line ~14):

```ts
    { name: 'person', type: 'relationship', relationTo: 'people', hasMany: false, admin: { description: 'The person who made this booking.' } },
```

- [ ] **Step 2: Write the failing test** (append to `tests/int/booking-service.int.spec.ts`)

```ts
  it('links the booking to a person, reusing the same person on a repeat email', async () => {
    const payload = await getTestPayload()
    const cls = await makeClass(payload, 5)
    const d = deps()
    const first = await createPaidBooking({ payload, ...d }, {
      classId: cls.id, sourceId: 'cnon:fake', customerName: 'Repeat', customerEmail: 'repeat@test.local', customerPhone: '999',
    })
    const firstFull = await payload.findByID({ collection: 'bookings', id: first.id, depth: 0 })
    expect(firstFull.person).toBeTruthy()

    const cls2 = await makeClass(payload, 5)
    const second = await createPaidBooking({ payload, ...d }, {
      classId: cls2.id, sourceId: 'cnon:fake2', customerName: 'Repeat', customerEmail: 'REPEAT@test.local',
    })
    const secondFull = await payload.findByID({ collection: 'bookings', id: second.id, depth: 0 })
    expect(secondFull.person).toBe(firstFull.person) // same person id
  })
```

Add `people` cleanup to the existing `afterAll` in this file:

```ts
    await payload.delete({ collection: 'people', where: { email: { like: '@test.local' } } })
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm run test:int tests/int/booking-service.int.spec.ts`
Expected: FAIL — `booking.person` is undefined (not yet wired).

- [ ] **Step 4: Wire `createPaidBooking`** (`src/services/booking.ts`)

Add the import at the top:

```ts
import { upsertPersonByEmail } from './people'
```

After the booking is marked paid (after the `const booking = await payload.update(... status: 'paid' ...)` block, before recording the payment), add:

```ts
  // Link the booking to a Person (find-or-create by email). A failure here must
  // not fail the already-paid booking — log and move on; the backfill can link later.
  try {
    const person = await upsertPersonByEmail(
      { payload },
      { name: input.customerName, email: input.customerEmail, phone: input.customerPhone },
    )
    await payload.update({ collection: 'bookings', id: booking.id, overrideAccess: true, data: { person: person.id } })
  } catch (e) {
    console.error(`Booking ${booking.id} person link failed:`, e)
  }
```

Return the re-fetched booking so the returned doc carries `person`:

```ts
  return await payload.findByID({ collection: 'bookings', id: booking.id, overrideAccess: true })
```

(Replace the existing `return booking` at the end of the function.)

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm run test:int tests/int/booking-service.int.spec.ts`
Expected: PASS (all booking tests, including the new link test).

- [ ] **Step 6: Commit**

```bash
git add src/collections/Bookings.ts src/services/booking.ts tests/int/booking-service.int.spec.ts
git commit -m "Link class bookings to a Person via upsertPersonByEmail"
```

---

## Task 4: Link firing-requests to a Person

Add `person` to `firing-requests` and wire `createAndSendFiringInvoice` to upsert + link, passing the Square customer id the invoice flow already obtains. Writes thread `req` (the firing path runs inside a hook transaction — see the hook-transaction footgun) and use `context: { fromFiringHook: true }`, matching the surrounding updates.

**Files:**
- Modify: `src/collections/FiringRequests.ts`, `src/services/firing-invoice.ts`
- Test: `tests/int/firing-person-link.int.spec.ts` (new)

- [ ] **Step 1: Add the `person` field to `FiringRequests.ts`**

After the `name` field (line ~23):

```ts
    { name: 'person', type: 'relationship', relationTo: 'people', hasMany: false, admin: { description: 'The person who requested this firing.' } },
```

- [ ] **Step 2: Write the failing test** (`tests/int/firing-person-link.int.spec.ts`)

```ts
import { describe, it, expect, afterAll } from 'vitest'
import { getTestPayload } from './helpers'
import { createAndSendFiringInvoice } from '../../src/services/firing-invoice'

// A fake gateway so the test never calls Square; it returns a customer id we then
// assert lands on the linked Person.
const fakeGateway = {
  createAndSendInvoice: async () => ({ customerId: 'cus_firing_1', invoiceId: 'inv_1', invoiceUrl: 'https://x/inv_1' }),
}

describe('createAndSendFiringInvoice person link', () => {
  afterAll(async () => {
    const payload = await getTestPayload()
    await payload.delete({ collection: 'firing-requests', where: { email: { like: '@firing.local' } } })
    await payload.delete({ collection: 'people', where: { email: { like: '@firing.local' } } })
  })

  it('links the firing to a person carrying the Square customer id', async () => {
    const payload = await getTestPayload()
    const req = await payload.create({
      collection: 'firing-requests', overrideAccess: true,
      data: { name: 'Fire Person', email: 'fp@firing.local', description: 'a pot', quotedPriceCents: 4500, status: 'submitted' },
    })
    await createAndSendFiringInvoice({ payload, gateway: fakeGateway as any }, req as any)

    const updated = await payload.findByID({ collection: 'firing-requests', id: req.id, depth: 0 })
    expect(updated.person).toBeTruthy()
    const person = await payload.findByID({ collection: 'people', id: updated.person as number })
    expect(person.squareCustomerId).toBe('cus_firing_1')
    expect(person.status).toBe('none')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm run test:int tests/int/firing-person-link.int.spec.ts`
Expected: FAIL — `firing-request.person` is undefined.

- [ ] **Step 4: Wire `createAndSendFiringInvoice`** (`src/services/firing-invoice.ts`)

Add the import:

```ts
import { upsertPersonByEmail } from './people'
```

In the success branch, after the `result` is returned by the gateway and before the `payload.update` that sets `status: 'invoiced'`, upsert the person and include the link in that same update's data:

```ts
    const person = await upsertPersonByEmail(
      { payload, req },
      { name: request.name, email: request.email, phone: request.phone, squareCustomerId: result.customerId },
    )
    return await payload.update({
      collection: 'firing-requests',
      id: request.id,
      overrideAccess: true,
      req,
      context: { fromFiringHook: true },
      data: {
        status: 'invoiced',
        person: person.id,
        squareCustomerId: result.customerId,
        squareInvoiceId: result.invoiceId,
        squareInvoiceUrl: result.invoiceUrl,
        invoicedAt: new Date().toISOString(),
        lastInvoiceError: null,
      },
    })
```

(This replaces the existing success-branch `payload.update`, adding only the `person` upsert call above it and the `person: person.id` line.)

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm run test:int tests/int/firing-person-link.int.spec.ts`
Expected: PASS.

- [ ] **Step 6: Run the firing-invoice suite to confirm no regression**

Run: `pnpm run test:int tests/int/firing-invoice.int.spec.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/collections/FiringRequests.ts src/services/firing-invoice.ts tests/int/firing-person-link.int.spec.ts
git commit -m "Link firing-requests to a Person carrying the Square customer id"
```

---

## Task 5: Assert a planless person never triggers Square

A guard test locking in the spec guarantee: assigning no plan means no Square call. This protects against a future hook change silently charging non-members.

**Files:**
- Test: `tests/int/person-no-square.int.spec.ts` (new)

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect, vi, afterAll, beforeEach } from 'vitest'
import { getTestPayload } from './helpers'

// Spy on the Square client so we can assert it is never constructed/called for a
// planless person. getSquareClient is the single entry point the hooks use.
const subscriptionsCreate = vi.hoisted(() => vi.fn())
vi.mock('../../src/lib/square', async (orig) => {
  const actual = await (orig() as Promise<any>)
  return {
    ...actual,
    getSquareClient: () => ({ subscriptions: { create: subscriptionsCreate, cancel: vi.fn(), pause: vi.fn() } }),
  }
})

describe('planless person', () => {
  beforeEach(() => subscriptionsCreate.mockClear())
  afterAll(async () => {
    const payload = await getTestPayload()
    await payload.delete({ collection: 'people', where: { email: { like: '@nosq.local' } } })
  })

  it('creating and updating a person with no plan makes no Square subscription', async () => {
    const payload = await getTestPayload()
    const p = await payload.create({ collection: 'people', overrideAccess: true, data: { name: 'No Plan', email: 'np@nosq.local' } })
    await payload.update({ collection: 'people', id: p.id, overrideAccess: true, data: { phone: '555', notes: 'walk-in' } })
    expect(subscriptionsCreate).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test**

Run: `pnpm run test:int tests/int/person-no-square.int.spec.ts`
Expected: PASS — `reconcileMemberPlan` returns early with no plan; `subscriptions.create` is never called.

- [ ] **Step 3: Commit**

```bash
git add tests/int/person-no-square.int.spec.ts
git commit -m "Assert a planless person never provisions a Square subscription"
```

---

## Task 6: Backfill script

A one-time, idempotent, re-runnable script that links every existing booking and firing-request with no `person` to a Person (find-or-create by email). Existing members are already people, so a shared email collapses across all three sources into one person.

**Files:**
- Create: `scripts/backfill-people.ts`
- Test: `tests/int/backfill-people.int.spec.ts` (new)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, afterAll } from 'vitest'
import { getTestPayload } from './helpers'
import { backfillPeople } from '../../scripts/backfill-people'

describe('backfillPeople', () => {
  afterAll(async () => {
    const payload = await getTestPayload()
    await payload.delete({ collection: 'payments', where: {} })
    await payload.delete({ collection: 'bookings', where: { customerEmail: { like: '@bf.local' } } })
    await payload.delete({ collection: 'firing-requests', where: { email: { like: '@bf.local' } } })
    await payload.delete({ collection: 'classes', where: {} })
    await payload.delete({ collection: 'people', where: { email: { like: '@bf.local' } } })
  })

  it('collapses a shared email across a booking + firing into one person and is idempotent', async () => {
    const payload = await getTestPayload()
    const cls = await payload.create({ collection: 'classes', data: { title: `BF ${Date.now()}`, category: 'wheel-series', priceCents: 100, capacity: 5, scheduleText: 'x' } })
    // Booking and firing with no person link, same email, different case.
    await payload.create({ collection: 'bookings', overrideAccess: true, data: { class: cls.id, customerName: 'Shared', customerEmail: 'shared@bf.local', amountCents: 100, status: 'paid' } })
    await payload.create({ collection: 'firing-requests', overrideAccess: true, data: { name: 'Shared', email: 'SHARED@bf.local', description: 'pot', status: 'submitted' } })

    await backfillPeople(payload)

    const people = await payload.find({ collection: 'people', where: { email: { equals: 'shared@bf.local' } } })
    expect(people.totalDocs).toBe(1)
    const personId = people.docs[0].id
    const bookings = await payload.find({ collection: 'bookings', where: { customerEmail: { equals: 'shared@bf.local' } }, depth: 0 })
    const firings = await payload.find({ collection: 'firing-requests', where: { email: { equals: 'SHARED@bf.local' } }, depth: 0 })
    expect(bookings.docs[0].person).toBe(personId)
    expect(firings.docs[0].person).toBe(personId)

    // Idempotent: a second run links nothing new and creates no duplicate person.
    const second = await backfillPeople(payload)
    expect(second.linked).toBe(0)
    const peopleAfter = await payload.count({ collection: 'people', where: { email: { equals: 'shared@bf.local' } } })
    expect(peopleAfter.totalDocs).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test:int tests/int/backfill-people.int.spec.ts`
Expected: FAIL — `backfillPeople` not exported.

- [ ] **Step 3: Write the script** (`scripts/backfill-people.ts`)

```ts
import { getPayload, type Payload } from 'payload'
import config from '@payload-config'
import { upsertPersonByEmail } from '../src/services/people'

/**
 * Link every booking and firing-request with no `person` to a Person, deduping by
 * email. Existing members are already people. Idempotent: rows already linked are
 * skipped, so re-running is a no-op. Returns counts for logging/asserting.
 */
export async function backfillPeople(payload: Payload): Promise<{ linked: number; failed: number }> {
  let linked = 0
  let failed = 0

  // Bookings without a person.
  const { docs: bookings } = await payload.find({
    collection: 'bookings', where: { person: { exists: false } }, limit: 100000, depth: 0, overrideAccess: true,
  })
  for (const b of bookings) {
    try {
      const person = await upsertPersonByEmail({ payload }, { name: b.customerName, email: b.customerEmail, phone: b.customerPhone })
      await payload.update({ collection: 'bookings', id: b.id, overrideAccess: true, data: { person: person.id } })
      linked++
    } catch (e) {
      failed++
      console.error(`Backfill booking ${b.id} failed:`, e instanceof Error ? e.message : e)
    }
  }

  // Firing-requests without a person.
  const { docs: firings } = await payload.find({
    collection: 'firing-requests', where: { person: { exists: false } }, limit: 100000, depth: 0, overrideAccess: true,
  })
  for (const f of firings) {
    try {
      const person = await upsertPersonByEmail({ payload }, { name: f.name, email: f.email, phone: f.phone, squareCustomerId: f.squareCustomerId })
      await payload.update({ collection: 'firing-requests', id: f.id, overrideAccess: true, data: { person: person.id } })
      linked++
    } catch (e) {
      failed++
      console.error(`Backfill firing ${f.id} failed:`, e instanceof Error ? e.message : e)
    }
  }

  return { linked, failed }
}

// Allow `tsx scripts/backfill-people.ts` as a one-off CLI run.
if (process.argv[1] && process.argv[1].endsWith('backfill-people.ts')) {
  ;(async () => {
    const payload = await getPayload({ config: await config })
    const { linked, failed } = await backfillPeople(payload)
    console.log(`Backfill complete. Linked ${linked}, failed ${failed}.`)
    process.exit(failed > 0 ? 1 : 0)
  })()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run test:int tests/int/backfill-people.int.spec.ts`
Expected: PASS (collapse-to-one + idempotent second run).

- [ ] **Step 5: Add an npm script** (`package.json` scripts block)

```json
    "backfill:people": "tsx scripts/backfill-people.ts",
```

- [ ] **Step 6: Commit**

```bash
git add scripts/backfill-people.ts tests/int/backfill-people.int.spec.ts package.json
git commit -m "Add idempotent backfill linking bookings + firings to people"
```

---

## Task 7: "Members" admin view

People are members iff they have a `plan`. Add a left-nav link that opens the People list pre-filtered to "has a plan," so staff keep a members-only view without a second collection.

**Files:**
- Create: `src/admin/MembersNavLink.tsx`
- Modify: `src/payload.config.ts` (register the nav link component)

- [ ] **Step 1: Create the nav link component** (`src/admin/MembersNavLink.tsx`)

```tsx
import Link from 'next/link'

// A members-only shortcut into the People list: filters to people who have a plan.
export default function MembersNavLink() {
  return (
    <Link href="/admin/collections/people?where[plan][exists]=true" className="nav__link">
      Members
    </Link>
  )
}
```

- [ ] **Step 2: Register it in `src/payload.config.ts`**

In the `admin` config block, add `components.beforeNavLinks` (create the `admin` key if absent):

```ts
  admin: {
    components: {
      beforeNavLinks: ['/admin/MembersNavLink#default'],
    },
  },
```

> Verify the path against `generate:importmap` conventions used by existing admin components (e.g. `PriceCell` is referenced as `/admin/PriceCell#PriceCell`). Run `pnpm generate:importmap` after adding it.

- [ ] **Step 3: Regenerate the import map**

```bash
pnpm generate:importmap
```

- [ ] **Step 4: Verify the admin boots and the link filters**

Run: `pnpm dev`, open `/admin`, confirm a **Members** link appears in the nav and clicking it shows only people with a plan. Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add src/admin/MembersNavLink.tsx src/payload.config.ts src/app/\(payload\)/admin/importMap.js
git commit -m "Add Members admin nav link filtering people to those with a plan"
```

---

## Task 8: Production migration (data-preserving)

Tests use Payload `push` so they never need this; production runs with `push: false`, so the rename + new columns require a migration. A naive slug rename diffs as drop-and-recreate (data loss), so we **generate the migration for its `.json` snapshot + index registration, then replace the `up`/`down` bodies** with hand-written, data-preserving SQL.

**Files:**
- Create: `src/migrations/<generated-timestamp>_person_foundation.ts` (+ its `.json`, + `src/migrations/index.ts` entry — both auto-generated)

- [ ] **Step 1: Generate the migration scaffold** (run only after Tasks 1–7 are merged so the schema diff is complete)

```bash
pnpm payload migrate:create person_foundation
```
This writes `src/migrations/<ts>_person_foundation.ts`, a `.json` snapshot, and updates `src/migrations/index.ts`. The generated `up` will be **destructive** — that's expected; we replace it next. Keep the `.json` and `index.ts` as generated (the snapshot already reflects the desired `people` end-state).

- [ ] **Step 2: Replace the `up` function body** with the data-preserving SQL

```ts
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  -- 1. Rename the core tables (rows preserved; existing FKs follow the rename).
  ALTER TABLE "members" RENAME TO "people";
  ALTER TABLE "members_sessions" RENAME TO "people_sessions";

  -- 2. Rename the relationship columns Payload addresses as "<slug>_id".
  ALTER TABLE "payload_locked_documents_rels" RENAME COLUMN "members_id" TO "people_id";
  ALTER TABLE "payload_preferences_rels" RENAME COLUMN "members_id" TO "people_id";

  -- 3. Recreate the membership-status enum with the new 'none' value + default.
  --    Swap via text (ADD VALUE can't be used in the same transaction). Existing
  --    values (active/past_due/paused/cancelled) all exist in the new type, so
  --    every current member keeps its status; only the DEFAULT for new rows changes.
  ALTER TABLE "people" ALTER COLUMN "status" DROP DEFAULT;
  ALTER TABLE "people" ALTER COLUMN "status" SET DATA TYPE text;
  DROP TYPE "public"."enum_members_status";
  CREATE TYPE "public"."enum_people_status" AS ENUM('none', 'active', 'past_due', 'paused', 'cancelled');
  ALTER TABLE "people" ALTER COLUMN "status" SET DATA TYPE "public"."enum_people_status" USING "status"::"public"."enum_people_status";
  ALTER TABLE "people" ALTER COLUMN "status" SET DEFAULT 'none';

  -- 4. Add the person link to bookings and firing-requests.
  ALTER TABLE "bookings" ADD COLUMN "person_id" integer;
  ALTER TABLE "firing_requests" ADD COLUMN "person_id" integer;
  ALTER TABLE "bookings" ADD CONSTRAINT "bookings_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "firing_requests" ADD CONSTRAINT "firing_requests_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "bookings_person_idx" ON "bookings" USING btree ("person_id");
  CREATE INDEX "firing_requests_person_idx" ON "firing_requests" USING btree ("person_id");`)
}
```

> The `payments.member_id` FK (`payments_member_id_members_id_fk`) is intentionally left untouched: Postgres keeps a foreign key valid across a table rename, so membership-payment links survive automatically. Its constraint name still reads "members" — cosmetic only, harmless at runtime. Likewise the renamed table's index/constraint names keep their `members_*` labels; Drizzle addresses tables/columns by name, not constraints/indexes, so runtime is unaffected.

- [ ] **Step 3: Replace the `down` function body**

```ts
export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  DROP INDEX "bookings_person_idx";
  DROP INDEX "firing_requests_person_idx";
  ALTER TABLE "bookings" DROP CONSTRAINT "bookings_person_id_people_id_fk";
  ALTER TABLE "firing_requests" DROP CONSTRAINT "firing_requests_person_id_people_id_fk";
  ALTER TABLE "bookings" DROP COLUMN "person_id";
  ALTER TABLE "firing_requests" DROP COLUMN "person_id";

  -- Reverse the enum (lossy: any 'none' rows are remapped to 'active' first).
  ALTER TABLE "people" ALTER COLUMN "status" DROP DEFAULT;
  ALTER TABLE "people" ALTER COLUMN "status" SET DATA TYPE text;
  UPDATE "people" SET "status" = 'active' WHERE "status" = 'none';
  DROP TYPE "public"."enum_people_status";
  CREATE TYPE "public"."enum_members_status" AS ENUM('active', 'past_due', 'paused', 'cancelled');
  ALTER TABLE "people" ALTER COLUMN "status" SET DATA TYPE "public"."enum_members_status" USING "status"::"public"."enum_members_status";
  ALTER TABLE "people" ALTER COLUMN "status" SET DEFAULT 'active';

  ALTER TABLE "payload_locked_documents_rels" RENAME COLUMN "people_id" TO "members_id";
  ALTER TABLE "payload_preferences_rels" RENAME COLUMN "people_id" TO "members_id";
  ALTER TABLE "people_sessions" RENAME TO "members_sessions";
  ALTER TABLE "people" RENAME TO "members";`)
}
```

- [ ] **Step 4: Verify on a copy of production data**

Restore a prod snapshot into a scratch database, point `DATABASE_URL` at it, then:

```bash
# capture before-counts
psql "$DATABASE_URL" -c "SELECT count(*) AS members FROM members;"
psql "$DATABASE_URL" -c "SELECT count(*) AS membership_payments FROM payments WHERE type='membership' AND member_id IS NOT NULL;"

pnpm payload migrate

# after: same people count, membership payment links intact, statuses preserved
psql "$DATABASE_URL" -c "SELECT count(*) AS people FROM people;"
psql "$DATABASE_URL" -c "SELECT count(*) FROM payments p JOIN people pe ON pe.id = p.member_id WHERE p.type='membership';"
psql "$DATABASE_URL" -c "SELECT status, count(*) FROM people GROUP BY status;"
```
Expected: `people` count equals the pre-migration `members` count; the membership-payment join count equals the pre-migration count; no member's status changed (no rows became `none`).

- [ ] **Step 5: Verify the down-migration reverses cleanly**

```bash
pnpm payload migrate:down
psql "$DATABASE_URL" -c "SELECT count(*) AS members FROM members;"
```
Expected: table is `members` again with the same row count. Then re-apply: `pnpm payload migrate`.

- [ ] **Step 6: Commit**

```bash
git add src/migrations/
git commit -m "Add data-preserving migration: rename members to people + person links"
```

---

## Self-Review Notes (for the implementer)

- **Spec coverage:** §1 collection rename → Task 1; §2 migration → Task 8; §3 person links → Tasks 3–4; §4 upsert service → Task 2; §5 wiring → Tasks 3–4; §6 backfill → Task 6; §7 admin Members view → Task 7; §8 `payments.member` relationTo → Task 1 Step 4; hook-gating guarantee → Task 5.
- **`status` is required + conditionally hidden:** its `defaultValue: 'none'` supplies a value even when the field isn't shown for a non-member, so the required constraint is always satisfied.
- **Test DB uses `push`:** Tasks 2–7 rely on Payload auto-syncing the schema to `portside_test`; only Task 8 (production) writes SQL. If a suite fails with a missing `people` table, the first `getTestPayload()` boot performs the push — re-run once.
- **Run order:** Tasks 1→7 can be implemented in sequence; Task 8 must come last because its diff must capture the `person` columns added in Tasks 3–4.

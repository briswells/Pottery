# Members: No-Login Auth + Auto Square Subscription Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Members a no-login auth collection (no password required, login hidden) and automatically provision a Square customer + cardless (invoice-billed) subscription when staff create an active member in the admin.

**Architecture:** `disableLocalStrategy: { enableFields, optionalPassword }` removes member login without changing the DB schema (migration-free). A new create-only `afterChange` hook calls a new `provisionMemberSubscription` service that creates a Square customer + cardless subscription (Square emails an invoice with an auto-pay opt-in) and writes the Square IDs back **in the same transaction via `req`** — the same deadlock-safe pattern used for firing invoices. The import script and Square webhook keep syncing.

**Tech Stack:** Payload CMS 3.85 (auth config, collection hooks, `req`-threaded transactions), Square Node SDK (Subscriptions/Customers), vitest.

**Spec:** `docs/superpowers/specs/2026-06-07-members-auth-and-auto-subscription-design.md`

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/collections/Members.ts` | `auth` → no-login config; add provisioning hook to `afterChange` |
| `src/lib/membership-gateway.ts` | `createSubscription` `cardId` optional (cardless = invoice-billed) |
| `src/services/membership.ts` | Add `provisionMemberSubscription` + `ProvisionDeps`; drop password code from `createMembership` |
| `src/hooks/provisionSquareSubscription.ts` | **New** — create-only provisioning hook |
| `scripts/import-square-members.ts` | Drop the throwaway password line + unused import |
| `tests/int/membership-provision.int.spec.ts` | **New** — auth + gateway + service tests (real service) |
| `tests/int/provision-hook-guards.int.spec.ts` | **New** — hook guard tests (mocked service) |

Verified facts to rely on: Square subscriptions created **without** `card_id` are invoice-billed and emailed (Subscriptions API — Subscription Billing and Invoices). The existing `afterChange` hook `cancelSquareSubscription` is untyped and uses `req?.context?.fromSquareWebhook`. The webhook writes use `context: { fromSquareWebhook: true }`. `Member.phone` is `string | null`.

---

## Task 1: No-login auth + remove password code

**Files:**
- Modify: `src/collections/Members.ts`
- Modify: `src/services/membership.ts`
- Modify: `scripts/import-square-members.ts`
- Test: `tests/int/membership-provision.int.spec.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `tests/int/membership-provision.int.spec.ts`:

```ts
import { describe, it, expect, afterAll } from 'vitest'
import { getTestPayload } from './helpers'

describe('members no-login auth', () => {
  it('creates a member with no password (local strategy disabled)', async () => {
    const payload = await getTestPayload()
    // status 'paused' so the (later) provisioning hook skips it — this isolates
    // the auth change from any Square calls.
    const member = await payload.create({
      collection: 'members',
      overrideAccess: true,
      data: { name: 'No Password', email: `nopw-${Date.now()}@test.local`, status: 'paused' },
    })
    expect(member.id).toBeTruthy()
  })
})

afterAll(async () => {
  const { getTestPayload } = await import('./helpers')
  const payload = await getTestPayload()
  await payload.delete({ collection: 'members', where: { email: { contains: '@test.local' } }, overrideAccess: true })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run --config ./vitest.config.mts tests/int/membership-provision.int.spec.ts`
Expected: FAIL — with `auth: true`, creating a member without a password is rejected (missing required password).

- [ ] **Step 3: Change the Members auth config**

In `src/collections/Members.ts`, replace:

```ts
  auth: true, // foundation for the future member portal; staff-managed for now
```

with:

```ts
  // No member login yet: disable the local (email/password) strategy so no password
  // is required and the login UI is hidden. enableFields keeps the email + auth
  // columns so the DB/types don't change (no migration). optionalPassword makes
  // password non-required. Re-enable a strategy later for a member portal.
  auth: { disableLocalStrategy: { enableFields: true, optionalPassword: true } },
```

- [ ] **Step 4: Remove password code from the membership service**

In `src/services/membership.ts`:

1. In the `payload.create` data object, delete this line:
```ts
      password: input.password ?? randomPassword(),
```
2. Delete the `randomPassword` helper function:
```ts
function randomPassword(): string {
  // Members don't log in yet; a strong placeholder password satisfies the auth collection.
  return randomBytes(24).toString('hex')
}
```
3. Remove the now-unused import at the top:
```ts
import { randomBytes } from 'crypto'
```
4. Remove the `password?` field from `MembershipInput`:
```ts
  password?: string // optional now; member sets/uses it when the portal launches
```

- [ ] **Step 5: Remove password from the import script**

In `scripts/import-square-members.ts`:
1. Delete the line inside the `payload.create` data:
```ts
          password: randomBytes(24).toString('hex'),
```
2. Remove the now-unused import on line 1:
```ts
import { randomBytes } from 'crypto'
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm exec vitest run --config ./vitest.config.mts tests/int/membership-provision.int.spec.ts`
Expected: PASS.

- [ ] **Step 7: Confirm the existing membership test + typecheck still pass**

Run: `pnpm exec vitest run --config ./vitest.config.mts tests/int/membership-service.int.spec.ts && pnpm exec tsc --noEmit`
Expected: PASS (the `createMembership` test still creates a member with no password) and no type errors. If `tests/int/membership-service.int.spec.ts` references `password`, remove that reference (members no longer take one).

- [ ] **Step 8: Commit**

```bash
git add src/collections/Members.ts src/services/membership.ts scripts/import-square-members.ts tests/int/membership-provision.int.spec.ts
git commit -m "Members: disable local login strategy, drop throwaway passwords"
```

---

## Task 2: Cardless subscription in the gateway

**Files:**
- Modify: `src/lib/membership-gateway.ts`
- Test: `tests/int/membership-provision.int.spec.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `tests/int/membership-provision.int.spec.ts` (add `vi` to the vitest import line: `import { describe, it, expect, afterAll, vi } from 'vitest'`):

```ts
describe('squareMembershipGateway.createSubscription cardless', () => {
  it('omits cardId from the Square call when no card is provided', async () => {
    const create = vi.fn(async () => ({ subscription: { id: 'sub_1', status: 'ACTIVE' } }))
    vi.doMock('../../src/lib/square', () => ({
      getSquareClient: () => ({ subscriptions: { create } }),
      SQUARE_LOCATION_ID: () => 'LOC1',
    }))
    process.env.SQUARE_MEMBERSHIP_PLAN_VARIATION_ID = 'PLAN1'
    const { squareMembershipGateway } = await import('../../src/lib/membership-gateway')

    await squareMembershipGateway.createSubscription({ customerId: 'cus_1' })
    expect(create).toHaveBeenCalledWith(expect.not.objectContaining({ cardId: expect.anything() }))

    await squareMembershipGateway.createSubscription({ customerId: 'cus_1', cardId: 'card_1' })
    expect(create).toHaveBeenLastCalledWith(expect.objectContaining({ cardId: 'card_1' }))
    vi.doUnmock('../../src/lib/square')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run --config ./vitest.config.mts tests/int/membership-provision.int.spec.ts -t "cardless"`
Expected: FAIL — `createSubscription` requires `cardId` (type error / it always passes `cardId`).

- [ ] **Step 3: Make `cardId` optional and omit it when absent**

In `src/lib/membership-gateway.ts`, change the interface method signature:

```ts
  createSubscription(input: { customerId: string; cardId?: string }): Promise<{ subscriptionId: string; status: string }>
```

and change the implementation so `cardId` is only sent when provided (a cardless subscription bills by emailed invoice):

```ts
  async createSubscription({ customerId, cardId }) {
    const client = getSquareClient()
    const res = await client.subscriptions.create({
      idempotencyKey: randomUUID(),
      locationId: SQUARE_LOCATION_ID(),
      planVariationId: process.env.SQUARE_MEMBERSHIP_PLAN_VARIATION_ID!,
      customerId,
      // Cardless subscription → Square emails the member an invoice each billing
      // period (with an auto-pay opt-in). Only attach a card when one is provided.
      ...(cardId ? { cardId } : {}),
    })
    const sub = res.subscription
    if (!sub?.id) throw new Error('Square subscription was not created')
    return { subscriptionId: sub.id, status: sub.status ?? 'ACTIVE' }
  },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run --config ./vitest.config.mts tests/int/membership-provision.int.spec.ts -t "cardless"`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no new errors. (The existing `createMembership` call passes `cardId`, still valid.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/membership-gateway.ts tests/int/membership-provision.int.spec.ts
git commit -m "membership gateway: allow cardless (invoice-billed) subscription"
```

---

## Task 3: provisionMemberSubscription service

**Files:**
- Modify: `src/services/membership.ts`
- Test: `tests/int/membership-provision.int.spec.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `tests/int/membership-provision.int.spec.ts`:

```ts
import { provisionMemberSubscription } from '../../src/services/membership'
import type { MembershipGateway } from '../../src/lib/membership-gateway'

function fakeGateway(over: Partial<MembershipGateway> = {}): MembershipGateway {
  return {
    createCustomer: vi.fn(async () => ({ customerId: 'cus_x' })),
    saveCard: vi.fn(async () => ({ cardId: 'card_x' })),
    createSubscription: vi.fn(async () => ({ subscriptionId: 'sub_x', status: 'ACTIVE' })),
    ...over,
  }
}

describe('provisionMemberSubscription', () => {
  const member = { id: 7, name: 'Mae', email: 'mae@test.local', phone: null }

  it('creates a cardless subscription and writes Square ids back within the caller transaction', async () => {
    const req = { transactionID: 'tx1' } as any
    const update = vi.fn(async (a: any) => ({ id: a.id, ...a.data }))
    const payload = { update } as any
    const gateway = fakeGateway()

    await provisionMemberSubscription({ payload, gateway, req }, member)

    expect(gateway.createSubscription).toHaveBeenCalledWith({ customerId: 'cus_x' }) // no cardId
    expect(gateway.saveCard).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        req,
        collection: 'members',
        id: 7,
        data: expect.objectContaining({
          squareCustomerId: 'cus_x',
          squareSubscriptionId: 'sub_x',
          subscriptionStatus: 'ACTIVE',
        }),
      }),
    )
  })

  it('marks subscriptionStatus SETUP_FAILED (no sub id) when Square throws', async () => {
    const req = { transactionID: 'tx1' } as any
    const update = vi.fn(async (a: any) => ({ id: a.id, ...a.data }))
    const payload = { update } as any
    const gateway = fakeGateway({ createSubscription: vi.fn(async () => { throw new Error('square down') }) })

    await provisionMemberSubscription({ payload, gateway, req }, member)

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        req,
        data: expect.objectContaining({ subscriptionStatus: 'SETUP_FAILED' }),
      }),
    )
    const lastData = update.mock.calls.at(-1)![0].data
    expect(lastData.squareSubscriptionId ?? null).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run --config ./vitest.config.mts tests/int/membership-provision.int.spec.ts -t "provisionMemberSubscription"`
Expected: FAIL — `provisionMemberSubscription` is not exported.

- [ ] **Step 3: Implement the service**

In `src/services/membership.ts`, add the import for `PayloadRequest` (extend the existing `payload` import line) and append the new types + function:

```ts
import type { Payload, PayloadRequest } from 'payload'
```

(adjust the existing `import type { Payload } from 'payload'` to the line above), then add:

```ts
export interface ProvisionDeps {
  payload: Payload
  gateway: MembershipGateway
  // Thread the triggering hook's req so the write-back JOINS its transaction
  // instead of deadlocking on the row lock the parent save holds.
  req?: PayloadRequest
}

/**
 * Provision Square for a member that already exists in Payload (admin-created):
 * create a customer + cardless subscription (Square emails an invoice with an
 * auto-pay opt-in), then attach the Square ids to the member.
 */
export async function provisionMemberSubscription(
  deps: ProvisionDeps,
  member: { id: string | number; name: string; email: string; phone?: string | null },
): Promise<void> {
  const { payload, gateway, req } = deps
  try {
    const { customerId } = await gateway.createCustomer({
      name: member.name,
      email: member.email,
      phone: member.phone ?? undefined,
    })
    const { subscriptionId, status } = await gateway.createSubscription({ customerId })
    await payload.update({
      collection: 'members',
      id: member.id,
      overrideAccess: true,
      req,
      context: { fromMemberHook: true },
      data: { squareCustomerId: customerId, squareSubscriptionId: subscriptionId, subscriptionStatus: status },
    })
  } catch (e) {
    console.error(`Member ${member.id} Square provisioning failed:`, e)
    await payload.update({
      collection: 'members',
      id: member.id,
      overrideAccess: true,
      req,
      context: { fromMemberHook: true },
      data: { subscriptionStatus: 'SETUP_FAILED' },
    })
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm exec vitest run --config ./vitest.config.mts tests/int/membership-provision.int.spec.ts -t "provisionMemberSubscription"`
Expected: PASS (both cases).

- [ ] **Step 5: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/services/membership.ts tests/int/membership-provision.int.spec.ts
git commit -m "Add provisionMemberSubscription service (cardless, req-threaded write-back)"
```

---

## Task 4: Provisioning hook + wire into Members

**Files:**
- Create: `src/hooks/provisionSquareSubscription.ts`
- Modify: `src/collections/Members.ts`
- Test: `tests/int/provision-hook-guards.int.spec.ts` (new)

- [ ] **Step 1: Write the failing guard tests**

Create a SEPARATE test file `tests/int/provision-hook-guards.int.spec.ts` that mocks the service module (hoisted `vi.mock`) so the hook's `provisionMemberSubscription` import resolves to a spy — this tests ONLY the guard logic and makes a real Square call impossible:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Replace the service so the hook never reaches Square. Must be a separate file
// from the tests that exercise the REAL service (vi.mock is per-file).
const provisionMock = vi.fn(async () => undefined)
vi.mock('../../src/services/membership', () => ({ provisionMemberSubscription: provisionMock }))

import { provisionSquareSubscription } from '../../src/hooks/provisionSquareSubscription'

const baseReq: any = { payload: {}, context: {} }
const baseDoc: any = { id: 1, name: 'A', email: 'a@test.local', phone: null, status: 'active', squareSubscriptionId: null }

async function didProvision(args: any) {
  provisionMock.mockClear()
  await provisionSquareSubscription({ operation: 'create', req: baseReq, doc: baseDoc, ...args } as any)
  return provisionMock.mock.calls.length > 0
}

describe('provisionSquareSubscription hook guards', () => {
  beforeEach(() => provisionMock.mockClear())

  it('provisions on create of an active, unlinked member', async () => {
    expect(await didProvision({})).toBe(true)
  })
  it('skips on update', async () => {
    expect(await didProvision({ operation: 'update' })).toBe(false)
  })
  it('skips when not active', async () => {
    expect(await didProvision({ doc: { ...baseDoc, status: 'paused' } })).toBe(false)
  })
  it('skips when already linked to Square', async () => {
    expect(await didProvision({ doc: { ...baseDoc, squareSubscriptionId: 'sub_existing' } })).toBe(false)
  })
  it('skips when triggered by our own hook write-back', async () => {
    expect(await didProvision({ req: { ...baseReq, context: { fromMemberHook: true } } })).toBe(false)
  })
  it('skips when triggered by the Square webhook', async () => {
    expect(await didProvision({ req: { ...baseReq, context: { fromSquareWebhook: true } } })).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run --config ./vitest.config.mts tests/int/provision-hook-guards.int.spec.ts`
Expected: FAIL — `src/hooks/provisionSquareSubscription.ts` does not exist.

- [ ] **Step 3: Create the hook**

Create `src/hooks/provisionSquareSubscription.ts`:

```ts
import type { CollectionAfterChangeHook } from 'payload'
import { squareMembershipGateway } from '../lib/membership-gateway'
import { provisionMemberSubscription } from '../services/membership'
import type { Member } from '../payload-types'

/**
 * When staff create an ACTIVE member in the admin, set them up in Square:
 * a customer + cardless subscription (Square emails the invoice). Skips members
 * that already carry Square ids (self-serve signup / import) and changes driven
 * by our own write-back or the Square webhook.
 */
export const provisionSquareSubscription: CollectionAfterChangeHook<Member> = async ({ doc, operation, req }) => {
  if (operation !== 'create') return doc
  if (req?.context?.fromMemberHook) return doc
  if (req?.context?.fromSquareWebhook) return doc
  if (doc.squareSubscriptionId) return doc
  if (doc.status !== 'active') return doc

  try {
    await provisionMemberSubscription(
      { payload: req.payload, gateway: squareMembershipGateway, req },
      { id: doc.id, name: doc.name, email: doc.email, phone: doc.phone },
    )
  } catch (e) {
    // provisionMemberSubscription already records SETUP_FAILED; this is a backstop
    // so a thrown error never breaks the admin save.
    console.error(`Member ${doc.id} provisioning hook error:`, e)
  }
  return doc
}
```

- [ ] **Step 4: Wire the hook into Members**

In `src/collections/Members.ts`:
1. Add the import near the existing `cancelSquareSubscription` import:
```ts
import { provisionSquareSubscription } from '../hooks/provisionSquareSubscription'
```
2. Change the hooks block from:
```ts
  hooks: { afterChange: [cancelSquareSubscription] },
```
to:
```ts
  hooks: { afterChange: [provisionSquareSubscription, cancelSquareSubscription] },
```

- [ ] **Step 5: Run the guard tests to verify pass**

Run: `pnpm exec vitest run --config ./vitest.config.mts tests/int/provision-hook-guards.int.spec.ts`
Expected: PASS (all six cases).

- [ ] **Step 6: Run both new specs + typecheck**

Run: `pnpm exec vitest run --config ./vitest.config.mts tests/int/membership-provision.int.spec.ts tests/int/provision-hook-guards.int.spec.ts && pnpm exec tsc --noEmit`
Expected: all tests PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/provisionSquareSubscription.ts src/collections/Members.ts tests/int/provision-hook-guards.int.spec.ts
git commit -m "Provision Square subscription when an active member is created in the admin"
```

---

## Task 5: Manual verification (Square sandbox + admin)

Automated tests can't exercise the real admin form or real Square. Verify by hand.

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server and log into the admin**

Run: `pnpm dev` → open `http://localhost:3000/admin`, log in (Users account).

- [ ] **Step 2: No password / no login UI**

Open Members → "Create New". Confirm there is **no password field** and no login/change-password UI, and the member saves with just name + email (+ status). Confirm Members has no working login (there's no member login page in use).

- [ ] **Step 3: Active create provisions Square**

Create a member with status **Active** and a real-looking email. After save, confirm:
- the member row now shows `squareCustomerId` and `squareSubscriptionId` (read-only fields populated), `subscriptionStatus` like `ACTIVE`;
- in the **Square sandbox dashboard**, a new customer + subscription exist for that email;
- the member receives the Square **invoice email** with a payment link (and the auto-pay opt-in on the invoice page);
- the admin save did **not** hang (transaction-join fix working).

- [ ] **Step 4: Non-active create does not provision**

Create a member with status **Paused**. Confirm no Square customer/subscription is created and `squareSubscriptionId` stays empty (comp-member escape hatch).

- [ ] **Step 5: Failure is visible, not fatal**

(Optional) Temporarily set an invalid `SQUARE_MEMBERSHIP_PLAN_VARIATION_ID`, create an Active member, and confirm the save completes with `subscriptionStatus: SETUP_FAILED` (logged), then restore the env var. Re-saving with a valid plan retries.

- [ ] **Step 6: Webhook sync still works**

Pay the member's Square invoice in the sandbox; confirm the webhook flips the member to `active`/`PAID` and creates a membership `payment` record (existing behavior, unchanged).

---

## Self-Review Notes

- **Spec coverage:** no-login/no-password → Task 1 (auth config + password removal) + its test. Cardless subscription → Task 2 (gateway) + test. Provisioning service with req-threaded write-back + SETUP_FAILED → Task 3 + tests. Create-only/active-only/skip-linked/skip-webhook/skip-own-writeback guards → Task 4 hook + six guard tests, wired into `Members.afterChange`. Import-script password removal → Task 1 Step 5. Migration-free → enableFields keeps schema; SETUP_FAILED reuses existing `subscriptionStatus`; no new columns. Manual Square/admin checks → Task 5.
- **Type consistency:** `provisionMemberSubscription(deps: ProvisionDeps, member: {id,name,email,phone?})` is defined in Task 3 and called identically by the hook in Task 4. `createSubscription({ customerId, cardId? })` defined in Task 2, called with just `{ customerId }` in Task 3. `subscriptionStatus: 'SETUP_FAILED'` written in Task 3 and asserted in Task 3's test. Context flags `fromMemberHook` (ours) and `fromSquareWebhook` (existing) used consistently in service write-back and hook guards.
- **No placeholders:** every step has concrete code/commands/expected output.
- **Deadlock safety:** Task 3's write-back passes `req`; Task 3's test asserts `req` is present in the `payload.update` args — the regression guard for the firing-invoice footgun.
- **Test isolation note:** Task 1's auth test uses status `paused` so it never triggers the Task 4 hook (no real Square call), keeping the suite hermetic regardless of task order.

# Membership Plans Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single hardcoded `SQUARE_MEMBERSHIP_PLAN_VARIATION_ID` with a synced-from-Square `Plans` collection, a per-member plan assignment that provisions/reconciles a Square subscription, and a platform-only "Free" plan that creates a member with no subscription.

**Architecture:** A `membership-plans` collection mirrors Square's subscription plan variations (synced via the `catalog.version.updated` webhook + a test-guarded startup sync) and adds platform-only plans (Free). Members get a `plan` relationship; an afterChange reconcile hook creates/swaps/cancels the member's Square subscription based on their plan, writing back inside the save transaction (`req`). Cardless subscriptions bill by emailed Square invoice.

**Tech Stack:** Payload CMS 3.85 (collections, relationship fields, hooks, onInit, migrations), Square Node SDK (catalog + subscriptions), vitest.

**Spec:** `docs/superpowers/specs/2026-06-11-membership-plans-redesign-design.md`

**Critical safety rules for tests:** the reconcile hook calls the REAL Square gateway for `square`-kind plans. So any integration test that creates/edits a member through Payload MUST use a **Free** plan (no Square call). Service-level Square paths are tested with a **fake gateway** + mock payload. Gateway tests **hoist-mock `../../src/lib/square`** in their own file and never boot Payload. The startup sync is guarded by `NODE_ENV==='test'`.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/collections/MembershipPlans.ts` | **New** — Plans collection (Square-synced + Free) |
| `src/collections/Members.ts` | Add `plan` relationship; swap provision hook → reconcile hook |
| `src/lib/membership-gateway.ts` | `createSubscription(planVariationId)`, `cancelSubscription`, `listPlanVariations` |
| `src/services/sync-square-plans.ts` | **New** — `syncSquarePlans` |
| `src/services/membership.ts` | Add `reconcileMemberPlan`; adapt `createMembership`; drop env/placeholder logic |
| `src/hooks/reconcileMemberSubscription.ts` | **New** — afterChange reconcile hook (replaces `provisionSquareSubscription.ts`) |
| `src/app/api/webhooks/square/route.ts` | `catalog.version.updated` → sync |
| `src/payload.config.ts` | Register collection + `onInit` startup sync (test-guarded) |
| `scripts/list-membership-plans.ts` | **Delete** (logic moved to gateway) |
| `.env.example` | Remove `SQUARE_MEMBERSHIP_PLAN_VARIATION_ID` |
| `src/migrations/*` | **New** generated migration |
| `tests/int/*` | sync, reconcile matrix, gateway, hook-guard, webhook tests |

---

## Task 1: Plans collection + Member.plan field + migration

**Files:**
- Create: `src/collections/MembershipPlans.ts`
- Modify: `src/payload.config.ts`, `src/collections/Members.ts`
- Test: `tests/int/membership-plans.int.spec.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `tests/int/membership-plans.int.spec.ts`:

```ts
import { describe, it, expect, afterAll } from 'vitest'
import { getTestPayload } from './helpers'

async function makeFreePlan(payload: any) {
  return payload.create({
    collection: 'membership-plans',
    overrideAccess: true,
    data: { name: `Free ${Date.now()}`, kind: 'free' },
  })
}

describe('membership-plans collection + member.plan', () => {
  it('creates a plan and a member assigned to it (Free → no Square)', async () => {
    const payload = await getTestPayload()
    const plan = await makeFreePlan(payload)
    const member = await payload.create({
      collection: 'members',
      overrideAccess: true,
      data: { name: 'Planned', email: `planned-${Date.now()}@test.local`, status: 'active', plan: plan.id },
    })
    expect(member.id).toBeTruthy()
    expect(member.plan).toBeTruthy()
  })

  it('rejects creating a member with no plan', async () => {
    const payload = await getTestPayload()
    await expect(
      payload.create({
        collection: 'members',
        overrideAccess: true,
        data: { name: 'NoPlan', email: `noplan-${Date.now()}@test.local`, status: 'active' },
      }),
    ).rejects.toThrow()
  })
})

afterAll(async () => {
  const payload = await getTestPayload()
  await payload.delete({ collection: 'members', where: { email: { contains: '@test.local' } }, overrideAccess: true })
  await payload.delete({ collection: 'membership-plans', where: { name: { contains: 'Free ' } }, overrideAccess: true })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run --config ./vitest.config.mts tests/int/membership-plans.int.spec.ts`
Expected: FAIL — `membership-plans` collection / `plan` field do not exist.

- [ ] **Step 3: Create the Plans collection**

Create `src/collections/MembershipPlans.ts`:

```ts
import type { CollectionConfig } from 'payload'
import { isAdmin } from '../access/isAdmin'
import { isAdminOrEditor } from '../access/isAdminOrEditor'

/**
 * Membership plans. `square` plans mirror Square subscription plan variations
 * (kept in sync — their identifying fields are read-only here). `free` plans are
 * platform-only: assigning one creates a member with no Square subscription.
 */
export const MembershipPlans: CollectionConfig = {
  slug: 'membership-plans',
  admin: {
    group: 'Studio',
    useAsTitle: 'name',
    defaultColumns: ['name', 'kind', 'priceCents', 'cadence', 'active'],
  },
  access: {
    read: isAdminOrEditor,
    create: isAdminOrEditor,
    update: isAdminOrEditor,
    delete: isAdmin,
  },
  fields: [
    { name: 'name', type: 'text', required: true },
    {
      name: 'kind',
      type: 'select',
      required: true,
      defaultValue: 'square',
      options: [
        { label: 'Square (billed)', value: 'square' },
        { label: 'Free (no billing)', value: 'free' },
      ],
    },
    {
      name: 'squarePlanVariationId',
      type: 'text',
      index: true,
      admin: { readOnly: true, description: 'Synced from Square; empty for Free plans.' },
    },
    {
      name: 'priceCents',
      type: 'number',
      admin: {
        readOnly: true,
        description: 'Synced from Square.',
        components: { Cell: '/admin/PriceCell#PriceCell' },
      },
    },
    { name: 'cadence', type: 'text', admin: { readOnly: true, description: 'e.g. MONTHLY (synced).' } },
    {
      name: 'active',
      type: 'checkbox',
      defaultValue: true,
      admin: { description: 'Square plans removed from Square are set inactive by sync.' },
    },
  ],
}
```

- [ ] **Step 4: Register the collection**

In `src/payload.config.ts`:
1. Add the import near the other collection imports:
```ts
import { MembershipPlans } from './collections/MembershipPlans'
```
2. Add it to the `collections` array (after `Members`):
```ts
  collections: [Users, Members, MembershipPlans, Media, Classes, Bookings, Payments, FiringRequests],
```

- [ ] **Step 5: Add the `plan` relationship to Members**

In `src/collections/Members.ts`, add this field right after the `name` field (before the email comment):

```ts
    {
      name: 'plan',
      type: 'relationship',
      relationTo: 'membership-plans',
      hasMany: false,
      admin: { description: 'Membership plan. Use a Free plan for unbilled members.' },
      // Required only when first creating a member; existing members (created
      // before plans existed) can still be edited without being forced to set one.
      validate: (value: unknown, { operation }: { operation?: string }) => {
        if (operation === 'create' && !value) return 'Choose a plan (use the Free plan for unbilled members).'
        return true
      },
    },
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm exec vitest run --config ./vitest.config.mts tests/int/membership-plans.int.spec.ts`
Expected: PASS. (Dev `push` syncs the schema automatically for the test DB.)

- [ ] **Step 7: Generate the production migration**

Run: `pnpm payload migrate:create membership_plans`
Expected: a new pair of files in `src/migrations/` (`<timestamp>_membership_plans.ts/.json`) capturing the new `membership_plans` table + the `members.plan` FK column. Open the generated `.ts` and sanity-check it references `membership_plans` and a `plan` column on `members`.

- [ ] **Step 8: Typecheck + commit**

Run: `pnpm exec tsc --noEmit`
Expected: clean.

```bash
git add src/collections/MembershipPlans.ts src/collections/Members.ts src/payload.config.ts src/migrations tests/int/membership-plans.int.spec.ts
git commit -m "Add membership-plans collection and member.plan relationship"
```

---

## Task 2: Gateway — plan-aware subscription, cancel, list variations

**Files:**
- Modify: `src/lib/membership-gateway.ts`, `src/services/membership.ts` (adapt `createMembership` caller)
- Test: `tests/int/membership-gateway.int.spec.ts` (extend the existing hoisted-mock file)

- [ ] **Step 1: Write failing tests**

The file `tests/int/membership-gateway.int.spec.ts` already hoist-mocks `../../src/lib/square` with a `create` spy on `subscriptions`. Replace its mock setup so the mocked `subscriptions` also has `cancel`, and `catalog` has `list`, then add tests. Open the file and update the `vi.hoisted` + `vi.mock` block to:

```ts
const { create, cancel, list } = vi.hoisted(() => ({
  create: vi.fn(async () => ({ subscription: { id: 'sub_1', status: 'ACTIVE' } })),
  cancel: vi.fn(async () => ({})),
  list: vi.fn(async () => [] as any[]),
}))
vi.mock('../../src/lib/square', () => ({
  getSquareClient: () => ({ subscriptions: { create, cancel }, catalog: { list } }),
  SQUARE_LOCATION_ID: () => 'LOC1',
}))
```

Keep the existing cardless `createSubscription` test, but update it to pass a plan variation id and assert it's forwarded. Replace that test's body with:

```ts
  it('sends the given planVariationId and omits cardId when cardless', async () => {
    create.mockClear()
    await squareMembershipGateway.createSubscription({ customerId: 'cus_1', planVariationId: 'PV_1' })
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ customerId: 'cus_1', planVariationId: 'PV_1' }))
    expect(create).toHaveBeenCalledWith(expect.not.objectContaining({ cardId: expect.anything() }))
  })
```

Then append:

```ts
describe('squareMembershipGateway.cancelSubscription', () => {
  it('cancels via the Square API', async () => {
    cancel.mockClear()
    await squareMembershipGateway.cancelSubscription('sub_9')
    expect(cancel).toHaveBeenCalledWith({ subscriptionId: 'sub_9' })
  })
})

describe('squareMembershipGateway.listPlanVariations', () => {
  it('flattens catalog plans + variations into {variationId, planName, priceCents, cadence}', async () => {
    list.mockImplementation(async () => [
      { id: 'PLAN_A', type: 'SUBSCRIPTION_PLAN', subscriptionPlanData: { name: 'Studio' } },
      {
        id: 'PV_A', type: 'SUBSCRIPTION_PLAN_VARIATION',
        subscriptionPlanVariationData: {
          name: 'Monthly', subscriptionPlanId: 'PLAN_A',
          phases: [{ cadence: 'MONTHLY', pricing: { priceMoney: { amount: 20000n, currency: 'USD' } } }],
        },
      },
    ])
    const out = await squareMembershipGateway.listPlanVariations()
    expect(out).toEqual([
      { variationId: 'PV_A', planName: 'Studio', variationName: 'Monthly', priceCents: 20000, cadence: 'MONTHLY' },
    ])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run --config ./vitest.config.mts tests/int/membership-gateway.int.spec.ts`
Expected: FAIL — new methods/params don't exist.

- [ ] **Step 3: Implement gateway changes**

In `src/lib/membership-gateway.ts`, update the interface and implementation. Change the `MembershipGateway` interface to:

```ts
export interface MembershipGateway {
  createCustomer(input: { name: string; email: string; phone?: string }): Promise<{ customerId: string }>
  saveCard(input: { customerId: string; sourceId: string }): Promise<{ cardId: string }>
  createSubscription(input: {
    customerId: string
    planVariationId: string
    cardId?: string
  }): Promise<{ subscriptionId: string; status: string }>
  cancelSubscription(subscriptionId: string): Promise<void>
  listPlanVariations(): Promise<
    Array<{ variationId: string; planName: string; variationName?: string; priceCents?: number; cadence?: string }>
  >
}
```

Replace the `createSubscription` implementation and add the two new methods inside `squareMembershipGateway`:

```ts
  async createSubscription({ customerId, planVariationId, cardId }) {
    const client = getSquareClient()
    const res = await client.subscriptions.create({
      idempotencyKey: randomUUID(),
      locationId: SQUARE_LOCATION_ID(),
      planVariationId,
      customerId,
      // Cardless → Square emails the member an invoice each period (auto-pay opt-in).
      ...(cardId ? { cardId } : {}),
    })
    const sub = res.subscription
    if (!sub?.id) throw new Error('Square subscription was not created')
    return { subscriptionId: sub.id, status: sub.status ?? 'ACTIVE' }
  },

  async cancelSubscription(subscriptionId) {
    const client = getSquareClient()
    await client.subscriptions.cancel({ subscriptionId })
  },

  async listPlanVariations() {
    const client = getSquareClient()
    const res: any = await client.catalog.list({ types: 'SUBSCRIPTION_PLAN,SUBSCRIPTION_PLAN_VARIATION' })
    const objects: any[] = []
    if (res && typeof res[Symbol.asyncIterator] === 'function') {
      for await (const o of res) objects.push(o)
    } else if (Array.isArray(res?.data)) objects.push(...res.data)
    else if (Array.isArray(res?.objects)) objects.push(...res.objects)
    else if (Array.isArray(res)) objects.push(...res)

    const planName = new Map<string, string>()
    for (const o of objects) {
      if (o.type === 'SUBSCRIPTION_PLAN') planName.set(o.id, o.subscriptionPlanData?.name ?? '(unnamed plan)')
    }
    return objects
      .filter((o) => o.type === 'SUBSCRIPTION_PLAN_VARIATION')
      .map((o) => {
        const d = o.subscriptionPlanVariationData
        const phase = d?.phases?.[0]
        const amount = phase?.pricing?.priceMoney?.amount
        return {
          variationId: o.id as string,
          planName: planName.get(d?.subscriptionPlanId) ?? '(unknown plan)',
          variationName: d?.name as string | undefined,
          priceCents: amount != null ? Number(amount) : undefined,
          cadence: phase?.cadence as string | undefined,
        }
      })
  },
```

- [ ] **Step 4: Adapt the `createMembership` caller (card-based signup)**

In `src/services/membership.ts`, `createMembership` currently calls `gateway.createSubscription({ customerId, cardId })`, which no longer compiles. Add a `planVariationId` to `MembershipInput` and pass it through:

In `MembershipInput` add:
```ts
  planVariationId: string
```
Change the call to:
```ts
  const { subscriptionId, status } = await gateway.createSubscription({ customerId, cardId, planVariationId: input.planVariationId })
```
(If `tests/int/membership-service.int.spec.ts` calls `createMembership`, add `planVariationId: 'PV_TEST'` to its input and any fake-gateway assertions — keep its other assertions unchanged.)

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm exec vitest run --config ./vitest.config.mts tests/int/membership-gateway.int.spec.ts tests/int/membership-service.int.spec.ts && pnpm exec tsc --noEmit`
Expected: all PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/membership-gateway.ts src/services/membership.ts tests/int/membership-gateway.int.spec.ts tests/int/membership-service.int.spec.ts
git commit -m "Gateway: plan-aware createSubscription, cancelSubscription, listPlanVariations"
```

---

## Task 3: syncSquarePlans service

**Files:**
- Create: `src/services/sync-square-plans.ts`
- Test: `tests/int/sync-square-plans.int.spec.ts` (new)

- [ ] **Step 1: Write failing tests**

Create `tests/int/sync-square-plans.int.spec.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { syncSquarePlans } from '../../src/services/sync-square-plans'

function fakePayload(existing: any[] = []) {
  const calls: any[] = []
  return {
    calls,
    find: vi.fn(async ({ where }: any) => {
      // matches by squarePlanVariationId equals, or kind equals 'square'
      const eqId = where?.squarePlanVariationId?.equals
      if (eqId) return { docs: existing.filter((d) => d.squarePlanVariationId === eqId) }
      if (where?.kind?.equals === 'square') return { docs: existing.filter((d) => d.kind === 'square') }
      return { docs: [] }
    }),
    create: vi.fn(async ({ data }: any) => { calls.push(['create', data]); return { id: 'new', ...data } }),
    update: vi.fn(async ({ id, data }: any) => { calls.push(['update', id, data]); return { id, ...data } }),
  } as any
}

const gateway = (variations: any[]) => ({ listPlanVariations: vi.fn(async () => variations) }) as any

describe('syncSquarePlans', () => {
  it('creates a square plan record for a new variation', async () => {
    const payload = fakePayload([])
    await syncSquarePlans({ payload, gateway: gateway([
      { variationId: 'PV_1', planName: 'Studio', variationName: 'Monthly', priceCents: 20000, cadence: 'MONTHLY' },
    ]) })
    expect(payload.create).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'membership-plans',
        data: expect.objectContaining({ kind: 'square', squarePlanVariationId: 'PV_1', priceCents: 20000, cadence: 'MONTHLY', active: true }),
      }),
    )
  })

  it('updates an existing square plan record', async () => {
    const payload = fakePayload([{ id: 7, kind: 'square', squarePlanVariationId: 'PV_1' }])
    await syncSquarePlans({ payload, gateway: gateway([
      { variationId: 'PV_1', planName: 'Studio', variationName: 'Monthly', priceCents: 25000, cadence: 'MONTHLY' },
    ]) })
    expect(payload.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7, data: expect.objectContaining({ priceCents: 25000, active: true }) }),
    )
  })

  it('marks square plans missing from Square as inactive, never touches free plans', async () => {
    const payload = fakePayload([
      { id: 1, kind: 'square', squarePlanVariationId: 'PV_GONE', active: true },
      { id: 2, kind: 'free' },
    ])
    await syncSquarePlans({ payload, gateway: gateway([]) })
    expect(payload.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, data: expect.objectContaining({ active: false }) }),
    )
    // free plan id:2 never updated
    expect(payload.update.mock.calls.find((c) => c[0].id === 2)).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run --config ./vitest.config.mts tests/int/sync-square-plans.int.spec.ts`
Expected: FAIL — `syncSquarePlans` not found.

- [ ] **Step 3: Implement**

Create `src/services/sync-square-plans.ts`:

```ts
import type { Payload } from 'payload'
import type { MembershipGateway } from '../lib/membership-gateway'

export interface SyncPlansDeps {
  payload: Payload
  gateway: MembershipGateway
}

/**
 * Upsert a membership-plans record per Square subscription plan variation, and
 * deactivate `square` plans whose variation no longer exists in Square. Never
 * touches `free` plans. Idempotent; safe to run repeatedly.
 */
export async function syncSquarePlans({ payload, gateway }: SyncPlansDeps): Promise<void> {
  const variations = await gateway.listPlanVariations()
  const seen = new Set<string>()

  for (const v of variations) {
    seen.add(v.variationId)
    const data = {
      name: v.variationName ? `${v.planName} — ${v.variationName}` : v.planName,
      kind: 'square' as const,
      squarePlanVariationId: v.variationId,
      priceCents: v.priceCents,
      cadence: v.cadence,
      active: true,
    }
    const { docs } = await payload.find({
      collection: 'membership-plans',
      where: { squarePlanVariationId: { equals: v.variationId } },
      limit: 1,
      overrideAccess: true,
    })
    if (docs[0]) {
      await payload.update({ collection: 'membership-plans', id: docs[0].id, overrideAccess: true, context: { fromPlanSync: true }, data })
    } else {
      await payload.create({ collection: 'membership-plans', overrideAccess: true, context: { fromPlanSync: true }, data })
    }
  }

  const { docs: squarePlans } = await payload.find({
    collection: 'membership-plans',
    where: { kind: { equals: 'square' } },
    limit: 1000,
    overrideAccess: true,
  })
  for (const p of squarePlans) {
    if (!seen.has(p.squarePlanVariationId ?? '') && p.active !== false) {
      await payload.update({ collection: 'membership-plans', id: p.id, overrideAccess: true, context: { fromPlanSync: true }, data: { active: false } })
    }
  }
}
```

- [ ] **Step 4: Run + typecheck**

Run: `pnpm exec vitest run --config ./vitest.config.mts tests/int/sync-square-plans.int.spec.ts && pnpm exec tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add src/services/sync-square-plans.ts tests/int/sync-square-plans.int.spec.ts
git commit -m "Add syncSquarePlans service (upsert from Square, deactivate removed)"
```

---

## Task 4: reconcileMemberPlan service

**Files:**
- Modify: `src/services/membership.ts` (replace `provisionMemberSubscription` with `reconcileMemberPlan`)
- Test: `tests/int/membership-provision.int.spec.ts` (rewrite the provision describe block)

- [ ] **Step 1: Write failing tests**

In `tests/int/membership-provision.int.spec.ts`, replace the entire `describe('provisionMemberSubscription', ...)` block (keep the file's other blocks/imports; add `import { reconcileMemberPlan } from '../../src/services/membership'` if not present) with:

```ts
describe('reconcileMemberPlan', () => {
  const FREE = { id: 'p_free', kind: 'free', squarePlanVariationId: null }
  const SQ_A = { id: 'p_a', kind: 'square', squarePlanVariationId: 'PV_A' }
  const SQ_B = { id: 'p_b', kind: 'square', squarePlanVariationId: 'PV_B' }

  function setup(plansById: Record<string, any>) {
    const update = vi.fn(async (a: any) => ({ id: a.id, ...a.data }))
    const findByID = vi.fn(async ({ id }: any) => plansById[id])
    const payload = { update, findByID } as any
    return { payload, update }
  }
  const req = { transactionID: 'tx' } as any

  it('Free on create: no Square calls, status FREE', async () => {
    const { payload, update } = setup({ p_free: FREE })
    const gateway = fakeGateway()
    await reconcileMemberPlan({ payload, gateway, req }, {
      member: { id: 1, name: 'A', email: 'a@test.local', phone: null, plan: 'p_free', squareCustomerId: null, squareSubscriptionId: null },
      previousDoc: undefined,
    })
    expect(gateway.createSubscription).not.toHaveBeenCalled()
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ req, data: expect.objectContaining({ subscriptionStatus: 'FREE', squareSubscriptionId: null }) }))
  })

  it('Square on create: creates customer + subscription on the plan variation', async () => {
    const { payload, update } = setup({ p_a: SQ_A })
    const gateway = fakeGateway()
    await reconcileMemberPlan({ payload, gateway, req }, {
      member: { id: 2, name: 'B', email: 'b@test.local', phone: null, plan: 'p_a', squareCustomerId: null, squareSubscriptionId: null },
      previousDoc: undefined,
    })
    expect(gateway.createCustomer).toHaveBeenCalled()
    expect(gateway.createSubscription).toHaveBeenCalledWith({ customerId: 'cus_x', planVariationId: 'PV_A' })
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ req, data: expect.objectContaining({ squareSubscriptionId: 'sub_x', subscriptionStatus: 'ACTIVE' }) }))
  })

  it('Square→Square swap: cancels old, reuses customer, creates new', async () => {
    const { payload } = setup({ p_b: SQ_B })
    const gateway = fakeGateway()
    await reconcileMemberPlan({ payload, gateway, req }, {
      member: { id: 3, name: 'C', email: 'c@test.local', phone: null, plan: 'p_b', squareCustomerId: 'cus_old', squareSubscriptionId: 'sub_old' },
      previousDoc: { plan: 'p_a' },
    })
    expect(gateway.cancelSubscription).toHaveBeenCalledWith('sub_old')
    expect(gateway.createCustomer).not.toHaveBeenCalled() // reuse existing customer
    expect(gateway.createSubscription).toHaveBeenCalledWith({ customerId: 'cus_old', planVariationId: 'PV_B' })
  })

  it('Square→Free: cancels subscription, status FREE', async () => {
    const { payload, update } = setup({ p_free: FREE })
    const gateway = fakeGateway()
    await reconcileMemberPlan({ payload, gateway, req }, {
      member: { id: 4, name: 'D', email: 'd@test.local', phone: null, plan: 'p_free', squareCustomerId: 'cus_1', squareSubscriptionId: 'sub_1' },
      previousDoc: { plan: 'p_a' },
    })
    expect(gateway.cancelSubscription).toHaveBeenCalledWith('sub_1')
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ subscriptionStatus: 'FREE', squareSubscriptionId: null }) }))
  })

  it('unchanged Square plan: no Square calls', async () => {
    const { payload } = setup({ p_a: SQ_A })
    const gateway = fakeGateway()
    await reconcileMemberPlan({ payload, gateway, req }, {
      member: { id: 5, name: 'E', email: 'e@test.local', phone: null, plan: 'p_a', squareCustomerId: 'cus_1', squareSubscriptionId: 'sub_1' },
      previousDoc: { plan: 'p_a' },
    })
    expect(gateway.createSubscription).not.toHaveBeenCalled()
    expect(gateway.cancelSubscription).not.toHaveBeenCalled()
  })

  it('records SETUP_FAILED with the reason when Square throws', async () => {
    const { payload, update } = setup({ p_a: SQ_A })
    const err: any = new Error('Status code: 400'); err.errors = [{ detail: 'plan ID does not match' }]
    const gateway = fakeGateway({ createSubscription: vi.fn(async () => { throw err }) })
    await reconcileMemberPlan({ payload, gateway, req }, {
      member: { id: 6, name: 'F', email: 'f@test.local', phone: null, plan: 'p_a', squareCustomerId: null, squareSubscriptionId: null },
      previousDoc: undefined,
    })
    const last = update.mock.calls.at(-1)![0].data
    expect(last.subscriptionStatus).toMatch(/^SETUP_FAILED/)
    expect(last.subscriptionStatus).toContain('plan ID does not match')
  })
})
```

Update `fakeGateway` in this file to include `cancelSubscription` and `listPlanVariations` so it matches the interface:
```ts
function fakeGateway(over: Partial<MembershipGateway> = {}): MembershipGateway {
  return {
    createCustomer: vi.fn(async () => ({ customerId: 'cus_x' })),
    saveCard: vi.fn(async () => ({ cardId: 'card_x' })),
    createSubscription: vi.fn(async () => ({ subscriptionId: 'sub_x', status: 'ACTIVE' })),
    cancelSubscription: vi.fn(async () => undefined),
    listPlanVariations: vi.fn(async () => []),
    ...over,
  }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run --config ./vitest.config.mts tests/int/membership-provision.int.spec.ts -t "reconcileMemberPlan"`
Expected: FAIL — `reconcileMemberPlan` not exported.

- [ ] **Step 3: Implement**

In `src/services/membership.ts`: remove `provisionMemberSubscription`, the `membershipPlanConfigured` helper, and the placeholder/NOT_CONFIGURED env logic. Keep `squareErrorReason`. Add (keep `ProvisionDeps` but rename to `ReconcileDeps` for clarity, or add a new interface):

```ts
export interface ReconcileDeps {
  payload: Payload
  gateway: MembershipGateway
  req?: PayloadRequest // thread the hook's req so write-backs join the save transaction
}

type MemberSnapshot = {
  id: string | number
  name: string
  email: string
  phone?: string | null
  plan?: string | number | { id: string | number } | null
  squareCustomerId?: string | null
  squareSubscriptionId?: string | null
}

const planId = (p: MemberSnapshot['plan']): string | number | null =>
  p == null ? null : typeof p === 'object' ? p.id : p

/**
 * Reconcile a member's Square subscription to match their assigned plan.
 * Free → no subscription (cancel any existing). Square → ensure a cardless
 * subscription on the plan's variation (swap if the plan changed). Reuses the
 * member's existing Square customer. All write-backs thread `req`.
 */
export async function reconcileMemberPlan(
  deps: ReconcileDeps,
  args: { member: MemberSnapshot; previousDoc?: { plan?: MemberSnapshot['plan'] } | undefined },
): Promise<void> {
  const { payload, gateway, req } = deps
  const { member, previousDoc } = args

  const write = (data: Record<string, unknown>) =>
    payload.update({ collection: 'members', id: member.id, overrideAccess: true, req, context: { fromMemberHook: true }, data })

  const currentPlanId = planId(member.plan)
  if (!currentPlanId) return // no plan assigned → leave as-is

  const plan: any = await payload.findByID({ collection: 'membership-plans', id: currentPlanId, req, overrideAccess: true })
  if (!plan) return

  try {
    if (plan.kind === 'free') {
      if (member.squareSubscriptionId) await gateway.cancelSubscription(member.squareSubscriptionId)
      await write({ squareSubscriptionId: null, subscriptionStatus: 'FREE' })
      return
    }

    // square plan
    const planVariationId: string | undefined = plan.squarePlanVariationId
    if (!planVariationId) {
      await write({ subscriptionStatus: 'NOT_CONFIGURED' })
      return
    }

    const planChanged = planId(previousDoc?.plan) !== currentPlanId
    if (member.squareSubscriptionId && !planChanged) return // already on this plan

    if (member.squareSubscriptionId && planChanged) {
      await gateway.cancelSubscription(member.squareSubscriptionId)
    }

    const customerId =
      member.squareCustomerId ??
      (await gateway.createCustomer({ name: member.name, email: member.email, phone: member.phone ?? undefined })).customerId
    const { subscriptionId, status } = await gateway.createSubscription({ customerId, planVariationId })
    await write({ squareCustomerId: customerId, squareSubscriptionId: subscriptionId, subscriptionStatus: status })
  } catch (e) {
    console.error(`Member ${member.id} plan reconcile failed:`, e)
    await write({ subscriptionStatus: `SETUP_FAILED: ${squareErrorReason(e)}`.slice(0, 240) })
  }
}
```

Note: the `squareErrorReason` helper from the prior work stays. Ensure imports include `Payload, PayloadRequest` and `MembershipGateway`.

- [ ] **Step 4: Run + typecheck**

Run: `pnpm exec vitest run --config ./vitest.config.mts tests/int/membership-provision.int.spec.ts && pnpm exec tsc --noEmit`
Expected: PASS, clean. (The old NOT_CONFIGURED/placeholder tests were replaced by the reconcile block.)

- [ ] **Step 5: Commit**

```bash
git add src/services/membership.ts tests/int/membership-provision.int.spec.ts
git commit -m "Replace provision with reconcileMemberPlan (free/square/swap, req-threaded)"
```

---

## Task 5: Reconcile hook + wire into Members

**Files:**
- Create: `src/hooks/reconcileMemberSubscription.ts`
- Delete: `src/hooks/provisionSquareSubscription.ts`
- Modify: `src/collections/Members.ts`
- Test: `tests/int/provision-hook-guards.int.spec.ts` (rewrite for the reconcile hook)

- [ ] **Step 1: Rewrite the failing guard tests**

Replace the contents of `tests/int/provision-hook-guards.int.spec.ts` with:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const reconcileMock = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('../../src/services/membership', () => ({ reconcileMemberPlan: reconcileMock }))

import { reconcileMemberSubscription } from '../../src/hooks/reconcileMemberSubscription'

const baseReq: any = { payload: {}, context: {} }
const baseDoc: any = { id: 1, name: 'A', email: 'a@test.local', phone: null, plan: 'p_a', squareSubscriptionId: null }

async function ran(args: any) {
  reconcileMock.mockClear()
  await reconcileMemberSubscription({ operation: 'create', req: baseReq, doc: baseDoc, previousDoc: undefined, ...args } as any)
  return reconcileMock.mock.calls.length > 0
}

describe('reconcileMemberSubscription hook guards', () => {
  beforeEach(() => reconcileMock.mockClear())

  it('runs on create', async () => {
    expect(await ran({})).toBe(true)
  })
  it('runs on update when the plan changed', async () => {
    expect(await ran({ operation: 'update', doc: { ...baseDoc, plan: 'p_b' }, previousDoc: { plan: 'p_a' } })).toBe(true)
  })
  it('skips on update when the plan is unchanged', async () => {
    expect(await ran({ operation: 'update', doc: { ...baseDoc, plan: 'p_a' }, previousDoc: { plan: 'p_a' } })).toBe(false)
  })
  it('skips our own write-back', async () => {
    expect(await ran({ req: { ...baseReq, context: { fromMemberHook: true } } })).toBe(false)
  })
  it('skips the Square webhook', async () => {
    expect(await ran({ req: { ...baseReq, context: { fromSquareWebhook: true } } })).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run --config ./vitest.config.mts tests/int/provision-hook-guards.int.spec.ts`
Expected: FAIL — `reconcileMemberSubscription` hook does not exist.

- [ ] **Step 3: Create the hook**

Create `src/hooks/reconcileMemberSubscription.ts`:

```ts
import type { CollectionAfterChangeHook } from 'payload'
import { squareMembershipGateway } from '../lib/membership-gateway'
import { reconcileMemberPlan } from '../services/membership'
import type { Member } from '../payload-types'

const planId = (p: unknown): unknown => (p && typeof p === 'object' ? (p as { id: unknown }).id : p)

/**
 * Keep a member's Square subscription in sync with their assigned plan. Runs on
 * create, and on update only when the plan changed. Skips our own write-back and
 * webhook-driven changes.
 */
export const reconcileMemberSubscription: CollectionAfterChangeHook<Member> = async ({ doc, previousDoc, operation, req }) => {
  if (req?.context?.fromMemberHook) return doc
  if (req?.context?.fromSquareWebhook) return doc
  const planChanged = planId(doc.plan) !== planId(previousDoc?.plan)
  if (operation !== 'create' && !planChanged) return doc

  try {
    await reconcileMemberPlan(
      { payload: req.payload, gateway: squareMembershipGateway, req },
      { member: doc as any, previousDoc: previousDoc as any },
    )
  } catch (e) {
    console.error(`Member ${doc.id} reconcile hook error:`, e)
  }
  return doc
}
```

- [ ] **Step 4: Wire it into Members; delete the old hook**

In `src/collections/Members.ts`:
1. Replace the import `import { provisionSquareSubscription } from '../hooks/provisionSquareSubscription'` with:
```ts
import { reconcileMemberSubscription } from '../hooks/reconcileMemberSubscription'
```
2. Change `afterChange: [provisionSquareSubscription, cancelSquareSubscription]` to:
```ts
    afterChange: [reconcileMemberSubscription, cancelSquareSubscription],
```
3. Delete the file `src/hooks/provisionSquareSubscription.ts`.

- [ ] **Step 5: Run guard tests + full suite + typecheck**

Run: `pnpm exec vitest run --config ./vitest.config.mts tests/int/provision-hook-guards.int.spec.ts && pnpm exec tsc --noEmit`
Expected: PASS (5 guard cases), clean.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/reconcileMemberSubscription.ts src/collections/Members.ts tests/int/provision-hook-guards.int.spec.ts
git rm src/hooks/provisionSquareSubscription.ts
git commit -m "Reconcile member Square subscription from assigned plan (create + plan change)"
```

---

## Task 6: Webhook sync + startup sync + cleanup

**Files:**
- Modify: `src/app/api/webhooks/square/route.ts`, `src/payload.config.ts`, `.env.example`
- Delete: `scripts/list-membership-plans.ts`
- Test: `tests/int/catalog-webhook-sync.int.spec.ts` (new)

- [ ] **Step 1: Write the failing webhook test**

The webhook route reads a raw request and branches on `event.type`. Test the branch by importing a small extracted helper. To keep it testable without HTTP, add the sync branch to call an exported `handleCatalogVersionUpdated(payload)` and test that. Create `tests/int/catalog-webhook-sync.int.spec.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'

const syncMock = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('../../src/services/sync-square-plans', () => ({ syncSquarePlans: syncMock }))

import { handleCatalogVersionUpdated } from '../../src/app/api/webhooks/square/route'

describe('catalog.version.updated webhook', () => {
  it('triggers a plan sync', async () => {
    syncMock.mockClear()
    await handleCatalogVersionUpdated({} as any)
    expect(syncMock).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run --config ./vitest.config.mts tests/int/catalog-webhook-sync.int.spec.ts`
Expected: FAIL — `handleCatalogVersionUpdated` not exported.

- [ ] **Step 3: Add the webhook branch**

In `src/app/api/webhooks/square/route.ts`:
1. Add imports at the top:
```ts
import { syncSquarePlans } from '../../../../services/sync-square-plans'
import { squareMembershipGateway } from '../../../../lib/membership-gateway'
```
(verify the relative depth matches the file's other imports — mirror how `createPaidBooking`/`sendEmail` are imported in sibling routes.)
2. Add an exported helper above `POST`:
```ts
export async function handleCatalogVersionUpdated(payload: Awaited<ReturnType<typeof getPayload>>) {
  await syncSquarePlans({ payload, gateway: squareMembershipGateway })
}
```
3. Add a branch to the event chain (after the `subscription.updated` branch):
```ts
  } else if (event.type === 'catalog.version.updated') {
    await handleCatalogVersionUpdated(payload)
```

- [ ] **Step 4: Add the startup sync (test-guarded)**

In `src/payload.config.ts`, add an import:
```ts
import { syncSquarePlans } from './services/sync-square-plans'
import { squareMembershipGateway } from './lib/membership-gateway'
```
and add an `onInit` to `buildConfig({ ... })` (top-level option):
```ts
  onInit: async (payload) => {
    // Keep the Plans list seeded/fresh on boot. Skipped in tests (never hit Square
    // in CI) and when Square isn't configured. Never blocks/breaks boot.
    if (process.env.NODE_ENV === 'test' || !process.env.SQUARE_ACCESS_TOKEN) return
    try {
      await syncSquarePlans({ payload, gateway: squareMembershipGateway })
    } catch (e) {
      payload.logger.error(`Startup plan sync failed: ${e instanceof Error ? e.message : e}`)
    }
  },
```

- [ ] **Step 5: Cleanup**

1. Delete `scripts/list-membership-plans.ts`.
2. In `.env.example`, remove the `SQUARE_MEMBERSHIP_PLAN_VARIATION_ID=...` line. Then `grep -rn "SQUARE_MEMBERSHIP_PLAN_VARIATION_ID" src scripts` — expect **no matches** (all reads removed). If any remain, they're stale and must be removed.

- [ ] **Step 6: Run test + full suite + typecheck**

Run: `pnpm exec vitest run --config ./vitest.config.mts && pnpm exec tsc --noEmit`
Expected: ALL integration tests PASS, clean. (Confirms nothing else referenced the removed env var or old hook.)

- [ ] **Step 7: Commit**

```bash
git add src/app/api/webhooks/square/route.ts src/payload.config.ts .env.example tests/int/catalog-webhook-sync.int.spec.ts
git rm scripts/list-membership-plans.ts
git commit -m "Sync plans on catalog.version.updated webhook and on startup; drop plan env var"
```

---

## Task 7: Manual sandbox verification

Automated tests never touch Square. Verify the real flow by hand.

**Files:** none (verification only)

- [ ] **Step 1: Start the app, log into the admin**

Run: `pnpm dev` → `http://localhost:3000/admin`.

- [ ] **Step 2: Plans sync (Square → admin, read-only)**

In the Square **sandbox** Dashboard, create a subscription plan (e.g. $200/mo) if none exists. Restart the app (triggers the startup sync) or trigger a catalog change. Open **Membership Plans** in the admin → confirm a `square`-kind plan appears with the right name/price/cadence and its fields are read-only.

- [ ] **Step 3: Create the Free plan**

In the admin, create a Membership Plan: name "Free", kind "Free".

- [ ] **Step 4: Member on a Square plan**

Create an Active member, assign the Square plan → confirm a Square customer + subscription appear in the sandbox, the member row gets `squareSubscriptionId` + status, the invoice email arrives, and the save doesn't hang.

- [ ] **Step 5: Member on Free**

Create a member assigned the Free plan → confirm NO Square customer/subscription, `subscriptionStatus: FREE`.

- [ ] **Step 6: Plan change reconciles**

Edit a Free member → change to the Square plan → confirm a subscription is created. Edit a Square member → change to Free → confirm the subscription is cancelled in the sandbox and status becomes FREE.

- [ ] **Step 7: Confirm member login still disabled, and the production migration is committed**

Confirm `src/migrations/` contains the generated membership_plans migration (committed in Task 1) so production applies it on deploy.

---

## Self-Review Notes

- **Spec coverage:** Plans collection (T1) with read-only square fields + Free; member.plan required-on-create (T1); gateway plan-aware + cancel + list (T2); syncSquarePlans (T3); reconcile matrix free/square/swap/unchanged/error (T4); reconcile hook create+plan-change with guards, old hook deleted (T5); catalog webhook + startup sync (test-guarded) + env-var/script removal (T6); migration generated + committed (T1 Step 7); existing members untouched (reconcile returns early when no plan / plan unchanged); manual Square checks (T7).
- **Type consistency:** `createSubscription({ customerId, planVariationId, cardId? })` defined T2, called in T4 reconcile and T2 createMembership. `cancelSubscription(id)` / `listPlanVariations()` defined T2, used T3/T4. `reconcileMemberPlan(deps, { member, previousDoc })` defined T4, called by the hook T5. `reconcileMemberSubscription` hook defined T5, wired in Members + mocked in T5 guard test. `syncSquarePlans({ payload, gateway })` defined T3, called T6 webhook + onInit. Context flags `fromMemberHook` / `fromSquareWebhook` / `fromPlanSync` consistent.
- **Test hermeticity:** every member-creating integration test uses a Free plan (no Square); square paths are fake-gateway/mock-payload; gateway test hoist-mocks square in its own file; startup sync guarded by `NODE_ENV==='test'`. No live Square calls in CI.
- **Deadlock safety:** reconcile write-backs thread `req` (T4), asserted in the reconcile tests.
- **No placeholders:** every step has concrete code/commands/expected output.

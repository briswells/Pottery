# Square Member Auto-Create Implementation Plan (Phase 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-create a member (a Person promoted to membership) when a subscription is created directly in Square, via a shared service reused by the webhook, a missed-event safety net, and the import script.

**Architecture:** A new `ensureMemberFromSubscription` service is the single seam for "make sure a member exists for this Square subscription": it maps the plan variation to a `membership-plans` record, finds-or-creates the Person by the Square customer's email (reusing Phase 1's `upsertPersonByEmail`), and promotes them to a member with the subscription marked `fromSquareWebhook` so it never loops back to create a new Square subscription. The webhook gains a `subscription.created` branch plus a safety net on subscription/invoice events; the import script is refactored onto the same service. Two read methods (`getSubscription`, `getCustomer`) are added to the gateway so it's injectable and testable.

**Tech Stack:** Payload 3.85 (Postgres), Next.js 16, Square SDK v44, Vitest integration tests (mocked gateway — never hits Square).

**Spec:** `docs/superpowers/specs/2026-06-12-square-member-autocreate-design.md`
**Builds on:** Phase 1 (`docs/superpowers/specs/2026-06-12-person-foundation-design.md`) — the `people` collection and `src/services/people.ts` `upsertPersonByEmail`.

---

## File Structure

- `src/lib/membership-gateway.ts` — add `getSubscription` + `getCustomer` to the `MembershipGateway` interface and the Square implementation.
- `src/services/square-member-sync.ts` — **new**; `ensureMemberFromSubscription` + the shared `SQUARE_SUBSCRIPTION_STATUS_MAP`.
- `src/app/api/webhooks/square/route.ts` — new `subscription.created` branch + missed-event safety net on `subscription.updated` / `invoice.payment_made` / `invoice.updated`; export thin helpers for testing.
- `scripts/import-square-members.ts` — refactor the per-subscription block to call `ensureMemberFromSubscription`.
- Tests: `tests/int/square-member-sync.int.spec.ts` (new), additions to `tests/int/membership-gateway.int.spec.ts`, and `tests/int/square-autocreate-webhook.int.spec.ts` (new).

---

## Task 1: Gateway reads — `getSubscription` + `getCustomer`

**Files:**
- Modify: `src/lib/membership-gateway.ts`
- Test: `tests/int/membership-gateway.int.spec.ts`

- [ ] **Step 1: Add the failing test** (append to `tests/int/membership-gateway.int.spec.ts`)

The existing file mocks `getSquareClient` (see top of file). Extend the mock's client to include `subscriptions.get` and `customers.get`, then add tests. Change the `vi.hoisted`/`vi.mock` block at the top so the client also exposes those methods:

```ts
// at top, extend the hoisted stubs:
const { create, cancel, list, getSub, getCust } = vi.hoisted(() => ({
  create: vi.fn(async () => ({ subscription: { id: 'sub_1', status: 'ACTIVE' } })),
  cancel: vi.fn(async () => ({})),
  list: vi.fn(async () => [] as any[]),
  getSub: vi.fn(async () => ({ subscription: { id: 'sub_9', customerId: 'cus_9', planVariationId: 'PV_9', status: 'ACTIVE', startDate: '2026-01-01' } })),
  getCust: vi.fn(async () => ({ customer: { id: 'cus_9', emailAddress: 'c@x.com', givenName: 'Cee', familyName: 'Ess', phoneNumber: '555' } })),
}))
vi.mock('../../src/lib/square', () => ({
  getSquareClient: () => ({ subscriptions: { create, cancel, get: getSub }, customers: { get: getCust }, catalog: { list } }),
  SQUARE_LOCATION_ID: () => 'LOC1',
}))
```

Then add:

```ts
describe('squareMembershipGateway.getSubscription', () => {
  it('returns a normalized subscription', async () => {
    const out = await squareMembershipGateway.getSubscription('sub_9')
    expect(out).toEqual({ id: 'sub_9', customerId: 'cus_9', planVariationId: 'PV_9', status: 'ACTIVE', startDate: '2026-01-01' })
  })
  it('returns null when Square has no such subscription', async () => {
    getSub.mockResolvedValueOnce({ subscription: undefined } as any)
    expect(await squareMembershipGateway.getSubscription('missing')).toBeNull()
  })
})

describe('squareMembershipGateway.getCustomer', () => {
  it('returns a normalized customer (emailAddress→email, phoneNumber→phone)', async () => {
    const out = await squareMembershipGateway.getCustomer('cus_9')
    expect(out).toEqual({ id: 'cus_9', email: 'c@x.com', givenName: 'Cee', familyName: 'Ess', phone: '555' })
  })
  it('returns null when Square has no such customer', async () => {
    getCust.mockResolvedValueOnce({ customer: undefined } as any)
    expect(await squareMembershipGateway.getCustomer('missing')).toBeNull()
  })
})
```

- [ ] **Step 2: Run it — confirm FAIL**

Run: `pnpm run test:int tests/int/membership-gateway.int.spec.ts`
Expected: FAIL — `getSubscription`/`getCustomer` are not functions.

- [ ] **Step 3: Implement** (`src/lib/membership-gateway.ts`)

Add to the `MembershipGateway` interface (after `listPlanVariations`):

```ts
  getSubscription(subscriptionId: string): Promise<{
    id: string; customerId?: string; planVariationId?: string; status?: string; startDate?: string
  } | null>
  getCustomer(customerId: string): Promise<{
    id: string; email?: string; givenName?: string; familyName?: string; phone?: string
  } | null>
```

Add to the `squareMembershipGateway` object (after `listPlanVariations`):

```ts
  async getSubscription(subscriptionId) {
    const client = getSquareClient()
    const res = await client.subscriptions.get({ subscriptionId })
    const s = res.subscription
    if (!s?.id) return null
    return { id: s.id, customerId: s.customerId, planVariationId: s.planVariationId, status: s.status, startDate: s.startDate }
  },

  async getCustomer(customerId) {
    const client = getSquareClient()
    const res = await client.customers.get({ customerId })
    const c = res.customer
    if (!c?.id) return null
    return { id: c.id, email: c.emailAddress, givenName: c.givenName, familyName: c.familyName, phone: c.phoneNumber }
  },
```

- [ ] **Step 4: Run it — expect PASS.** `pnpm run test:int tests/int/membership-gateway.int.spec.ts`

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm exec tsc --noEmit
git add src/lib/membership-gateway.ts tests/int/membership-gateway.int.spec.ts
git commit -m "Add getSubscription + getCustomer reads to the membership gateway"
```

---

## Task 2: `ensureMemberFromSubscription` service

**Files:**
- Create: `src/services/square-member-sync.ts`
- Test: `tests/int/square-member-sync.int.spec.ts`

- [ ] **Step 1: Write the failing test** (`tests/int/square-member-sync.int.spec.ts`)

```ts
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { getTestPayload } from './helpers'
import { ensureMemberFromSubscription } from '../../src/services/square-member-sync'
import { upsertPersonByEmail } from '../../src/services/people'

// Block any real Square call from the reconcile hook so we can assert auto-create
// never provisions a NEW subscription (the subscription already exists in Square).
const sub = vi.hoisted(() => ({ create: vi.fn(), cancel: vi.fn(), pause: vi.fn() }))
vi.mock('../../src/lib/square', async (orig) => {
  const actual = await (orig() as Promise<any>)
  return { ...actual, getSquareClient: () => ({ subscriptions: sub }) }
})

// A fake gateway: only the methods the service uses (getCustomer + listPlanVariations for sync-on-miss).
function makeGateway(over: Partial<any> = {}) {
  return {
    getCustomer: vi.fn(async (id: string) => ({ id, email: `${id}@sq.local`, givenName: 'Sq', familyName: 'Person', phone: '555' })),
    listPlanVariations: vi.fn(async () => [] as any[]),
    ...over,
  } as any
}

async function makeSquarePlan(payload: any, variationId: string) {
  return payload.create({ collection: 'membership-plans', overrideAccess: true, context: { fromPlanSync: true },
    data: { name: `Plan ${variationId}`, kind: 'square', squarePlanVariationId: variationId, active: true } })
}

describe('ensureMemberFromSubscription', () => {
  beforeEach(() => { sub.create.mockClear() })
  afterEach(async () => {
    const payload = await getTestPayload()
    await payload.delete({ collection: 'people', where: { email: { like: '@sq.local' } } })
    await payload.delete({ collection: 'membership-plans', where: { name: { like: 'Plan ' } } })
  })

  it('creates a member from a subscription on a known plan and makes no Square subscription call', async () => {
    const payload = await getTestPayload()
    const plan = await makeSquarePlan(payload, 'PV_KNOWN')
    const gateway = makeGateway()
    const person = await ensureMemberFromSubscription({ payload, gateway }, {
      id: 'sub_known', customerId: 'cus_known', planVariationId: 'PV_KNOWN', status: 'ACTIVE', startDate: '2026-02-02',
    })
    expect(person).toBeTruthy()
    expect(person!.email).toBe('cus_known@sq.local')
    expect(person!.plan).toBe(plan.id)
    expect(person!.status).toBe('active')
    expect(person!.squareSubscriptionId).toBe('sub_known')
    expect(person!.subscriptionStatus).toBe('ACTIVE')
    expect(sub.create).not.toHaveBeenCalled()
  })

  it('is idempotent — a second call with the same subscription id creates no duplicate', async () => {
    const payload = await getTestPayload()
    await makeSquarePlan(payload, 'PV_IDEM')
    const gateway = makeGateway()
    const args = { id: 'sub_idem', customerId: 'cus_idem', planVariationId: 'PV_IDEM', status: 'ACTIVE' as const }
    const first = await ensureMemberFromSubscription({ payload, gateway }, args)
    const second = await ensureMemberFromSubscription({ payload, gateway }, args)
    expect(second!.id).toBe(first!.id)
    const count = await payload.count({ collection: 'people', where: { squareSubscriptionId: { equals: 'sub_idem' } } })
    expect(count.totalDocs).toBe(1)
  })

  it('promotes an existing non-member person (same email) in place — no duplicate', async () => {
    const payload = await getTestPayload()
    await makeSquarePlan(payload, 'PV_PROMO')
    const gateway = makeGateway()
    // Pre-existing class-taker: planless person with this email.
    const existing = await upsertPersonByEmail({ payload }, { name: 'Walk In', email: 'cus_promo@sq.local' })
    expect(existing.status).toBe('none')
    const person = await ensureMemberFromSubscription({ payload, gateway }, {
      id: 'sub_promo', customerId: 'cus_promo', planVariationId: 'PV_PROMO', status: 'ACTIVE',
    })
    expect(person!.id).toBe(existing.id)            // same person, promoted in place
    expect(person!.status).toBe('active')
    expect(person!.squareSubscriptionId).toBe('sub_promo')
    const count = await payload.count({ collection: 'people', where: { email: { equals: 'cus_promo@sq.local' } } })
    expect(count.totalDocs).toBe(1)
  })

  it('syncs plans on a miss, then creates the member', async () => {
    const payload = await getTestPayload()
    // Plan does NOT exist yet; the gateway will report it so syncSquarePlans creates it.
    const gateway = makeGateway({
      listPlanVariations: vi.fn(async () => [{ variationId: 'PV_SYNC', planName: 'Synced', variationName: 'Monthly', priceCents: 20000, cadence: 'MONTHLY' }]),
    })
    const person = await ensureMemberFromSubscription({ payload, gateway }, {
      id: 'sub_sync', customerId: 'cus_sync', planVariationId: 'PV_SYNC', status: 'ACTIVE',
    })
    expect(gateway.listPlanVariations).toHaveBeenCalled()
    expect(person).toBeTruthy()
    expect(person!.squareSubscriptionId).toBe('sub_sync')
    // cleanup the synced plan (named "Synced — Monthly")
    await payload.delete({ collection: 'membership-plans', where: { squarePlanVariationId: { equals: 'PV_SYNC' } }, overrideAccess: true })
  })

  it('returns null for an unknown plan variation (after attempting a sync)', async () => {
    const payload = await getTestPayload()
    const gateway = makeGateway() // listPlanVariations returns [] → sync creates nothing
    const person = await ensureMemberFromSubscription({ payload, gateway }, {
      id: 'sub_unknown', customerId: 'cus_unknown', planVariationId: 'PV_NOPE', status: 'ACTIVE',
    })
    expect(person).toBeNull()
  })

  it('returns null when customerId or planVariationId is missing', async () => {
    const payload = await getTestPayload()
    const gateway = makeGateway()
    expect(await ensureMemberFromSubscription({ payload, gateway }, { id: 'x', planVariationId: 'PV', status: 'ACTIVE' })).toBeNull()
    expect(await ensureMemberFromSubscription({ payload, gateway }, { id: 'y', customerId: 'cus', status: 'ACTIVE' })).toBeNull()
  })
})
```

- [ ] **Step 2: Run it — confirm FAIL** (`ensureMemberFromSubscription` not exported).

Run: `pnpm run test:int tests/int/square-member-sync.int.spec.ts`

- [ ] **Step 3: Implement** (`src/services/square-member-sync.ts`)

```ts
import type { Payload } from 'payload'
import type { MembershipGateway } from '../lib/membership-gateway'
import { syncSquarePlans } from './sync-square-plans'
import { upsertPersonByEmail } from './people'
import type { Person } from '../payload-types'

/** Square subscription status → our membership status. Shared by the webhook + import. */
export const SQUARE_SUBSCRIPTION_STATUS_MAP: Record<string, Person['status']> = {
  ACTIVE: 'active',
  PAUSED: 'paused',
  CANCELED: 'cancelled',
  DEACTIVATED: 'cancelled',
}

export interface SquareSubscriptionInput {
  id: string
  customerId?: string
  planVariationId?: string
  status?: string
  startDate?: string
}

export interface EnsureMemberDeps {
  payload: Payload
  gateway: MembershipGateway
}

async function findPlanByVariation(payload: Payload, variationId: string): Promise<number | null> {
  const { docs } = await payload.find({
    collection: 'membership-plans',
    where: { squarePlanVariationId: { equals: variationId } },
    limit: 1,
    overrideAccess: true,
  })
  return (docs[0]?.id as number | undefined) ?? null
}

/**
 * Ensure a member exists for this Square subscription. Maps the plan variation to
 * a known plan (syncing once on a miss), finds-or-creates the Person by the Square
 * customer's email, then promotes them to a member. Marked `fromSquareWebhook` so
 * the reconcile hook never tries to create a NEW Square subscription. Returns the
 * Person, or null when skipped (missing ids, or a plan we don't track).
 */
export async function ensureMemberFromSubscription(
  { payload, gateway }: EnsureMemberDeps,
  sub: SquareSubscriptionInput,
): Promise<Person | null> {
  // 1. Already linked → nothing to create; ongoing updates are owned elsewhere.
  const existingBySub = await payload.find({
    collection: 'people', where: { squareSubscriptionId: { equals: sub.id } }, limit: 1, overrideAccess: true,
  })
  if (existingBySub.docs[0]) return existingBySub.docs[0] as Person

  // 2. Need a customer + plan variation to make a member.
  if (!sub.customerId || !sub.planVariationId) {
    console.warn(`Square subscription ${sub.id} skipped: missing customerId or planVariationId.`)
    return null
  }

  // 3. Map the plan variation → a known plan; sync once on a miss.
  let planId = await findPlanByVariation(payload, sub.planVariationId)
  if (planId == null) {
    await syncSquarePlans({ payload, gateway })
    planId = await findPlanByVariation(payload, sub.planVariationId)
  }
  if (planId == null) {
    console.warn(`Square subscription ${sub.id} skipped: plan variation ${sub.planVariationId} is not a known membership plan.`)
    return null
  }

  // 4. Resolve the customer's contact details.
  const customer = await gateway.getCustomer(sub.customerId)
  const email = customer?.email ?? `${sub.customerId}@imported.portsidepottery.com`
  const name = [customer?.givenName, customer?.familyName].filter(Boolean).join(' ') || 'Imported Member'

  // 5. Find-or-create the Person (planless), enriching the Square customer id.
  const person = await upsertPersonByEmail({ payload }, { name, email, phone: customer?.phone, squareCustomerId: sub.customerId })

  // 6. Promote to member. fromSquareWebhook → reconcile hook will NOT create a new
  //    Square subscription (it already exists). joinedDate only if not already set.
  const status = SQUARE_SUBSCRIPTION_STATUS_MAP[sub.status ?? 'ACTIVE'] ?? 'active'
  const promoted = await payload.update({
    collection: 'people',
    id: person.id,
    overrideAccess: true,
    context: { fromSquareWebhook: true },
    data: {
      plan: planId,
      status,
      squareSubscriptionId: sub.id,
      subscriptionStatus: sub.status,
      ...(person.joinedDate ? {} : { joinedDate: sub.startDate }),
    },
  })
  return promoted as Person
}
```

- [ ] **Step 4: Run it — expect PASS** (all six cases). `pnpm run test:int tests/int/square-member-sync.int.spec.ts`

- [ ] **Step 5: Run the FULL suite** to confirm no regression: `pnpm run test:int`

- [ ] **Step 6: Commit**

```bash
git add src/services/square-member-sync.ts tests/int/square-member-sync.int.spec.ts
git commit -m "Add ensureMemberFromSubscription service (auto-create member from Square)"
```

---

## Task 3: Webhook — `subscription.created` branch + missed-event safety net

**Files:**
- Modify: `src/app/api/webhooks/square/route.ts`
- Test: `tests/int/square-autocreate-webhook.int.spec.ts`

We expose two testable helpers (mirroring the existing exported `handleCatalogVersionUpdated`) and call them from the POST handler. This keeps the signature-verified POST itself thin while the logic is unit-tested with a real Payload + fake gateway.

- [ ] **Step 1: Write the failing test** (`tests/int/square-autocreate-webhook.int.spec.ts`)

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { getTestPayload } from './helpers'
import { handleSubscriptionCreated, ensureMemberForSubscriptionId } from '../../src/app/api/webhooks/square/route'

const sub = vi.hoisted(() => ({ create: vi.fn(), cancel: vi.fn(), pause: vi.fn() }))
vi.mock('../../src/lib/square', async (orig) => {
  const actual = await (orig() as Promise<any>)
  return { ...actual, getSquareClient: () => ({ subscriptions: sub }) }
})

function makeGateway(over: Partial<any> = {}) {
  return {
    getCustomer: vi.fn(async (id: string) => ({ id, email: `${id}@wh.local`, givenName: 'Web', familyName: 'Hook' })),
    listPlanVariations: vi.fn(async () => [] as any[]),
    getSubscription: vi.fn(async (id: string) => ({ id, customerId: 'cus_wh', planVariationId: 'PV_WH', status: 'ACTIVE' })),
    ...over,
  } as any
}
async function makeSquarePlan(payload: any, variationId: string) {
  return payload.create({ collection: 'membership-plans', overrideAccess: true, context: { fromPlanSync: true },
    data: { name: `Plan ${variationId}`, kind: 'square', squarePlanVariationId: variationId, active: true } })
}

describe('square webhook auto-create', () => {
  afterEach(async () => {
    const payload = await getTestPayload()
    await payload.delete({ collection: 'people', where: { email: { like: '@wh.local' } } })
    await payload.delete({ collection: 'membership-plans', where: { name: { like: 'Plan ' } } })
  })

  it('subscription.created creates a member from the event subscription object', async () => {
    const payload = await getTestPayload()
    await makeSquarePlan(payload, 'PV_WH')
    const gateway = makeGateway()
    // Square delivers snake_case JSON.
    const subscription = { id: 'sub_created', customer_id: 'cus_wh', plan_variation_id: 'PV_WH', status: 'ACTIVE', start_date: '2026-03-03' }
    const person = await handleSubscriptionCreated({ payload, gateway }, subscription)
    expect(person).toBeTruthy()
    expect(person!.squareSubscriptionId).toBe('sub_created')
    expect(person!.plan).toBeTruthy()
  })

  it('safety net: resolves an unknown subscription id via gateway.getSubscription and creates the member', async () => {
    const payload = await getTestPayload()
    await makeSquarePlan(payload, 'PV_WH')
    const gateway = makeGateway()
    const person = await ensureMemberForSubscriptionId({ payload, gateway }, 'sub_invoice')
    expect(gateway.getSubscription).toHaveBeenCalledWith('sub_invoice')
    expect(person).toBeTruthy()
    expect(person!.squareSubscriptionId).toBe('sub_invoice')
  })

  it('ensureMemberForSubscriptionId returns null when the id resolves to nothing', async () => {
    const payload = await getTestPayload()
    const gateway = makeGateway({ getSubscription: vi.fn(async () => null) })
    expect(await ensureMemberForSubscriptionId({ payload, gateway }, 'gone')).toBeNull()
  })
})
```

- [ ] **Step 2: Run it — confirm FAIL** (helpers not exported).

Run: `pnpm run test:int tests/int/square-autocreate-webhook.int.spec.ts`

- [ ] **Step 3: Add the helpers + wiring** (`src/app/api/webhooks/square/route.ts`)

At the top, add imports:

```ts
import { ensureMemberFromSubscription, type SquareSubscriptionInput } from '../../../../services/square-member-sync'
import type { MembershipGateway } from '../../../../lib/membership-gateway'
```

Add these exported helpers near `handleCatalogVersionUpdated` (top of file):

```ts
type AutoCreateDeps = { payload: Awaited<ReturnType<typeof getPayload>>; gateway: MembershipGateway }

/** Normalize a Square webhook subscription object (snake_case) to the service shape. */
function normalizeSubscription(raw: any): SquareSubscriptionInput | null {
  const id = raw?.id
  if (!id) return null
  return {
    id,
    customerId: raw.customer_id ?? raw.customerId,
    planVariationId: raw.plan_variation_id ?? raw.planVariationId,
    status: raw.status,
    startDate: raw.start_date ?? raw.startDate,
  }
}

/** subscription.created: build a member from the event's subscription object. */
export async function handleSubscriptionCreated(deps: AutoCreateDeps, rawSubscription: any) {
  const sub = normalizeSubscription(rawSubscription)
  if (!sub) return null
  return ensureMemberFromSubscription(deps, sub)
}

/** Safety net: resolve a subscription id via the gateway, then ensure the member. */
export async function ensureMemberForSubscriptionId(deps: AutoCreateDeps, subscriptionId: string | undefined) {
  if (!subscriptionId) return null
  const sub = await deps.gateway.getSubscription(subscriptionId)
  if (!sub) return null
  return ensureMemberFromSubscription(deps, sub)
}
```

In the `POST` handler, after `const payload = await getPayload(...)`, make the gateway available (it's already imported as `squareMembershipGateway`):

```ts
  const deps = { payload, gateway: squareMembershipGateway }
```

Add a `subscription.created` branch (place it before the `subscription.updated` branch). Wrap in try/catch so a failure logs but the handler still returns 200:

```ts
  } else if (event.type === 'subscription.created') {
    try {
      await handleSubscriptionCreated(deps, event.data?.object?.subscription)
    } catch (e) {
      console.error('subscription.created auto-create failed:', e)
    }
```

Add the safety net to the three existing branches: in each, when `findMemberBySubscription(...)` returns null, attempt a just-in-time create, then re-find. Concretely:

- In `subscription.updated`: after `const member = await findMemberBySubscription(sub?.id)`, change the guard so a missing member is created first:
```ts
    let member = await findMemberBySubscription(sub?.id)
    if (!member && sub?.id) {
      try { member = await ensureMemberForSubscriptionId(deps, sub.id) } catch (e) { console.error('subscription.updated auto-create failed:', e) }
    }
```
(keep the rest of the branch unchanged — it already guards on `if (member && sub?.status)`).

- In `invoice.payment_made`: after `const member = await findMemberBySubscription(subscriptionId)`, before the `if (member)` block, add a just-in-time create when a subscription id is present:
```ts
    let member = await findMemberBySubscription(subscriptionId)
    if (!member && subscriptionId) {
      try { member = await ensureMemberForSubscriptionId(deps, subscriptionId) } catch (e) { console.error('invoice.payment_made auto-create failed:', e) }
    }
```
(the existing `if (member) { ... } else { firing path }` is unchanged; note the existing `const member =` must become `let member =`).

- In `invoice.updated`: same pattern — after `const member = await findMemberBySubscription(subscriptionId)` (it's inside the `UNPAID/PAYMENT_PENDING` block), change to `let` and add the just-in-time create when `subscriptionId` is present, before the `if (member && member.status !== 'past_due')` guard.

> Note: the `subscription.created` and safety-net creates use `ensureMemberFromSubscription`, which is idempotent — if the platform itself just created the subscription, the member already exists (matched by sub id or email) and no duplicate/Square call results.

- [ ] **Step 4: Run the targeted test — expect PASS.** `pnpm run test:int tests/int/square-autocreate-webhook.int.spec.ts`

- [ ] **Step 5: Run the existing webhook test + full suite** (no regression to catalog/booking/membership flows):

Run: `pnpm run test:int tests/int/catalog-webhook-sync.int.spec.ts` then `pnpm run test:int`
Expected: all passing.

- [ ] **Step 6: Typecheck + commit**

```bash
pnpm exec tsc --noEmit
git add src/app/api/webhooks/square/route.ts tests/int/square-autocreate-webhook.int.spec.ts
git commit -m "Auto-create members on subscription.created + missed-event safety net"
```

---

## Task 4: Refactor the import script onto the shared service

**Files:**
- Modify: `scripts/import-square-members.ts`

The script's per-subscription mapping logic now lives in `ensureMemberFromSubscription`. Refactor the loop to call it, removing the duplicated plan-mapping, customer-fetch, and member-create code. Keep the Square subscription search, the pagination warning, and the counters.

- [ ] **Step 1: Rewrite the script body** (`scripts/import-square-members.ts`)

Replace the file contents with:

```ts
import { getPayload } from 'payload'
import config from '@payload-config'
import { getSquareClient, SQUARE_LOCATION_ID } from '../src/lib/square'
import { squareMembershipGateway } from '../src/lib/membership-gateway'
import { ensureMemberFromSubscription } from '../src/services/square-member-sync'

async function run() {
  const payload = await getPayload({ config: await config })
  const client = getSquareClient()

  // Find subscriptions at our location.
  // TODO: paginate via search cursor if subscriptions exceed one page
  const search = await client.subscriptions.search({
    query: { filter: { locationIds: [SQUARE_LOCATION_ID()] } },
  })
  const subscriptions = search.subscriptions ?? []
  let created = 0,
    skipped = 0,
    failed = 0

  for (const s of subscriptions) {
    if (!s.id) {
      skipped++
      continue
    }
    try {
      // ensureMemberFromSubscription maps the plan, finds-or-creates the Person,
      // and promotes them — the same path the subscription.created webhook uses.
      // It returns null for subscriptions we skip (no customer/plan, unknown plan,
      // or already linked). We can't tell "already existed" from "newly created"
      // by the return alone, so count non-null as processed and null as skipped.
      const person = await ensureMemberFromSubscription(
        { payload, gateway: squareMembershipGateway },
        { id: s.id, customerId: s.customerId, planVariationId: s.planVariationId, status: s.status, startDate: s.startDate },
      )
      if (person) created++
      else skipped++
    } catch (e) {
      failed++
      console.error(`Failed to import subscription ${s.id}:`, e instanceof Error ? e.message : e)
    }
  }

  // The search only returned the first page; warn if more exist so an operator
  // isn't misled by "Import complete" on a large account.
  if (search.cursor) {
    console.warn('WARNING: more subscriptions exist beyond the first page — pagination is not implemented, so some members were NOT imported.')
  }

  console.log(`Import complete. Processed ${created}, skipped ${skipped}, failed ${failed}.`)
  process.exit(failed > 0 ? 1 : 0)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: PASS. (The duplicated mapping/`statusMap` logic is gone; the service owns it. There's no dedicated unit test for the script — its logic is covered by the `ensureMemberFromSubscription` tests in Task 2; the script is now a thin Square-search + loop.)

- [ ] **Step 3: Run the full suite** (nothing should depend on the old script internals): `pnpm run test:int` — expect all passing.

- [ ] **Step 4: Commit**

```bash
git add scripts/import-square-members.ts
git commit -m "Refactor member import onto the shared ensureMemberFromSubscription service"
```

---

## Self-Review Notes (for the implementer)

- **Spec coverage:** §1 gateway reads → Task 1; §2 service → Task 2; §3 webhook branch + safety net → Task 3; §4 import refactor → Task 4. Status map shared via `SQUARE_SUBSCRIPTION_STATUS_MAP` (Task 2), available for the webhook's existing `subscription.updated` inline map to adopt later (not required by this plan).
- **No new Square subscription on auto-create:** guaranteed by the `fromSquareWebhook` context on the promote write (the reconcile hook skips webhook-sourced changes) AND asserted directly in Task 2's first test (`sub.create` not called).
- **Idempotency / no double-create:** `ensureMemberFromSubscription` returns early on a known `squareSubscriptionId` and otherwise dedupes by email via `upsertPersonByEmail` — covered by Task 2's idempotent + promote-in-place tests.
- **Webhook stays 200 on failure:** every auto-create call in the POST is wrapped in try/catch that logs (Task 3, Step 3). The exported helpers themselves let errors propagate so the tests can assert behavior; the POST is the layer that swallows.
- **Test DB uses `push`:** all tests rely on Payload auto-syncing the schema to `portside_test`; no migration is involved in Phase 2 (no schema changes — `person` membership fields already exist from Phase 1).
- **Run order:** Task 1 → 2 → 3 → 4 (Task 2 depends on Task 1's gateway reads only for the webhook layer; the service itself uses `getCustomer`. Task 3 depends on Task 2; Task 4 depends on Task 2).
```

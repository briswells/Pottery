# Invoice-Based Membership Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mirror members billed by Square recurring invoices into the site read-only — auto-create People with `active`/`past_due`/`cancelled` status derived from their membership invoices — with zero emails and zero writes to Square.

**Architecture:** A gateway method fetches invoices (read-only search), a pure `deriveInvoiceMemberStatus` encodes the status rules, and `reconcileInvoiceMembers` upserts People (mirroring `reconcileSquareMembers`'s boot+timer pattern). The Square webhook gains a membership-invoice branch for live updates. The existing subscription past-due STAFF email is removed (overdue is platform-only everywhere). Spec: `docs/superpowers/specs/2026-07-10-invoice-membership-sync-design.md`.

**Tech Stack:** Payload 3.85 local API, Square SDK v44 (`square` npm pkg — invoices search), Vitest integration tests with a fake gateway.

## Global Constraints

- **READ-ONLY against Square**: the only new Square call is invoice search/list (GETs or POST `/v2/invoices/search` — non-mutating). Nothing in this feature may create/update anything in Square. Production credentials do NOT go on any droplet in this feature (deploys with the Phase 2 flip, on explicit user go).
- **No emails anywhere in this feature** — no member emails, no staff emails. The subscription-flow past-due staff email is removed as part of Task 1. Overdue = the `past_due` status in admin, nothing else.
- Status rules (exact): any `SCHEDULED` membership invoice → series alive. `UNPAID` invoice ≥ grace days past due (env `MEMBERSHIP_GRACE_DAYS`, default 3, reuse `isInvoicePastDue`) **while the series is alive** → `past_due`. No `SCHEDULED` invoices → `cancelled` (regardless of unpaid leftovers). Membership invoice = `title` matches `/membership/i`.
- People writes: `context: { fromSquareWebhook: true }` + `overrideAccess: true`, idempotent (only write on change). Skip People whose `squareSubscriptionId` is set (subscription machinery wins). Never overwrite an existing DIFFERENT plan; only set the invoiced plan when the person has no plan or already has it. `joinedDate` set only when empty (earliest membership invoice `created_at`).
- No schema changes → NO migration task and no test-DB recreate needed (push schema is already current; tests run against the existing `portside_test`).
- Tests: `tests/int/*.int.spec.ts` via `pnpm test:int <path>`, `getTestPayload()` from `./helpers`. `npx tsc --noEmit` must exit 0 per task.

---

### Task 1: Remove the subscription past-due staff email

**Files:**
- Modify: `src/app/api/webhooks/square/route.ts` (the `invoice.updated` past-due branch)
- Test: none new (grep confirms nothing asserts this email; webhook suites must stay green)

**Interfaces:**
- Produces: `invoice.updated` past-due handling that ONLY flips the member to `past_due` (`lastPaymentStatus: 'FAILED'`) — no `sendEmail`, no `getNotifyEmail` in that branch.

- [ ] **Step 1: Edit.** In the `invoice.updated` branch, the block currently reads:
```ts
        // Notify staff only — Square already emails the member about overdue
        // invoices, so a second member-facing email would be duplicative.
        // No automatic lockout (per design decision).
        const notifyTo = await getNotifyEmail(payload)
        if (notifyTo) {
          await sendEmail({ to: notifyTo, subject: `Membership payment failed: ${member.name}`,
            html: `<p>${member.name} (${member.email}) has a failed/overdue membership payment. Square will retry; follow up as needed.</p>` })
        }
```
Delete it entirely and replace with:
```ts
        // Overdue is surfaced in-platform only (the past_due status below) — no
        // emails: Square already handles member dunning, and staff see it in admin.
```
Then check whether `sendEmail` / `getNotifyEmail` are still used elsewhere in this file (`grep -n "sendEmail\|getNotifyEmail" src/app/api/webhooks/square/route.ts`); if a symbol has no remaining uses, remove its import.
- [ ] **Step 2: Verify.** `npx tsc --noEmit -p tsconfig.json` → 0. `grep -rn "Membership payment failed" src tests` → nothing. Run `pnpm test:int tests/int/catalog-webhook-sync.int.spec.ts tests/int/membership-provision.int.spec.ts tests/int/square-member-sync.int.spec.ts` → all green.
- [ ] **Step 3: Commit** `git add -A && git commit -m "feat(membership): overdue is platform-only — remove past-due staff email"`

---

### Task 2: Gateway invoice listing + the invoiced plan

**Files:**
- Modify: `src/lib/membership-gateway.ts` (interface + Square implementation)
- Modify: `src/services/sync-square-plans.ts` (add `ensureInvoicedPlan`)
- Test: `tests/int/invoiced-plan.int.spec.ts`

**Interfaces:**
- Produces on `MembershipGateway`:
  ```ts
  export interface MemberInvoice {
    customerId?: string
    email?: string
    givenName?: string
    familyName?: string
    title?: string
    status?: string      // SCHEDULED | UNPAID | PAID | CANCELED | REFUNDED | ...
    dueDate?: string     // payment_requests[0].due_date
    createdAt?: string
  }
  // Read-only. Paginates internally. customerId narrows to one customer (used by the webhook branch).
  listInvoices(args?: { customerId?: string }): Promise<MemberInvoice[]>
  ```
  Implementation uses the installed `square` SDK's invoices search (`client.invoices.search`) filtered by `SQUARE_LOCATION_ID()` (+ `customerIds: [customerId]` when given), following the file's existing style (BigInt handling, optional chaining). CHECK THE INSTALLED SDK TYPES for the exact call/pagination shape (`node_modules/square` — v44 pattern mirrors `client.subscriptions.search` used in `scripts/import-square-members.ts` history / `reconcile-square-members.ts`); map `primary_recipient`→(customerId,email,givenName,familyName), `payment_requests?.[0]?.due_date`→dueDate. Search endpoints are non-mutating — the READ-ONLY constraint holds.
- Produces in `sync-square-plans.ts`:
  ```ts
  export const INVOICED_PLAN_NAME = 'Membership (invoiced)'
  export async function ensureInvoicedPlan(payload: Payload): Promise<number> // returns the plan id
  ```
  Find-or-create by `{ name: INVOICED_PLAN_NAME, kind: 'free' }` with `active: true`, `overrideAccess: true`, `context: { fromPlanSync: true }` — mirror `ensureFreePlan` directly above it (but return the id).

- [ ] **Step 1: Failing test**
```ts
// tests/int/invoiced-plan.int.spec.ts
import { describe, it, expect, afterAll } from 'vitest'
import { getTestPayload } from './helpers'
import { ensureInvoicedPlan, INVOICED_PLAN_NAME } from '../../src/services/sync-square-plans'

describe('ensureInvoicedPlan', () => {
  it('creates the invoiced plan once and returns its id on repeat calls', async () => {
    const p = await getTestPayload()
    const id1 = await ensureInvoicedPlan(p)
    const id2 = await ensureInvoicedPlan(p)
    expect(id1).toBe(id2)
    const plan = await p.findByID({ collection: 'membership-plans', id: id1, overrideAccess: true })
    expect(plan.name).toBe(INVOICED_PLAN_NAME)
    expect(plan.kind).toBe('free')
    expect(plan.active).toBe(true)
  })
})

afterAll(async () => {
  const p = await getTestPayload()
  await p.delete({ collection: 'membership-plans', where: { name: { equals: INVOICED_PLAN_NAME } }, overrideAccess: true })
})
```
- [ ] **Step 2: RED** `pnpm test:int tests/int/invoiced-plan.int.spec.ts` → module has no export `ensureInvoicedPlan`.
- [ ] **Step 3: Implement** both the gateway method and `ensureInvoicedPlan`. The gateway method gets no dedicated test (it's a thin SDK mapping; the service tests use a fake gateway; live behavior is verified at the Phase 2 deploy) — but it MUST typecheck against the real SDK types, no `any` beyond the file's existing conventions.
- [ ] **Step 4: GREEN + tsc 0.**
- [ ] **Step 5: Commit** `feat(membership): gateway invoice listing + invoiced plan record`

---

### Task 3: `reconcileInvoiceMembers` service

**Files:**
- Create: `src/services/reconcile-invoice-members.ts`
- Test: `tests/int/invoice-member-sync.int.spec.ts`

**Interfaces:**
- Consumes: `MembershipGateway.listInvoices`, `ensureInvoicedPlan`, `upsertPersonByEmail({ payload }, { name, email, phone?, squareCustomerId? })` (existing, `src/services/people.ts`), `isInvoicePastDue(dueDate, graceDays, now)` (existing, `src/services/square-member-sync.ts`).
- Produces:
  ```ts
  export function deriveInvoiceMemberStatus(
    invoices: MemberInvoice[],           // this customer's MEMBERSHIP invoices only
    graceDays: number,
    now: Date,
  ): 'active' | 'past_due' | 'cancelled'

  export const MEMBERSHIP_TITLE = /membership/i

  export interface InvoiceReconcileResult {
    processed: number; active: number; pastDue: number; cancelled: number
    skipped: number; failed: number
  }
  export async function reconcileInvoiceMembers(
    deps: { payload: Payload; gateway: MembershipGateway },
  ): Promise<InvoiceReconcileResult>

  // One-customer variant for the webhook branch (Task 4):
  export async function reconcileOneInvoiceMember(
    deps: { payload: Payload; gateway: MembershipGateway },
    customerId: string,
  ): Promise<void>
  ```
  `deriveInvoiceMemberStatus` logic (exact): `hasScheduled = invoices.some(i => i.status === 'SCHEDULED')`; if `!hasScheduled` return `'cancelled'`; if `invoices.some(i => i.status === 'UNPAID' && isInvoicePastDue(i.dueDate, graceDays, now))` return `'past_due'`; else `'active'`.
  `reconcileInvoiceMembers`: fetch all invoices via gateway → filter `MEMBERSHIP_TITLE.test(title ?? '')` → group by `customerId` (invoices missing customerId or email → count `skipped`, `console.warn` once per customer) → `ensureInvoicedPlan` once up front → per customer: skip if an existing person matched by email has `squareSubscriptionId` set (count `skipped`); else upsert person (`name` = `[givenName, familyName].filter(Boolean).join(' ') || 'Imported Member'`), then compute the update payload: `status` (from derive), `squareCustomerId`, `plan` ONLY if person has no plan or already the invoiced plan, `joinedDate` = earliest membership invoice `createdAt` ONLY if empty — and call `payload.update` with `context: { fromSquareWebhook: true }` ONLY when something actually changes. Per-customer try/catch → `failed` + `payload.logger.error`; counters per final status.
  `reconcileOneInvoiceMember`: gateway `listInvoices({ customerId })` → filter by title → if zero membership invoices, do nothing; else same upsert path (extract a shared internal `applyInvoiceMember(deps, planId, customerId, invoices)` so both entry points share one code path).

- [ ] **Step 1: Failing tests**
```ts
// tests/int/invoice-member-sync.int.spec.ts
import { describe, it, expect, vi, afterAll } from 'vitest'
import { getTestPayload } from './helpers'
import {
  deriveInvoiceMemberStatus,
  reconcileInvoiceMembers,
  reconcileOneInvoiceMember,
} from '../../src/services/reconcile-invoice-members'
import { INVOICED_PLAN_NAME } from '../../src/services/sync-square-plans'
import type { MemberInvoice } from '../../src/lib/membership-gateway'

const NOW = new Date('2026-07-10T12:00:00Z')
const EM = (t: string) => `${t}-${Date.now()}-${Math.floor(Math.random() * 1e5)}@invtest.local`
const inv = (over: Partial<MemberInvoice> = {}): MemberInvoice => ({
  customerId: 'CUST1', email: 'x@invtest.local', givenName: 'Inv', familyName: 'Member',
  title: 'Membership', status: 'SCHEDULED', createdAt: '2026-01-01T00:00:00Z', ...over,
})
function fakeGateway(invoices: MemberInvoice[]) {
  return {
    listInvoices: vi.fn(async (args?: { customerId?: string }) =>
      args?.customerId ? invoices.filter((i) => i.customerId === args.customerId) : invoices),
    // unused MembershipGateway members for these tests:
    getCustomer: vi.fn(), listPlanVariations: vi.fn(async () => []), getSubscription: vi.fn(),
  } as any
}

describe('deriveInvoiceMemberStatus', () => {
  it('scheduled only → active', () => {
    expect(deriveInvoiceMemberStatus([inv()], 3, NOW)).toBe('active')
  })
  it('scheduled + unpaid overdue past grace → past_due', () => {
    expect(deriveInvoiceMemberStatus([inv(), inv({ status: 'UNPAID', dueDate: '2026-07-01' })], 3, NOW)).toBe('past_due')
  })
  it('scheduled + unpaid due yesterday (within grace) → active', () => {
    expect(deriveInvoiceMemberStatus([inv(), inv({ status: 'UNPAID', dueDate: '2026-07-09' })], 3, NOW)).toBe('active')
  })
  it('no scheduled → cancelled, even with unpaid leftovers', () => {
    expect(deriveInvoiceMemberStatus([inv({ status: 'PAID' }), inv({ status: 'UNPAID', dueDate: '2026-06-01' })], 3, NOW)).toBe('cancelled')
  })
})

describe('reconcileInvoiceMembers', () => {
  it('creates a member with the invoiced plan, active status, joinedDate from earliest invoice', async () => {
    const p = await getTestPayload()
    const email = EM('create')
    const g = fakeGateway([
      inv({ customerId: 'C-A', email, createdAt: '2026-03-05T00:00:00Z' }),
      inv({ customerId: 'C-A', email, status: 'PAID', createdAt: '2026-02-01T00:00:00Z' }),
    ])
    const r = await reconcileInvoiceMembers({ payload: p, gateway: g })
    expect(r.processed).toBe(1)
    expect(r.active).toBe(1)
    const { docs } = await p.find({ collection: 'people', where: { email: { equals: email } }, depth: 1, overrideAccess: true })
    const person: any = docs[0]
    expect(person.status).toBe('active')
    expect(person.squareCustomerId).toBe('C-A')
    expect(person.plan?.name).toBe(INVOICED_PLAN_NAME)
    expect(person.joinedDate?.slice(0, 10)).toBe('2026-02-01')
  })

  it('flips to past_due and back to active idempotently, and cancels when the series ends', async () => {
    const p = await getTestPayload()
    const email = EM('flip')
    const base = { customerId: 'C-B', email }
    let r = await reconcileInvoiceMembers({ payload: p, gateway: fakeGateway([inv(base)]) })
    expect(r.active).toBe(1)
    r = await reconcileInvoiceMembers({ payload: p, gateway: fakeGateway([inv(base), inv({ ...base, status: 'UNPAID', dueDate: '2026-07-01' })]) })
    expect(r.pastDue).toBe(1)
    // series cancelled → no scheduled left
    r = await reconcileInvoiceMembers({ payload: p, gateway: fakeGateway([inv({ ...base, status: 'PAID' })]) })
    expect(r.cancelled).toBe(1)
    // new series later → active again
    r = await reconcileInvoiceMembers({ payload: p, gateway: fakeGateway([inv(base)]) })
    expect(r.active).toBe(1)
    const { docs } = await p.find({ collection: 'people', where: { email: { equals: email } }, overrideAccess: true })
    expect(docs).toHaveLength(1) // same person throughout, no duplicates
    expect(docs[0].status).toBe('active')
  })

  it('skips subscription members and never overwrites a different plan', async () => {
    const p = await getTestPayload()
    const subEmail = EM('sub')
    await p.create({ collection: 'people', overrideAccess: true, data: {
      name: 'Sub Member', email: subEmail, status: 'active', squareSubscriptionId: 'sub_123',
    } })
    const freePlan = (await p.find({ collection: 'membership-plans', where: { kind: { equals: 'free' }, name: { not_equals: INVOICED_PLAN_NAME } }, overrideAccess: true })).docs[0]
      ?? await p.create({ collection: 'membership-plans', overrideAccess: true, context: { fromPlanSync: true }, data: { name: 'Free', kind: 'free', active: true } })
    const manualEmail = EM('manual')
    await p.create({ collection: 'people', overrideAccess: true, data: {
      name: 'Manual Member', email: manualEmail, status: 'active', plan: freePlan.id,
    } })
    const r = await reconcileInvoiceMembers({ payload: p, gateway: fakeGateway([
      inv({ customerId: 'C-SUB', email: subEmail }),
      inv({ customerId: 'C-MAN', email: manualEmail }),
    ]) })
    expect(r.skipped).toBe(1) // the subscription member
    const sub = (await p.find({ collection: 'people', where: { email: { equals: subEmail } }, overrideAccess: true })).docs[0]
    expect(sub.squareCustomerId ?? null).toBeNull() // untouched
    const man: any = (await p.find({ collection: 'people', where: { email: { equals: manualEmail } }, depth: 1, overrideAccess: true })).docs[0]
    expect(man.plan?.name).toBe('Free') // different plan NOT overwritten
    expect(man.squareCustomerId).toBe('C-MAN') // but customer link + status still synced
  })

  it('ignores non-membership invoices and counts customer-less ones as skipped', async () => {
    const p = await getTestPayload()
    const r = await reconcileInvoiceMembers({ payload: p, gateway: fakeGateway([
      inv({ customerId: 'C-X', email: EM('other'), title: 'Kiln repair' }),
      inv({ customerId: undefined, email: undefined }),
    ]) })
    expect(r.processed).toBe(0)
    expect(r.skipped).toBe(1)
  })

  it('sends no email ever (module has no email import) and one-customer variant works', async () => {
    const p = await getTestPayload()
    const email = EM('one')
    const g = fakeGateway([inv({ customerId: 'C-ONE', email })])
    await reconcileOneInvoiceMember({ payload: p, gateway: g }, 'C-ONE')
    expect(g.listInvoices).toHaveBeenCalledWith({ customerId: 'C-ONE' })
    const { docs } = await p.find({ collection: 'people', where: { email: { equals: email } }, overrideAccess: true })
    expect(docs[0].status).toBe('active')
    // static no-email guarantee:
    const fs = await import('fs')
    const src = fs.readFileSync('src/services/reconcile-invoice-members.ts', 'utf8')
    expect(src).not.toMatch(/sendEmail|getNotifyEmail/)
  })
})

afterAll(async () => {
  const p = await getTestPayload()
  await p.delete({ collection: 'people', where: { email: { contains: '@invtest.local' } }, overrideAccess: true })
})
```
- [ ] **Step 2: RED** (module not found) → **Step 3: implement per Interfaces** → **Step 4: GREEN** `pnpm test:int tests/int/invoice-member-sync.int.spec.ts` (9 tests) + `tsc` 0.
- [ ] **Step 5: Commit** `feat(membership): invoice-based member reconcile (read-only, no emails)`

---

### Task 4: Webhook membership-invoice branch

**Files:**
- Modify: `src/app/api/webhooks/square/route.ts`
- Test: `tests/int/invoice-member-webhook.int.spec.ts`

**Interfaces:**
- Consumes: `reconcileOneInvoiceMember` (Task 3), `MEMBERSHIP_TITLE` (Task 3).
- Produces: exported helper the route calls from BOTH `invoice.payment_made` and `invoice.updated` branches:
  ```ts
  export async function handleMembershipInvoiceEvent(
    deps: { payload: Payload; gateway: MembershipGateway },
    rawInvoice: any,   // webhook snake_case invoice object
  ): Promise<void>
  ```
  Behavior: if `rawInvoice?.subscription_id ?? rawInvoice?.subscriptionId` is present → return (subscription path owns it, existing behavior untouched). If `MEMBERSHIP_TITLE.test(rawInvoice?.title ?? '')` is false → return. Resolve `customerId = rawInvoice?.primary_recipient?.customer_id ?? rawInvoice?.primaryRecipient?.customerId`; if missing → return. Call `reconcileOneInvoiceMember(deps, customerId)` inside try/catch (`console.error` on failure — a webhook must still 200).
  Route wiring: in `invoice.payment_made` and `invoice.updated`, call `await handleMembershipInvoiceEvent(deps, invoice)` FIRST when the invoice has no subscription id, and keep every existing subscription-keyed line byte-identical (the past-due branch from Task 1 included).

- [ ] **Step 1: Failing tests** — test the exported helper directly (route-internal wiring is exercised by existing webhook suites staying green):
```ts
// tests/int/invoice-member-webhook.int.spec.ts
import { describe, it, expect, vi, afterAll } from 'vitest'
import { getTestPayload } from './helpers'
import { handleMembershipInvoiceEvent } from '../../src/app/api/webhooks/square/route'

const EM = () => `wh-${Date.now()}-${Math.floor(Math.random() * 1e5)}@invwhtest.local`
function fakeGateway(invoices: any[]) {
  return {
    listInvoices: vi.fn(async (args?: { customerId?: string }) =>
      invoices.filter((i) => !args?.customerId || i.customerId === args.customerId)),
    getCustomer: vi.fn(), listPlanVariations: vi.fn(async () => []), getSubscription: vi.fn(),
  } as any
}

describe('handleMembershipInvoiceEvent', () => {
  it('updates the person for a membership invoice without subscription_id', async () => {
    const p = await getTestPayload()
    const email = EM()
    const g = fakeGateway([{ customerId: 'C-WH', email, title: 'Membership', status: 'SCHEDULED', createdAt: '2026-01-01T00:00:00Z' }])
    await handleMembershipInvoiceEvent({ payload: p, gateway: g }, {
      title: 'Membership', primary_recipient: { customer_id: 'C-WH' },
    })
    const { docs } = await p.find({ collection: 'people', where: { email: { equals: email } }, overrideAccess: true })
    expect(docs[0]?.status).toBe('active')
  })

  it('ignores subscription-backed and non-membership invoices', async () => {
    const p = await getTestPayload()
    const g = fakeGateway([])
    await handleMembershipInvoiceEvent({ payload: p, gateway: g }, {
      title: 'Membership', subscription_id: 'sub_1', primary_recipient: { customer_id: 'C-1' },
    })
    await handleMembershipInvoiceEvent({ payload: p, gateway: g }, {
      title: 'Kiln repair', primary_recipient: { customer_id: 'C-2' },
    })
    expect(g.listInvoices).not.toHaveBeenCalled()
  })
})

afterAll(async () => {
  const p = await getTestPayload()
  await p.delete({ collection: 'people', where: { email: { contains: '@invwhtest.local' } }, overrideAccess: true })
})
```
- [ ] **Step 2: RED → implement → GREEN** + rerun `tests/int/catalog-webhook-sync.int.spec.ts` + `square-member-sync` suites (must stay green) + tsc 0.
- [ ] **Step 3: Commit** `feat(membership): live invoice-member updates via Square webhook`

---

### Task 5: Boot/timer wiring + full verification

**Files:**
- Modify: `src/payload.config.ts` (`onInit`)

**Interfaces:**
- Consumes: `reconcileInvoiceMembers`, `ensureInvoicedPlan`.
- Produces: on boot (inside the existing `SQUARE_ACCESS_TOKEN` guard, after the member reconcile wiring): `await ensureInvoicedPlan(payload)` wrapped in try/catch like `ensureFreePlan`; then a non-blocking `reconcileInvoiceMembers` kickoff + inclusion in the existing periodic timer — mirror the `reconcileMembers` closure exactly:
```ts
    const reconcileInvoiced = () =>
      reconcileInvoiceMembers({ payload, gateway: squareMembershipGateway })
        .then((r) =>
          payload.logger.info(
            `Invoice member reconcile: ${r.processed} processed (${r.active} active, ${r.pastDue} past due, ${r.cancelled} cancelled), ${r.skipped} skipped, ${r.failed} failed.`,
          ),
        )
        .catch((e) => payload.logger.error(`Invoice member reconcile failed: ${e instanceof Error ? e.message : e}`))
    void reconcileInvoiced()
```
and add `void reconcileInvoiced()` inside the existing `setInterval` callback next to `reconcileMembers(true)` (same timer, same env knob).

- [ ] **Step 1: Wire it** (no new test file — onInit is skipped under NODE_ENV=test by design; the service is fully covered by Task 3).
- [ ] **Step 2: Full gate.** `npx tsc --noEmit` → 0; `npx eslint src/payload.config.ts src/app/api/webhooks/square/route.ts src/services/reconcile-invoice-members.ts src/lib/membership-gateway.ts` → no errors; full `pnpm test:int` → all green.
- [ ] **Step 3: Commit** `feat(membership): run invoice member sync at boot and on the member-sync timer`

---

## Deployment

NOT deployed by this plan. The feature ships with the Phase 2 production flip (explicit user authorization required before production Square credentials touch a droplet). It is inert wherever no membership-titled invoices exist (dev/sandbox). At the Phase 2 deploy, verification = boot logs show `Invoice member reconcile: N processed...`, the People list matches the studio's real member roster, and a spot-check of one `past_due` member against Square.

## Self-Review notes
- Spec coverage: staff-email removal (T1), gateway + plan (T2), derive/reconcile/one-customer + all spec test cases incl. no-email guarantee and plan-overwrite rules (T3), webhook branch with subscription-path precedence (T4), boot/timer (T5). Read-only + no-creds-on-droplet are process constraints restated in Global Constraints and Deployment.
- Type consistency: `MemberInvoice`, `listInvoices({ customerId? })`, `reconcileOneInvoiceMember(deps, customerId)` used identically in T2/T3/T4.
- No migration: verified — no collection field changes anywhere in the plan.

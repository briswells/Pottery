# Membership Plans Redesign — Design

**Date:** 2026-06-11
**Scope:** Replace the single hardcoded `SQUARE_MEMBERSHIP_PLAN_VARIATION_ID` env var with a first-class, multi-plan membership model: a synced-from-Square `Plans` collection, a per-member plan assignment that provisions/reconciles a Square subscription, and a platform-only "Free" plan that creates a member with no Square subscription.

## Problem

Membership billing is hardcoded to one Square plan via an env var. It can't represent multiple plans, can't model a free (unbilled) member, and a misconfigured env var silently fails. The owner wants: a plans list in the admin (Square plans visible, read-only), assign a plan when creating a member (auto-subscribe), and a "Free" plan that skips Square.

## Decisions (from brainstorming)

- **Plans collection synced from Square** (not live-fetched, not manual).
- **One plan per member** (many plan *types* supported; each member assigned exactly one).
- **Plan changes reconcile Square** (Free→paid creates, paid→Free cancels, paid→paid swaps).
- **Sync is automatic:** `catalog.version.updated` Square webhook + a sync on app startup (no polling). Verified: `catalog.version.updated` is a real Square webhook (permission `ITEMS_READ`) that fires on any catalog change.
- **Free plan** = a platform-only plan record; assigning it creates a member with no Square subscription.
- **Existing members untouched** — their `plan` starts empty; no automatic Square calls against them.
- This **requires a DB migration** (new collection + new relationship column); production has `push` off.

## Architecture

### 1. `Plans` collection — `src/collections/MembershipPlans.ts` (slug `membership-plans`)

Fields:
- `name` — text, required.
- `kind` — select, required: `square` | `free`.
- `squarePlanVariationId` — text, indexed, **readOnly** (set by sync; empty for free).
- `priceCents` — number, **readOnly** (synced; uses the existing dollar `PriceCell` for display).
- `cadence` — text, **readOnly** (e.g. `MONTHLY`, synced).
- `active` — checkbox, default true. Sync sets false for `square` plans whose variation no longer exists in Square; only `active` plans are offered for assignment.

Admin: group `Studio`, `useAsTitle: 'name'`, `defaultColumns: ['name','kind','priceCents','cadence','active']`. Access: read/create/update `isAdminOrEditor`, delete `isAdmin`. The `square`-kind records are effectively view-only (their identifying fields are readOnly and overwritten by sync); staff create/edit only `free` plans. This list is the owner's "view of Square's plans."

### 2. Member gains a `plan` relationship — `src/collections/Members.ts`

- `plan` — `relationship` to `membership-plans`, `hasMany: false`.
- **Required on create only** via a field `validate`: when `operation === 'create'` and no value → "Choose a plan (use the Free plan for unbilled members)." Existing members (null plan) can still be edited without being forced to set one.
- Remove all reliance on `SQUARE_MEMBERSHIP_PLAN_VARIATION_ID`.

### 3. Gateway — `src/lib/membership-gateway.ts`

- `createSubscription({ customerId, planVariationId, cardId? })` — take the variation id as an argument (no env read). Cardless unless `cardId` given (unchanged behavior).
- Add `cancelSubscription(subscriptionId: string): Promise<void>` (wraps `client.subscriptions.cancel`).
- Add `listPlanVariations(): Promise<Array<{ variationId, planName, variationName, priceCents?, cadence? }>>` — reads the Square catalog (`SUBSCRIPTION_PLAN` + `SUBSCRIPTION_PLAN_VARIATION`) and returns the flattened variations. (The existing `scripts/list-membership-plans.ts` logic moves here so it's reusable + testable.)

### 4. Sync service — `src/services/sync-square-plans.ts`

`syncSquarePlans({ payload, gateway })`:
1. `gateway.listPlanVariations()`.
2. For each variation: upsert a `membership-plans` record matched by `squarePlanVariationId` (`kind: 'square'`, set name/priceCents/cadence, `active: true`). Use `context: { fromPlanSync: true }` and `overrideAccess`.
3. Set `active: false` on any `square` record whose variation id was not returned (removed/deactivated in Square). Never touches `free` records.
- Idempotent; safe to run repeatedly. Errors are caught + logged (never throw to a caller that can't handle it).

### 5. Triggers

- **Webhook:** add a `catalog.version.updated` branch to `src/app/api/webhooks/square/route.ts` → `syncSquarePlans(...)`. Full re-sync (plan count is tiny; no incremental needed).
- **Startup:** in `src/payload.config.ts` `onInit`, call `syncSquarePlans` — guarded to **skip when `process.env.NODE_ENV === 'test'`** (so the integration suite never hits Square) and when `SQUARE_ACCESS_TOKEN` is absent; wrapped so it never blocks/breaks boot.

### 6. Provisioning + reconciliation — `src/services/membership.ts` + hook

Replace the create-only `provisionSquareSubscription` hook with a reconcile hook `reconcileMemberSubscription` (afterChange) backed by a service `reconcileMemberPlan(deps, { member, previousDoc })`:

Guards (hook): skip `operation !== 'create' && plan unchanged`; skip `req.context.fromMemberHook` and `req.context.fromSquareWebhook`.

Service logic (deadlock-safe — every `payload.update` threads `req` and sets `context: { fromMemberHook: true }`):
- Resolve `plan = member.plan ? findByID('membership-plans', member.plan)` else null.
- **No plan:** no Square action (leave as-is).
- **Free plan:** if `member.squareSubscriptionId` exists → `gateway.cancelSubscription(it)`; then write `{ squareSubscriptionId: null, subscriptionStatus: 'FREE' }`.
- **Square plan (`plan.squarePlanVariationId`):**
  - missing/blank variation id → write `subscriptionStatus: 'NOT_CONFIGURED'`, log.
  - member has a subscription already AND plan changed → `cancelSubscription(old)`, then create a new one (swap).
  - member has no subscription → reuse `member.squareCustomerId` or `createCustomer(...)`, then `createSubscription({ customerId, planVariationId })`; write ids + status.
  - member has a subscription and plan unchanged → no-op.

Keep the existing `cancelSquareSubscription` (status→cancelled/paused) and `cancelSquareSubscriptionOnDelete` hooks as-is.

### 7. Cleanup / migration

- Remove `SQUARE_MEMBERSHIP_PLAN_VARIATION_ID` from `.env.example`; remove its remaining reads (gateway/service). The placeholder-guard logic is superseded by the per-plan checks.
- Delete `scripts/list-membership-plans.ts` — its catalog-reading logic moves into `gateway.listPlanVariations()`, and the admin Plans list (kept synced) replaces the script's purpose.
- Generate a Payload migration (`pnpm payload migrate:create membership_plans`) for the new collection + `members.plan` column; commit it. Dev uses `push`; prod runs the migration on deploy.

## Data flow (create an active member on a Square plan)

1. Staff create a member, pick a Square plan → save transaction, afterChange runs in it.
2. `reconcileMemberSubscription` → `reconcileMemberPlan`: resolve plan → create customer + cardless subscription on `plan.squarePlanVariationId` → write Square ids back **in the same transaction (`req`)**.
3. Square emails the member the invoice (auto-pay opt-in); existing `invoice.payment_made` webhook records payment + marks active.

Free plan: step 2 writes `subscriptionStatus: FREE`, no Square call. Plan change later: step 2 reconciles (swap/cancel/create).

## Edge cases

- **Reused customer:** swapping plans reuses `squareCustomerId` (don't recreate the Square customer).
- **Square cancel is end-of-period** (Square behavior; not immediate/prorated).
- **Square failure during reconcile:** caught; `subscriptionStatus` set to a failure marker with the reason (as today); `squareSubscriptionId` only written on success; re-saving retries.
- **Plan made inactive in Square:** existing members on it keep their subscription; the plan just stops being offered for new assignment.
- **Tests never hit Square:** startup sync guarded by `NODE_ENV==='test'`; all service tests use a fake gateway / mocked Square module in isolated files.

## Files

| File | Change |
|------|--------|
| `src/collections/MembershipPlans.ts` | **New** — Plans collection |
| `src/collections/Members.ts` | Add `plan` relationship (required-on-create); swap provision hook for reconcile hook |
| `src/lib/membership-gateway.ts` | `createSubscription` takes `planVariationId`; add `cancelSubscription`, `listPlanVariations` |
| `src/services/sync-square-plans.ts` | **New** — `syncSquarePlans` |
| `src/services/membership.ts` | Add `reconcileMemberPlan`; remove env-var/placeholder logic |
| `src/hooks/reconcileMemberSubscription.ts` | **New** — afterChange reconcile hook (replaces `provisionSquareSubscription.ts`) |
| `src/app/api/webhooks/square/route.ts` | Handle `catalog.version.updated` → sync |
| `src/payload.config.ts` | Register collection; `onInit` startup sync (test-guarded) |
| `scripts/list-membership-plans.ts` | Remove (logic moved to gateway) |
| `.env.example` | Remove `SQUARE_MEMBERSHIP_PLAN_VARIATION_ID` |
| `src/migrations/*` | **New** — generated migration for the collection + `members.plan` |
| `tests/int/*` | Sync service, reconcile matrix, gateway, hook-guard, webhook tests |

## Testing

- **`syncSquarePlans`** (fake gateway): upserts a record per variation, marks missing `square` plans inactive, never touches `free`.
- **`reconcileMemberPlan`** (fake gateway + mock payload) — the matrix: free-on-create (no Square, FREE), square-on-create (createCustomer+createSubscription with the plan's variation id, `req` threaded), free→square (create), square→free (cancel + FREE), square→square (cancel old + create new, reuse customer), unchanged (no-op), Square error (failure marker, no sub id).
- **Gateway** (hoisted Square mock, own file): `createSubscription` sends the given `planVariationId`; `cancelSubscription` calls `subscriptions.cancel`; `listPlanVariations` flattens catalog results.
- **Hook guards** (mocked service): reconcile fires on create and on plan-change; skips unchanged/`fromMemberHook`/`fromSquareWebhook`.
- **Webhook** (mocked sync): `catalog.version.updated` triggers `syncSquarePlans`.
- **Manual sandbox:** create a Square plan → confirm it syncs into the admin Plans list (read-only); create a member on it → subscription + invoice email; create a member on Free → no Square; change a member's plan → subscription swaps; member login still disabled.

# Square Member Auto-Create — Design (Phase 2)

**Date:** 2026-06-12
**Scope:** When a membership subscription is created directly in Square (dashboard or Square-hosted flow), auto-create the corresponding member here — as a Person who is made a member (plan + subscription linkage). Make this the shared path that the one-time import script also uses, and add a safety net so any relevant Square event for an unknown subscription creates the missing member. Builds on Phase 1 (the `people` collection + `upsertPersonByEmail`).

## Problem

Today the Square webhook (`src/app/api/webhooks/square/route.ts`) only **updates members that already exist** (found by `squareSubscriptionId`). There is no `subscription.created` handler, so a subscription created directly in Square never produces a member here — `findMemberBySubscription` returns null and every handler silently no-ops. The only way a Square-originated member lands in the platform is the manual batch script (`scripts/import-square-members.ts`), and that script duplicates the "subscription → member" mapping logic inline.

## Decisions (from brainstorming, mapped onto the Person model)

- **Trigger:** a subscription on one of our known membership plans created in Square. Maps to the `subscription.created` webhook event. A bare Square customer with no subscription is **not** auto-created (not a member; not even a contact until they transact — that's already handled by the booking/firing paths in Phase 1).
- **Auto-create on ANY relevant event (safety net):** if `subscription.updated`, `invoice.payment_made`, or `invoice.updated` arrives for a subscription we don't know, create the member then too (covers a missed/out-of-order `subscription.created`).
- **No staff notification** on auto-create (silent; staff see the member in the list).
- **Reuse the Person:** a Square-originated member is found-or-created by email via `upsertPersonByEmail`, then *promoted* to a member (plan + subscription fields set). If a class-taker/firing-customer already exists for that email, they become a member in place — no duplicate.
- **Unknown plan variation → skip:** only subscriptions whose `planVariationId` maps to a known `membership-plans` record become members (matches the import script). Sync plans on a miss before giving up.
- **Idempotent + no double-create:** keyed on `squareSubscriptionId`; when our own platform-created subscription fires `subscription.created`, the existing person (matched by email) is reused and the subscription id reconciled — no duplicate, no second Square call.

## Architecture

### 1. Gateway additions — `src/lib/membership-gateway.ts`

Add two read methods to `MembershipGateway` so the sync logic is injectable/testable (today the import script reaches for the raw client directly):

```ts
getSubscription(subscriptionId: string): Promise<{
  id: string; customerId?: string; planVariationId?: string; status?: string; startDate?: string
} | null>
getCustomer(customerId: string): Promise<{
  id: string; email?: string; givenName?: string; familyName?: string; phone?: string
} | null>
```

`getSubscription` wraps `client.subscriptions.get`; `getCustomer` wraps `client.customers.get`. Both return `null` on not-found rather than throwing.

### 2. New service — `src/services/square-member-sync.ts`

The single seam for "ensure a member exists for this Square subscription," reused by the webhook and the import script.

```ts
ensureMemberFromSubscription(
  { payload, gateway },
  sub: { id: string; customerId?: string; planVariationId?: string; status?: string; startDate?: string },
): Promise<Person | null>
```

Behavior:
1. If a person already has `squareSubscriptionId === sub.id`, return it (nothing to create — the webhook's existing update logic owns ongoing status changes).
2. Require `sub.customerId` and `sub.planVariationId`; if missing, return `null` (skip, log).
3. Map `planVariationId` → a `membership-plans` record (`kind: 'square'`, by `squarePlanVariationId`). On a miss, run `syncSquarePlans` once and re-look up. Still missing → return `null` (subscription on a plan we don't track; skip, log).
4. Fetch the Square customer via `gateway.getCustomer(sub.customerId)`. Derive `email` (fallback `${customerId}@imported.portsidepottery.com`, matching the import) and `name` (`given + family`, fallback "Imported Member").
5. `upsertPersonByEmail({ payload }, { name, email, phone, squareCustomerId: sub.customerId })` → person (creates a non-member or returns an existing one, enriching the Square customer id).
6. **Promote to member:** update the person with `plan`, `status` (mapped from `sub.status` via the shared status map; default `active`), `squareSubscriptionId: sub.id`, `subscriptionStatus: sub.status`, and `joinedDate: sub.startDate` (only if not already set). Mark the write `context: { fromSquareWebhook: true }` so `reconcileMemberSubscription` does NOT try to create a *new* Square subscription — the subscription already exists.
7. Return the person.

Status map (extracted to a shared const, reused by the webhook + import): `ACTIVE→active, PAUSED→paused, CANCELED→cancelled, DEACTIVATED→cancelled`.

Idempotency/race note: when the platform itself created the subscription (Phase 1 reconcile), the member already exists with this `squareSubscriptionId` (step 1 returns early), or — if the webhook beats our write-back — the person matches by email (step 5 reuses them) and step 6 sets the same subscription id. Either way: one person, no duplicate, no extra Square call.

### 3. Webhook wiring — `src/app/api/webhooks/square/route.ts`

- **New branch `subscription.created`:** read the subscription object from the event (snake_case: `customer_id`, `plan_variation_id`, `status`, `start_date`), normalize to the service's shape, and call `ensureMemberFromSubscription`.
- **Safety net in existing branches:** in `subscription.updated`, `invoice.payment_made`, and `invoice.updated`, when `findMemberBySubscription` returns null but a `subscription_id` is in play, call `ensureMemberFromSubscription` first (fetching the subscription via `gateway.getSubscription` when the event only carries an id, e.g. invoice events), then proceed with the branch's existing update logic against the now-existing member. If the subscription can't be resolved to a known plan, the branch no-ops as today.
- The existing update logic (status reconcile, payment recording, past-due email) is unchanged; it just now runs after a just-in-time create when needed.

### 4. Refactor the import script — `scripts/import-square-members.ts`

Replace the inline customer-fetch + member-create block with a loop that calls `ensureMemberFromSubscription` per subscription, reusing the same plan-mapping and status logic. Keep the existing search/pagination-warning and the created/skipped/failed counters (derive them from the service's return: non-null = created/linked, null = skipped, thrown = failed). This removes the duplicated mapping logic and keeps import + webhook behavior identical.

## Data Flow

**Subscription created in Square:** `subscription.created` webhook → `ensureMemberFromSubscription` → find-or-create Person by the Square customer's email → set plan + subscription fields (marked `fromSquareWebhook`) → member appears in the admin (and in the Members filtered view).

**Missed-event safety net:** an `invoice.payment_made` for an unknown subscription → fetch the subscription → `ensureMemberFromSubscription` creates the member → the existing payment-recording logic then marks them active + records the payment.

**Import (one-time / re-runnable):** the script searches Square subscriptions and runs each through the same service — identical result to the webhook path.

## Error Handling

- `ensureMemberFromSubscription` returns `null` for skips (no customer/plan/unknown plan) and lets unexpected errors propagate to the caller. The **webhook** wraps the call so a failure logs and still returns `200` (Square retries are fine, but a 500 storm isn't) — a missed create is backfilled by the next event or the import. The **import script** counts a thrown error as `failed` and continues (as today).
- The promote-to-member write is marked `fromSquareWebhook` so it never re-enters the reconcile→Square path; verified by reusing Phase 1's "planless/ webhook-sourced writes don't call Square" guarantee (extended with a test asserting an auto-create makes no `subscriptions.create` call).
- Unknown-plan subscriptions are logged (not silently dropped) so an operator can tell a real skip from a bug.

## Testing

Integration (vitest, mocked gateway — never hits Square):
- `ensureMemberFromSubscription`: creates a member from a subscription on a known plan (plan + squareSubscriptionId + status set, person reused by email); returns null for unknown plan, missing customer, or missing planVariation; is idempotent (second call with the same sub id creates no duplicate and makes no extra Square call); syncs plans on a miss then succeeds.
- Promotes an EXISTING non-member person (a prior class-taker by the same email) into a member in place — no duplicate person, snapshot fields preserved.
- Webhook `subscription.created`: an unknown subscription on a known plan creates the member; the handler returns 200.
- Webhook safety net: an `invoice.payment_made` for an unknown subscription creates the member (via `getSubscription`) and then records the payment / marks active.
- Auto-create makes **no** `subscriptions.create` call (the subscription already exists in Square).
- Import script: a thin test (or refactor of the existing one) confirming it routes through the shared service.

## Out of scope

- Creating a member from a bare Square **customer** with no subscription (not a member; contacts are created by the Phase 1 booking/firing paths).
- A member self-service portal.
- Handling Square products that aren't membership subscriptions.
- Reconciling a pre-existing person who already has a *different* live subscription id (rare; logged and left to staff).

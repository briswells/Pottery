# Members: No-Login Auth + Auto Square Subscription on Admin Create — Design

**Date:** 2026-06-07
**Scope:** The `members` collection and the membership Square integration. Two coordinated changes: (1) make Members a no-login auth collection (no password required, login hidden), and (2) when staff create a member in the admin, automatically provision a Square customer + cardless (invoice-billed) subscription so the member is emailed a Square invoice with an auto-pay opt-in.

## Problem

- Creating a member in the Payload admin currently forces a password (Members is `auth: true`), even though members can't log in yet.
- Creating a member in the admin does nothing in Square — staff must set up the customer/subscription in Square by hand. The owner wants admin-created members to be provisioned in Square automatically, with no payment info entered in the admin.

## Goals

- No password required to create a member; password/login UI hidden; members cannot log in (foundation for a future portal preserved).
- Creating an **active** member in the admin creates a Square customer + subscription (cardless), so Square emails the member a payment link each billing period; the invoice's native auto-pay opt-in lets the member store a card on Square's side.
- No payment information is ever entered or stored in the admin.
- No production database migration.

## Non-goals

- No public self-serve signup route (the existing `createMembership` service path is unchanged and still card-based).
- No member portal / login.
- No separate welcome email for admin-created members (Square's invoice email is the touchpoint).
- No comp-member checkbox beyond the status escape hatch (create with a non-active status → not billed).
- No change to the import script's syncing role or the Square webhook.

## Verified facts (Square)

- Square Subscriptions: *"At the start of each billing period, customers with a `card_id` on file… are charged… All other customers receive an emailed invoice with a payment link."* (Subscriptions API — Subscription Billing and Invoices.) So a subscription created **without** `card_id` is invoice-billed and emailed; the invoice exposes the save-card/auto-pay opt-in. This is the mechanism the owner wants replicated.

## Part 1 — Auth: no login, no password

### `src/collections/Members.ts`

Change `auth: true` to:

```ts
auth: {
  disableLocalStrategy: { enableFields: true, optionalPassword: true },
}
```

- `disableLocalStrategy` → no email/password login (members can't log in; the password/login UI is removed from the admin).
- `enableFields: true` → keeps the auth fields (notably `email`) on the collection and in the DB/types, so **the database does not vary** vs. `auth: true` → no migration. Email still works for Square linkage, the import script, and webhooks.
- `optionalPassword: true` → password is not required to create a member.

Everything else in Members (fields, the existing `afterChange: [cancelSquareSubscription]` hook, access) stays; we add a second hook in Part 2.

### Remove now-unneeded password code

- `src/services/membership.ts`: remove the `password: input.password ?? randomPassword()` line from the `payload.create` data, remove the `randomPassword()` helper, and remove `password?: string` from `MembershipInput`.
- `scripts/import-square-members.ts`: remove the `password: randomBytes(24).toString('hex')` line (and the `randomBytes` import if it becomes unused).

(Members created without a password are valid because the local strategy is disabled and `optionalPassword` is set.)

## Part 2 — Auto-provision Square subscription on admin create

### Gateway — `src/lib/membership-gateway.ts`

Make `cardId` optional so a cardless (invoice-billed) subscription can be created:

```ts
createSubscription(input: { customerId: string; cardId?: string }): Promise<{ subscriptionId: string; status: string }>
```

Implementation: only include `cardId` in the `client.subscriptions.create({...})` call when it is provided (omit the key entirely when undefined — a cardless subscription bills by emailed invoice). The existing card-based signup path passes `cardId` and is unaffected.

### Service — `src/services/membership.ts`

Add a new function for the admin path (the member row already exists; this attaches Square to it):

```ts
export interface ProvisionDeps { payload: Payload; gateway: MembershipGateway; req?: PayloadRequest }

export async function provisionMemberSubscription(
  deps: ProvisionDeps,
  member: { id: string | number; name: string; email: string; phone?: string | null },
): Promise<void>
```

Behavior:
1. `createCustomer({ name, email, phone })` → `customerId`.
2. `createSubscription({ customerId })` (no `cardId`) → `{ subscriptionId, status }`.
3. `payload.update({ collection: 'members', id: member.id, overrideAccess: true, req: deps.req, context: { fromMemberHook: true }, data: { squareCustomerId, squareSubscriptionId, subscriptionStatus: status } })`.

**Deadlock-safety (critical):** step 3 MUST pass `deps.req` so the write joins the triggering save's transaction — this is the same afterChange-hook footgun fixed for firing invoices (a separate-transaction self-update deadlocks on the row lock the parent save holds). See `[[payload-hook-transaction-footgun]]`.

On any thrown error: catch it, `console.error`, and `payload.update(... req, context:{fromMemberHook:true}, data:{ subscriptionStatus: 'SETUP_FAILED' })` so the failure is visible in the admin list (reuses the existing `subscriptionStatus` text field — no new column) and `squareSubscriptionId` stays empty so re-saving the member retries.

### Hook — `src/hooks/provisionSquareSubscription.ts` (new)

A `CollectionAfterChangeHook<Member>` added to `Members.hooks.afterChange` (alongside the existing `cancelSquareSubscription`):

```ts
export const provisionSquareSubscription: CollectionAfterChangeHook<Member> = async ({ doc, operation, req }) => {
  if (operation !== 'create') return doc
  if (req?.context?.fromMemberHook) return doc      // our own write-back
  if (req?.context?.fromSquareWebhook) return doc    // webhook-driven changes
  if (doc.squareSubscriptionId) return doc           // signup/import already linked to Square
  if (doc.status !== 'active') return doc            // comp/non-billed members opt out via status
  try {
    await provisionMemberSubscription(
      { payload: req.payload, gateway: squareMembershipGateway, req },
      { id: doc.id, name: doc.name, email: doc.email, phone: doc.phone },
    )
  } catch (e) {
    console.error(`Member subscription provisioning failed for ${doc.id}:`, e)
  }
  return doc
}
```

The `provisionMemberSubscription` service handles its own failure write-back; the hook's try/catch is a backstop so a thrown error never breaks the admin save.

### Why this skips the right members

- **Self-serve signup** (`createMembership`) and **import** set `squareSubscriptionId` on create → the `doc.squareSubscriptionId` guard skips them.
- The service's own write-back is `operation: 'update'` and carries `context.fromMemberHook` → skipped twice over.
- Webhook-driven updates are `operation: 'update'` with `context.fromSquareWebhook` → skipped.
- Only an admin-created, **active**, not-yet-linked member triggers provisioning.

## Data flow (admin create)

1. Staff create a member (Active) in the admin → Payload opens the save transaction, takes the row lock, runs `afterChange` inside it.
2. `provisionSquareSubscription` fires → `provisionMemberSubscription`: Square customer + cardless subscription created (external calls), then a `payload.update` **joining the same transaction (via `req`)** writes the Square IDs.
3. Transaction commits atomically. Square emails the member the first invoice with a payment link + auto-pay opt-in.
4. Member pays on Square's page → existing webhook (`invoice.payment_made`) records a `payment` and confirms `status: active`; `subscription.updated` keeps status synced thereafter.

## Edge cases

- **Square failure mid-provision:** orphaned Square customer possible (same documented caveat as the existing gateways); member row keeps `subscriptionStatus: 'SETUP_FAILED'`, empty `squareSubscriptionId`; re-saving retries. Logged.
- **Non-active create** (paused/cancelled): no provisioning — escape hatch for comp members.
- **Editing an existing member:** never provisions (create-only).
- **Idempotency:** Square calls use per-attempt idempotency keys; the `squareSubscriptionId` guard prevents double-provisioning once linked.

## Files

| File | Change |
|------|--------|
| `src/collections/Members.ts` | `auth` → `disableLocalStrategy`; add `provisionSquareSubscription` to `afterChange` |
| `src/lib/membership-gateway.ts` | `createSubscription` `cardId` optional; omit when absent |
| `src/services/membership.ts` | Add `provisionMemberSubscription` + `ProvisionDeps`; remove password code from `createMembership`/`MembershipInput` |
| `src/hooks/provisionSquareSubscription.ts` | **New** — the create-only provisioning hook |
| `scripts/import-square-members.ts` | Remove password line |
| `src/payload-types.ts` | Regenerated (auth change / types) via `pnpm generate:types` if needed |

## Testing

- **Unit (vitest, `tests/int/`):**
  - `provisionMemberSubscription` with a fake gateway + mock payload: asserts it calls `createSubscription` **without** `cardId`, and that its `payload.update` is called **with `req`** (the deadlock regression) and writes the three Square fields; on gateway throw, writes `subscriptionStatus: 'SETUP_FAILED'`.
  - Gateway `createSubscription`: when `cardId` omitted, the Square call body has no `cardId` (verify via a mocked Square client).
  - `createMembership` still works with no `password` in the created data.
- **Manual admin verification:** create an Active member in the admin → no password prompt; confirm a Square customer + cardless subscription appear in the Square sandbox and the member row gets `squareCustomerId`/`squareSubscriptionId`; confirm the member receives the Square invoice email; confirm creating a Paused member does NOT provision; confirm members can't log in.

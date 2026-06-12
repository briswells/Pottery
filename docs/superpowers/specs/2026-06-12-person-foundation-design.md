# Person Foundation — Design

**Date:** 2026-06-12
**Scope:** Introduce a single per-human **Person** identity by evolving the existing `members` collection into `people`. Everyone who interacts with the studio — class-takers (bookings), custom-firing customers, and members — is a Person. "Being a member" means having a plan + subscription; a plain person has no plan. Bookings and firing-requests gain a link to their Person so staff can see all of someone's activity in one place and convert a class-taker into a member by assigning a plan. This is **Phase 1** of a two-phase effort; **Phase 2** (auto-create members from Square `subscription.created` + backfill on any Square event) is a separate spec built on this foundation.

## Problem

The same human is duplicated across collections with no link between the rows:

| Collection | Customer fields | Square linkage |
|---|---|---|
| `members` (auth) | name, email, phone | squareCustomerId, squareSubscriptionId |
| `bookings` (classes) | customerName, customerEmail, customerPhone | squarePaymentId |
| `firing-requests` | name, email, phone | squareCustomerId, squareInvoiceId |

Someone who takes a class, later requests a custom firing, then becomes a member exists as three unrelated rows with three copies of their name/email. There is no way to see "all of Jane's firings and classes," and converting a class-taker into a member means re-keying their details. Square's own model already matches the desired shape: a Square **Customer** is the person; a **Subscription** is the membership. Today we scatter `squareCustomerId` across `members` and `firing-requests` independently.

## Decisions (from brainstorming)

- **Member = Person with a plan (merge).** Evolve `members` into the one-record-per-human collection. It stays the auth collection (local strategy disabled). Membership is *derived* from having a `plan`; there is no separate member/non-member flag to drift out of sync.
- **Rename the slug** `members` → `people` (table + relationship references + admin labels). Cleanest long-term; requires a careful data-preserving migration.
- **Distinguish members in admin by deriving from `plan`** (has-a-plan), surfaced via a filtered "Members" admin view — not an explicit lifecycle field.
- **Keep the inline snapshot fields** on `bookings`/`firing-requests` (historical record of what was entered) **and** add a nullable `person` link. Non-destructive.
- **Non-members default to `status: none`** (a new membership-status value); status/shelfLabel/subscriptionStatus are only meaningful once a plan exists.
- **Backfill is a re-runnable, idempotent script** (`scripts/backfill-people.ts`), mirroring the existing `import-square-members.ts` pattern — not a data migration.
- Existing membership hooks (`reconcileMemberSubscription`, `cancelSquareSubscription`, `cancelSquareSubscriptionOnDelete`) are already plan/subscription-gated, so a plain person with no plan is inert — no new guards needed beyond verifying this holds.

## Architecture

### 1. Collection rename: `members` → `people` — `src/collections/Members.ts` → `src/collections/People.ts`

- Slug becomes `people`. Admin: `group: 'People'`, `useAsTitle: 'name'`. Labels `{ singular: 'Person', plural: 'People' }`.
- Auth config unchanged (`disableLocalStrategy: { enableFields: true, optionalPassword: true }`) — one human, one row, login-ready later.
- Access unchanged (`isAdminOrEditor` read/create/update, `isAdmin` delete).
- Hooks unchanged (`afterChange: [reconcileMemberSubscription, cancelSquareSubscription]`, `beforeDelete: [cancelSquareSubscriptionOnDelete]`). Verify each no-ops when `plan`/`squareSubscriptionId` is absent (they already do; add a test asserting it).
- Update the export symbol `Members` → `People` and register it in `src/payload.config.ts`.

Field changes:
- **`plan`** — relationship to `membership-plans`, `hasMany: false`, **now optional** on create. The current `validate` that forces a plan on create is **removed** (a person need not be a member). Description updated: "Assign a plan to make this person a member; leave empty for a non-member contact."
- **`status`** — gains value **`none`** and its `defaultValue` becomes `'none'`. Options: `none` (Not a member) | `active` | `past_due` | `paused` | `cancelled`. Label → "Membership status". `status`/`shelfLabel`/`subscriptionStatus`/`lastPayment*` get `admin.condition: (data) => Boolean(data?.plan)` so they only render for people with a plan.
- All other fields (phone, joinedDate, notes, square linkage, cancel-token fields) unchanged.
- `defaultColumns` updated to include `plan` so the list shows member status at a glance: `['name', 'plan', 'status', 'shelfLabel', 'subscriptionStatus']`.

### 2. The migration — data-preserving table + relationship rename

Renaming a Payload slug naively diffs as **drop-and-recreate**, which would destroy person rows and the `payments.member` relationship. So the migration is **hand-authored and reviewed**, not blindly generated:

1. `ALTER TABLE members RENAME TO people;` (and any Payload-managed companion tables, e.g. `members_*` versions/locales tables → `people_*` if present).
2. Update Payload's relationship storage for `payments.member` (relationTo `members` → `people`): in `@payloadcms/db-postgres` a single-relationship is stored either as a column on the owning table or as rows in a `payments_rels` table keyed by collection slug. Inspect the actual schema (`\d payments` / `\d payments_rels`) and rename the FK column or update the `path`/relationship-key rows accordingly so existing membership-payment links survive.
3. Rename any indexes/constraints that embed the old table name only if needed for Payload's expectations (cosmetic otherwise).

**Verification before merge:** run on a copy of prod data; assert `SELECT count(*)` matches pre/post for people, and that every pre-existing `payments.type = 'membership'` row still resolves its `member` → person. Production runs with `push` off, so this migration is required and must be committed.

> Procedure: change the slug in code, run `payload migrate:create` to get a starting point, then **rewrite the up/down to use RENAME** (not drop/create) and add the rel-table fix-ups. Keep a working `down` that reverses the renames.

### 3. `person` link on bookings & firing-requests

- `src/collections/Bookings.ts`: add `{ name: 'person', type: 'relationship', relationTo: 'people', hasMany: false, admin: { description: 'The person who made this booking.' } }`. Keep `customerName/customerEmail/customerPhone` as the historical snapshot.
- `src/collections/FiringRequests.ts`: add the same `person` relationship. Keep `name/email/phone` as the snapshot.
- Both are nullable (older rows + the create path set them; backfill fills historical rows).

### 4. Shared service: `upsertPersonByEmail` — `src/services/people.ts` (new)

The seam every path reuses (creation paths, backfill, and Phase 2 Square sync).

```ts
upsertPersonByEmail(
  { payload, req? },
  { name, email, phone?, squareCustomerId? }
): Promise<Person>
```

Behavior:
- Normalize email to lowercase (Payload auth already lowercases stored emails; we match on the normalized value).
- Find an existing person by email. If found, **enrich without clobbering**: fill `phone`/`squareCustomerId`/`name` only where the existing value is empty. Return it.
- If not found, **create** with `plan: undefined`, `status: 'none'`, the provided fields, and `joinedDate` unset. No special context flag is needed to keep this inert: `reconcileMemberSubscription` calls `reconcileMemberPlan`, which returns early when there's no plan — so a person created without a plan never triggers a Square subscription. A test asserts zero gateway calls to lock this guarantee in.
- Returns the Person doc. Dependency-injected `payload`/`req` so it threads the caller's transaction (per the hook-transaction footgun) and is unit-testable.

### 5. Wire the creation paths

- **`src/services/booking.ts` (`createPaidBooking`):** after the booking is created/paid, call `upsertPersonByEmail` with the customer fields and set `booking.person`. (Bookings have no Square customer, so no `squareCustomerId` passed.)
- **`src/services/firing-invoice.ts` (`createAndSendFiringInvoice`):** the flow already obtains a Square `customerId` from the invoice gateway. Upsert the person with that `squareCustomerId`, and set `firing-request.person`. This means a firing customer's Square customer id lands on their Person — exactly the cross-link that Phase 2 builds on.
- Both set the link via an `overrideAccess` update threaded with the existing `req`/context, consistent with surrounding code.

### 6. Backfill — `scripts/backfill-people.ts` (new)

Idempotent, re-runnable (mirrors `scripts/import-square-members.ts`):
1. Load all `bookings` and `firing-requests` where `person` is null (paginate).
2. For each, `upsertPersonByEmail` from its snapshot fields (firing-requests pass their stored `squareCustomerId`), then set the `person` link.
3. Existing members are **already** people (post-rename) — no action needed for them; a booking/firing whose email matches a member links to that member's person.
4. Log created/linked/skipped counts; exit non-zero on failures (same convention as the import script).

A shared email across a member + booking + firing collapses to one Person — the "see everything" payoff. Re-running is a no-op (rows already linked are filtered out).

### 7. Admin "Members" view

People are members iff they have a `plan`. Surface a members-only view without a second collection:
- The People list shows the `plan` column and is filterable.
- Add a **Members** admin nav link/preset that opens the People list pre-filtered to "has a plan" (`?where[plan][exists]=true`), via Payload admin nav config. Lightweight — no custom React view required.

### 8. `payments.member` field

`payments.member` keeps its name (it specifically marks the member on a *membership* payment) but its `relationTo` changes `members` → `people`. No field rename in Phase 1. Booking/firing payments continue to link via the `booking`/`firingRequest` relationships, which now resolve to a Person through those collections' `person` link.

## Data Flow

**New class booking:** `createPaidBooking` → create booking + payment → `upsertPersonByEmail(customer)` → set `booking.person`. Person created with `status: none` if new; existing person enriched.

**New firing request invoiced:** `createAndSendFiringInvoice` → Square customer + invoice created → `upsertPersonByEmail({ ...request, squareCustomerId })` → set `firing-request.person`.

**Convert a person to a member:** staff open a Person (e.g. a class-taker) and assign a `plan`. The existing `reconcileMemberSubscription` afterChange hook fires on the plan change and provisions the Square subscription — no new code path. `status` moves off `none` as the subscription/webhooks report it.

**Backfill (one-time, re-runnable):** script links every historical booking/firing to a Person, deduping by email.

## Error Handling

- `upsertPersonByEmail` failures in the creation paths must **not** fail the booking/firing (the payment/invoice already succeeded) — swallow + log and leave `person` null, consistent with the existing "don't fail a paid action on a secondary write" pattern (welcome/confirmation emails). The backfill can link it later.
- The migration must be reversible (`down` reverses the renames) and verified on a data copy before merge.
- A person created with no plan is inert because `reconcileMemberPlan` returns early without a plan; assert zero gateway calls in tests so a future hook change can't silently start charging non-members.

## Testing

Integration (vitest, `tests/int/`), following existing patterns:
- `upsertPersonByEmail`: creates a new person with `status: none` and no plan; matches case-insensitively; enriches missing fields without clobbering existing ones; does not trigger the reconcile hook (no Square call).
- `createPaidBooking`: links to a new person, and re-uses an existing person on a repeat email.
- `createAndSendFiringInvoice`: links to a person and carries `squareCustomerId` onto it.
- Backfill script: a shared email across a member + a booking + a firing collapses to a single person with all three linked; a second run is a no-op.
- Rename migration: person row count and every `membership` payment's `member` link survive up-migration (run against seeded data).
- Hook gating: updating a person who has no plan triggers no Square subscription call (mocked gateway asserts zero calls).

## Out of scope (Phase 2 and beyond)

- Auto-creating a member from Square `subscription.created`, and backfilling a missing person/member on any Square event (separate spec).
- A member/customer self-service portal login.
- A unified "activity timeline" UI on the Person record (the relationships make it possible; a dedicated admin view is a later nicety).
- Renaming `payments.member` → `payments.person` or adding a direct `payments.person` link.

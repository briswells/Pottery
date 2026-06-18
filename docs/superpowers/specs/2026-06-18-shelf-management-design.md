# Shelf Management — Design Spec

**Date:** 2026-06-18
**Status:** Approved (design), pending implementation plan

## Goal

Replace the free-text `shelfLabel` on members with a real shelf system: a `shelves`
collection (free-form name + optional reusable location tag) with member assignment.
Staff assign a shelf from the member's page, choosing only from currently-unassigned
shelves. When a membership truly expires in Square, the member's shelf is freed
automatically. Staff get an admin view of currently-unassigned shelves.

## Non-goals (YAGNI)

- No multiple tags per shelf (exactly one optional tag).
- No public-facing shelf availability page.
- No automatic shelf assignment — staff assign manually.
- No freeing of shelves on pause/past-due or on a *scheduled* (still-active) cancel.
- No migration of old data — there is no real `shelfLabel` data to preserve.

## Data model

### New collection: `shelf-tags` (admin group "Studio")
- `name` — text, required, unique. The reusable location label (e.g. "Back room").
- Access: read `isAdminOrEditor`, create/update `isAdminOrEditor`, delete `isAdmin`.

### New collection: `shelves` (admin group "Studio")
- `name` — text, **required**, `useAsTitle`. Free-form shelf identifier (e.g. "B-12", "A1").
  Unique (two shelves shouldn't share an identifier).
- `tag` — relationship → `shelf-tags`, single, **not required**.
- `assignedMember` — relationship → `people`, single, **read-only in admin UI**.
  This is the **source of truth** for occupancy. Maintained by the People sync hook
  (below), not edited directly.
- `defaultColumns`: `name`, `tag`, `assignedMember`.
- Access: same pattern as above.

### Change to `people`
- **Remove** `shelfLabel` (text field).
- **Add** `shelf` — relationship → `shelves`, single. This is the field staff edit.
  - `admin.condition`: only show when the person has a `plan` (consistent with the
    other member-only fields).
  - `filterOptions`: only shelves that are unassigned **or** already assigned to this
    person — `{ or: [ { assignedMember: { exists: false } }, { assignedMember: { equals: <id> } } ] }`.
- `defaultColumns`: replace `shelfLabel` with `shelf`.

## Behavior

### Assignment + sync (single source of truth)
Staff set `people.shelf` on the member's page. A People `afterChange` hook
(`syncShelfAssignment`) reconciles `shelves.assignedMember`:

1. If `shelf` changed to shelf X: set `X.assignedMember = thisPerson`.
2. Clear the member's **previous** shelf's `assignedMember` (if different).
3. Enforce one ↔ one: if X was somehow already assigned to someone else, the new
   assignment wins and the prior holder's `people.shelf` is cleared (the
   `filterOptions` makes this rare, but the hook is the backstop).

The hook **must pass `req`** to all `payload.update` calls (transaction-safety;
this codebase has a documented hook/transaction deadlock footgun). It must guard
against infinite loops: writes to `shelves` don't retrigger People hooks, and the
hook should no-op when `shelf` is unchanged. Use a `context` flag (e.g.
`fromShelfSync`) to mark writes it initiates.

### Auto-unassign on true expiry
A People hook frees the shelf only when the membership **truly ends in Square**,
distinguished from a scheduled cancel:

- Square keeps a subscription `ACTIVE` (with `canceled_date`) until the period ends;
  our `subscriptionStatus` field stores the **raw** Square status.
- True expiry = raw `subscriptionStatus` transitions to `CANCELED` or `DEACTIVATED`.
- Trigger: in a People `afterChange` (or folded into `syncShelfAssignment`), when
  `previousDoc.subscriptionStatus` was not ended and `doc.subscriptionStatus` is now
  `CANCELED`/`DEACTIVATED`, clear `doc.shelf` (and thus the shelf's `assignedMember`).
- Do **not** free on: internal `status === 'cancelled'` alone (fires on scheduled
  cancel), `paused`, or `past_due`.
- Manual unassignment (staff clearing `shelf`) is always available; clearing the
  plan does not auto-free (out of scope).

### Unassigned-shelves display
A filtered list view in the `shelves` admin collection showing shelves where
`assignedMember` is empty, sortable by `name`/`tag`. Implemented via a saved/default
filter (no custom React view).

## Cleanup
- `src/hooks/cancelSquareSubscription.ts:11` — replace `member.shelfLabel` with the
  assigned shelf's `name` (fetch via `req.payload.findByID` on `doc.shelf`, or read a
  populated value); fall back to "none on file".
- `src/collections/People.ts` — remove the `shelfLabel` field and swap the
  `defaultColumns` entry to `shelf`.
- Regenerate `payload-types.ts`.

## Migration
Production runs with `push` off, so a Drizzle migration is required (generate via the
throwaway dev-DB workflow, hand-edit if needed):
- Create `shelf_tags` table.
- Create `shelves` table (+ `shelves_rels` for the `tag` and `assignedMember`
  relationships, per Payload's relationship storage).
- Add `people.shelf` relationship (Payload stores hasMany:false relationships either
  as a `*_id` column or via `_rels`; match what `migrate:create` generates).
- Drop `people.shelf_label`.
- No data backfill.

## Edge cases
- **Delete a shelf that's assigned:** a `beforeDelete` hook clears the assigned
  member's `people.shelf` first (no dangling ref). Alternatively block deletion of an
  assigned shelf — decide in the plan; default to clear-then-delete.
- **Delete a tag in use:** shelves referencing it get `tag` set to null
  (relationship `onDelete: set null`).
- **Member with no shelf:** normal; `shelf` empty.
- **Two staff assigning the same shelf concurrently:** `filterOptions` plus the sync
  hook's one↔one enforcement resolve it (last write wins, prior holder cleared).

## Files
**New:** `src/collections/ShelfTags.ts`, `src/collections/Shelves.ts`,
`src/hooks/syncShelfAssignment.ts`, a migration under `src/migrations/`.
**Changed:** `src/collections/People.ts`, `src/hooks/cancelSquareSubscription.ts`,
`src/payload.config.ts` (register the two collections), `src/payload-types.ts` (generated).

## Testing
- Assign a shelf to a member → shelf's `assignedMember` set; shelf disappears from
  other members' dropdowns and from the unassigned list.
- Reassign / clear → previous shelf frees and reappears as unassigned.
- Simulate Square true expiry (raw `subscriptionStatus` → `DEACTIVATED`) → shelf frees.
- Simulate scheduled cancel (raw `ACTIVE` + `canceled_date`, internal `cancelled`) →
  shelf **retained**.
- Cancellation email shows the assigned shelf name (or "none on file").
- Delete a shelf/tag in use → references cleared, no dangling data.

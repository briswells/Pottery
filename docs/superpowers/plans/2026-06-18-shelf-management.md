# Shelf Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the free-text `shelfLabel` on members with a real shelf system — a `shelves` collection (free-form name + optional reusable tag) assigned from the member page, freed automatically when a membership truly expires in Square.

**Architecture:** Two new Payload collections (`shelf-tags`, `shelves`). The member's `people.shelf` relationship is what staff edit; a People `afterChange` hook (`syncShelfAssignment`) keeps `shelves.assignedMember` (the occupancy source of truth) in sync, enforces one↔one, and frees the shelf when Square reports the subscription truly ended.

**Tech Stack:** Payload 3.85 (Postgres adapter), Next.js 16, Vitest integration tests, Drizzle migrations.

## Global Constraints

- **Hook transaction-safety:** any `payload.update`/`delete` inside a hook MUST pass `req` (this codebase has a documented hook/transaction deadlock footgun). Use `req.payload`.
- **Loop guard:** hook-initiated writes set `context: { fromShelfSync: true }`; the hook returns early when it sees that context.
- **Tests:** integration tests are `tests/int/<name>.int.spec.ts`, boot Payload via `getTestPayload()` from `./helpers`, run with `pnpm test:int <path>`. They run with `NODE_ENV=test`, so `onInit` is skipped (no Square calls) and the Postgres adapter `push` auto-syncs the schema to `portside_test`.
- **Test DB prerequisite:** because this drops `people.shelf_label`, `push` may prompt interactively. Before the first test run with the new schema, recreate the test DB so `push` builds it fresh: connect to the local Postgres server (creds in `.env` `DATABASE_URL_TEST`, host `localhost:5432`) and run `DROP DATABASE IF EXISTS portside_test; CREATE DATABASE portside_test;`.
- **True-expiry signal:** free the shelf only when the *raw* Square status (`people.subscriptionStatus`) becomes `CANCELED` or `DEACTIVATED`. A scheduled cancel stays raw `ACTIVE` with a `canceled_date` and must NOT free the shelf; neither do `PAUSED`/past-due.
- **Production migration** is generated last (Task 8) via the throwaway dev-DB workflow; production runs with `push` off.

---

### Task 1: `shelf-tags` collection

**Files:**
- Create: `src/collections/ShelfTags.ts`
- Modify: `src/payload.config.ts` (import + register in `collections`)
- Test: `tests/int/shelves.int.spec.ts`

**Interfaces:**
- Produces: collection slug `shelf-tags` with field `name` (text, required, unique).

- [ ] **Step 1: Write the failing test**

```ts
// tests/int/shelves.int.spec.ts
import { describe, it, expect, afterAll } from 'vitest'
import { getTestPayload } from './helpers'

describe('shelf-tags', () => {
  it('creates a tag with a unique name', async () => {
    const payload = await getTestPayload()
    const tag = await payload.create({
      collection: 'shelf-tags', overrideAccess: true,
      data: { name: `Back room ${Date.now()}` },
    })
    expect(tag.id).toBeTruthy()
    expect(tag.name).toContain('Back room')
  })
})

afterAll(async () => {
  const payload = await getTestPayload()
  await payload.delete({ collection: 'people', where: { email: { contains: '@shelftest.local' } }, overrideAccess: true })
  await payload.delete({ collection: 'shelves', where: { name: { contains: 'PLAN-SHELF' } }, overrideAccess: true })
  await payload.delete({ collection: 'shelf-tags', where: { name: { contains: 'Back room' } }, overrideAccess: true })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:int tests/int/shelves.int.spec.ts`
Expected: FAIL — collection `shelf-tags` does not exist (validation/SQL error).

- [ ] **Step 3: Create the collection**

```ts
// src/collections/ShelfTags.ts
import type { CollectionConfig } from 'payload'
import { isAdmin } from '../access/isAdmin'
import { isAdminOrEditor } from '../access/isAdminOrEditor'

// Reusable location labels for shelves (e.g. "Back room", "Window wall").
export const ShelfTags: CollectionConfig = {
  slug: 'shelf-tags',
  labels: { singular: 'Shelf tag', plural: 'Shelf tags' },
  admin: { group: 'Studio', useAsTitle: 'name' },
  access: { read: isAdminOrEditor, create: isAdminOrEditor, update: isAdminOrEditor, delete: isAdmin },
  fields: [
    { name: 'name', type: 'text', required: true, unique: true },
  ],
}
```

- [ ] **Step 4: Register it**

In `src/payload.config.ts`, add the import near the other collection imports:
```ts
import { ShelfTags } from './collections/ShelfTags'
```
Add `ShelfTags` to the `collections: [...]` array (after `FiringRequests`).

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test:int tests/int/shelves.int.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/collections/ShelfTags.ts src/payload.config.ts tests/int/shelves.int.spec.ts
git commit -m "feat(shelves): add reusable shelf-tags collection"
```

---

### Task 2: `shelves` collection

**Files:**
- Create: `src/collections/Shelves.ts`
- Modify: `src/payload.config.ts`
- Test: `tests/int/shelves.int.spec.ts`

**Interfaces:**
- Produces: slug `shelves` with `name` (text, required, unique, `useAsTitle`), `tag` (relationship → `shelf-tags`, optional), `assignedMember` (relationship → `people`, optional, read-only in UI; written by hooks via `overrideAccess`). `defaultColumns: ['name','tag','assignedMember']`. The unassigned-shelves display is this list filtered by `assignedMember` exists:false.

- [ ] **Step 1: Write the failing test** (append to `tests/int/shelves.int.spec.ts`)

```ts
describe('shelves', () => {
  it('creates a shelf with required name and optional tag', async () => {
    const payload = await getTestPayload()
    const shelf = await payload.create({
      collection: 'shelves', overrideAccess: true,
      data: { name: `PLAN-SHELF-${Date.now()}` },
    })
    expect(shelf.name).toContain('PLAN-SHELF')
    expect(shelf.assignedMember).toBeFalsy()
  })

  it('can be filtered by unassigned (assignedMember exists:false)', async () => {
    const payload = await getTestPayload()
    await payload.create({ collection: 'shelves', overrideAccess: true, data: { name: `PLAN-SHELF-unassigned-${Date.now()}` } })
    const { docs } = await payload.find({
      collection: 'shelves', overrideAccess: true,
      where: { assignedMember: { exists: false } }, limit: 100,
    })
    expect(docs.length).toBeGreaterThan(0)
    expect(docs.every((d) => !d.assignedMember)).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test:int tests/int/shelves.int.spec.ts`
Expected: FAIL — collection `shelves` does not exist.

- [ ] **Step 3: Create the collection**

```ts
// src/collections/Shelves.ts
import type { CollectionConfig } from 'payload'
import { isAdmin } from '../access/isAdmin'
import { isAdminOrEditor } from '../access/isAdminOrEditor'

// A physical studio shelf. `assignedMember` is the occupancy source of truth,
// maintained by the People `syncShelfAssignment` hook — not edited directly.
// The "unassigned shelves" display is this list filtered to assignedMember empty.
export const Shelves: CollectionConfig = {
  slug: 'shelves',
  labels: { singular: 'Shelf', plural: 'Shelves' },
  admin: {
    group: 'Studio',
    useAsTitle: 'name',
    defaultColumns: ['name', 'tag', 'assignedMember'],
    description: 'Filter by “Assigned Member → exists: No” to see currently-unassigned shelves.',
  },
  access: { read: isAdminOrEditor, create: isAdminOrEditor, update: isAdminOrEditor, delete: isAdmin },
  fields: [
    { name: 'name', type: 'text', required: true, unique: true, admin: { description: 'Free-form shelf number/name, e.g. "B-12".' } },
    { name: 'tag', type: 'relationship', relationTo: 'shelf-tags', hasMany: false },
    {
      name: 'assignedMember', type: 'relationship', relationTo: 'people', hasMany: false,
      admin: { readOnly: true, description: 'Set automatically from the member’s page.' },
    },
  ],
}
```

- [ ] **Step 4: Register it**

In `src/payload.config.ts`: `import { Shelves } from './collections/Shelves'` and add `Shelves` to `collections` (after `ShelfTags`).

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm test:int tests/int/shelves.int.spec.ts`
Expected: PASS (both new tests).

- [ ] **Step 6: Commit**

```bash
git add src/collections/Shelves.ts src/payload.config.ts tests/int/shelves.int.spec.ts
git commit -m "feat(shelves): add shelves collection with optional tag + member"
```

---

### Task 3: Replace `shelfLabel` with `people.shelf`

**Files:**
- Modify: `src/collections/People.ts` (remove `shelfLabel`; add `shelf`; update `defaultColumns`)
- Test: `tests/int/shelves.int.spec.ts`

**Interfaces:**
- Produces: `people.shelf` — relationship → `shelves`, `hasMany:false`, shown only when the person has a `plan`, with `filterOptions` limiting choices to unassigned shelves (or the person's current one).

- [ ] **Step 1: Write the failing test** (append)

```ts
describe('people.shelf', () => {
  it('stores a shelf relationship and no longer has shelfLabel', async () => {
    const payload = await getTestPayload()
    const shelf = await payload.create({ collection: 'shelves', overrideAccess: true, data: { name: `PLAN-SHELF-rel-${Date.now()}` } })
    const member = await payload.create({
      collection: 'people', overrideAccess: true,
      data: { name: 'ShelfRel', email: `rel-${Date.now()}@shelftest.local`, status: 'active', shelf: shelf.id },
    })
    expect(member).not.toHaveProperty('shelfLabel')
    const fresh = await payload.findByID({ collection: 'people', id: member.id, depth: 0, overrideAccess: true })
    expect(fresh.shelf).toBe(shelf.id)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test:int tests/int/shelves.int.spec.ts`
Expected: FAIL — `shelf` is not a known field (and/or `shelfLabel` still present).

- [ ] **Step 3: Edit `src/collections/People.ts`**

Change `defaultColumns` (line ~18) from `['name', 'plan', 'status', 'shelfLabel', 'subscriptionStatus']` to:
```ts
defaultColumns: ['name', 'plan', 'status', 'shelf', 'subscriptionStatus'],
```
Remove the `shelfLabel` field line entirely and replace with:
```ts
    {
      name: 'shelf', type: 'relationship', relationTo: 'shelves', hasMany: false,
      admin: { condition: (data) => Boolean(data?.plan) },
      filterOptions: ({ id }) => {
        const clauses: Record<string, unknown>[] = [{ assignedMember: { exists: false } }]
        if (id) clauses.push({ assignedMember: { equals: id } })
        return { or: clauses }
      },
    },
```

- [ ] **Step 4: Regenerate types**

Run: `pnpm generate:types`
Expected: `src/payload-types.ts` updates — `Person.shelf?` appears, `Person.shelfLabel` is gone, `Shelf`/`ShelfTag` types exist.

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm test:int tests/int/shelves.int.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/collections/People.ts src/payload-types.ts tests/int/shelves.int.spec.ts
git commit -m "feat(shelves): replace member shelfLabel with shelf relationship"
```

---

### Task 4: `syncShelfAssignment` hook — keep `assignedMember` in sync

**Files:**
- Create: `src/hooks/syncShelfAssignment.ts`
- Modify: `src/collections/People.ts` (register in `hooks.afterChange`)
- Test: `tests/int/shelf-sync.int.spec.ts`

**Interfaces:**
- Consumes: `people.shelf`, `shelves.assignedMember` (Task 2/3).
- Produces: `syncShelfAssignment: CollectionAfterChangeHook<Person>`. After it runs, the shelf referenced by `people.shelf` has `assignedMember` equal to that person, and no other shelf or member references conflict.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/int/shelf-sync.int.spec.ts
import { describe, it, expect, afterAll } from 'vitest'
import { getTestPayload } from './helpers'

const EM = () => `sync-${Date.now()}-${Math.floor(Math.random() * 1e6)}@shelftest.local`
async function mkShelf(p: any, n: string) { return p.create({ collection: 'shelves', overrideAccess: true, data: { name: `PLAN-SHELF-${n}-${Date.now()}` } }) }
async function mkMember(p: any) { return p.create({ collection: 'people', overrideAccess: true, data: { name: 'SyncM', email: EM(), status: 'active' } }) }
async function shelfOf(p: any, id: number) { return p.findByID({ collection: 'shelves', id, depth: 0, overrideAccess: true }) }
async function personOf(p: any, id: number) { return p.findByID({ collection: 'people', id, depth: 0, overrideAccess: true }) }

describe('syncShelfAssignment', () => {
  it('stamps assignedMember when a member is given a shelf', async () => {
    const p = await getTestPayload()
    const s = await mkShelf(p, 'a'); const m = await mkMember(p)
    await p.update({ collection: 'people', id: m.id, overrideAccess: true, data: { shelf: s.id } })
    expect((await shelfOf(p, s.id)).assignedMember).toBe(m.id)
  })

  it('frees the previous shelf on reassignment', async () => {
    const p = await getTestPayload()
    const s1 = await mkShelf(p, 'b1'); const s2 = await mkShelf(p, 'b2'); const m = await mkMember(p)
    await p.update({ collection: 'people', id: m.id, overrideAccess: true, data: { shelf: s1.id } })
    await p.update({ collection: 'people', id: m.id, overrideAccess: true, data: { shelf: s2.id } })
    expect((await shelfOf(p, s1.id)).assignedMember).toBeFalsy()
    expect((await shelfOf(p, s2.id)).assignedMember).toBe(m.id)
  })

  it('reassigning a held shelf clears the prior holder', async () => {
    const p = await getTestPayload()
    const s = await mkShelf(p, 'c'); const m1 = await mkMember(p); const m2 = await mkMember(p)
    await p.update({ collection: 'people', id: m1.id, overrideAccess: true, data: { shelf: s.id } })
    await p.update({ collection: 'people', id: m2.id, overrideAccess: true, data: { shelf: s.id } })
    expect((await personOf(p, m1.id)).shelf).toBeFalsy()
    expect((await shelfOf(p, s.id)).assignedMember).toBe(m2.id)
  })
})

afterAll(async () => {
  const p = await getTestPayload()
  await p.delete({ collection: 'people', where: { email: { contains: '@shelftest.local' } }, overrideAccess: true })
  await p.delete({ collection: 'shelves', where: { name: { contains: 'PLAN-SHELF' } }, overrideAccess: true })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test:int tests/int/shelf-sync.int.spec.ts`
Expected: FAIL — `assignedMember` stays empty (no hook yet).

- [ ] **Step 3: Create the hook**

```ts
// src/hooks/syncShelfAssignment.ts
import type { CollectionAfterChangeHook } from 'payload'
import type { Person } from '../payload-types'

/** Square statuses that mean the subscription has truly ended (not a scheduled cancel). */
const ENDED_SQUARE_STATUSES = ['CANCELED', 'DEACTIVATED']

function relId(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === 'object') return (v as { id?: number }).id ?? null
  return typeof v === 'number' ? v : Number(v) || null
}

/**
 * Keep `shelves.assignedMember` in sync with the member's `shelf` selection
 * (the member page is where shelves are assigned), and free the shelf when the
 * membership truly ends in Square. Writes pass `req` (transaction-safe) and set
 * `fromShelfSync` so re-entry is a no-op.
 */
export const syncShelfAssignment: CollectionAfterChangeHook<Person> = async ({ doc, previousDoc, operation, req }) => {
  if (operation !== 'create' && operation !== 'update') return doc
  if (req?.context?.fromShelfSync) return doc
  const payload = req.payload

  const shelfId = relId(doc.shelf)
  const prevShelfId = relId(previousDoc?.shelf)

  // (A) Free the shelf on true Square expiry (raw status edge into CANCELED/DEACTIVATED).
  const prevEnded = ENDED_SQUARE_STATUSES.includes(previousDoc?.subscriptionStatus ?? '')
  const nowEnded = ENDED_SQUARE_STATUSES.includes(doc.subscriptionStatus ?? '')
  if (shelfId && nowEnded && !prevEnded) {
    await payload.update({ collection: 'people', id: doc.id, overrideAccess: true, context: { fromShelfSync: true }, data: { shelf: null } })
    await payload.update({ collection: 'shelves', id: shelfId, overrideAccess: true, context: { fromShelfSync: true }, data: { assignedMember: null } })
    return { ...doc, shelf: null }
  }

  // (B) Sync assignedMember to the chosen shelf.
  if (shelfId === prevShelfId) return doc

  if (prevShelfId) {
    await payload.update({ collection: 'shelves', id: prevShelfId, overrideAccess: true, context: { fromShelfSync: true }, data: { assignedMember: null } })
  }
  if (shelfId) {
    const shelf = await payload.findByID({ collection: 'shelves', id: shelfId, depth: 0, overrideAccess: true })
    const priorHolder = relId(shelf.assignedMember)
    if (priorHolder && priorHolder !== doc.id) {
      await payload.update({ collection: 'people', id: priorHolder, overrideAccess: true, context: { fromShelfSync: true }, data: { shelf: null } })
    }
    await payload.update({ collection: 'shelves', id: shelfId, overrideAccess: true, context: { fromShelfSync: true }, data: { assignedMember: doc.id } })
  }

  return doc
}
```

- [ ] **Step 4: Register the hook**

In `src/collections/People.ts`: add the import `import { syncShelfAssignment } from '../hooks/syncShelfAssignment'` and add it to `hooks.afterChange` so the array reads:
```ts
afterChange: [reconcileMemberSubscription, cancelSquareSubscription, syncShelfAssignment],
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm test:int tests/int/shelf-sync.int.spec.ts`
Expected: PASS (all three).

- [ ] **Step 6: Commit**

```bash
git add src/hooks/syncShelfAssignment.ts src/collections/People.ts tests/int/shelf-sync.int.spec.ts
git commit -m "feat(shelves): sync shelf occupancy from member assignment"
```

---

### Task 5: Auto-unassign on true Square expiry

**Files:**
- Test: `tests/int/shelf-sync.int.spec.ts` (append)

**Interfaces:**
- Consumes: `syncShelfAssignment` (Task 4), which already contains branch (A). This task adds the tests that lock in expiry vs. retain behavior. No new production code unless a test fails.

- [ ] **Step 1: Write the failing/locking tests** (append inside the `syncShelfAssignment` describe)

```ts
  it('frees the shelf when Square reports the sub truly ended', async () => {
    const p = await getTestPayload()
    const s = await mkShelf(p, 'exp'); const m = await mkMember(p)
    await p.update({ collection: 'people', id: m.id, overrideAccess: true, data: { shelf: s.id, subscriptionStatus: 'ACTIVE' } })
    await p.update({ collection: 'people', id: m.id, overrideAccess: true, context: { fromSquareWebhook: true }, data: { subscriptionStatus: 'DEACTIVATED', status: 'cancelled' } })
    expect((await personOf(p, m.id)).shelf).toBeFalsy()
    expect((await shelfOf(p, s.id)).assignedMember).toBeFalsy()
  })

  it('keeps the shelf on a scheduled cancel (still ACTIVE in Square)', async () => {
    const p = await getTestPayload()
    const s = await mkShelf(p, 'sched'); const m = await mkMember(p)
    await p.update({ collection: 'people', id: m.id, overrideAccess: true, data: { shelf: s.id, subscriptionStatus: 'ACTIVE' } })
    await p.update({ collection: 'people', id: m.id, overrideAccess: true, context: { fromSquareWebhook: true }, data: { status: 'cancelled' } })
    expect((await personOf(p, m.id)).shelf).toBe(s.id)
  })

  it('keeps the shelf when only paused', async () => {
    const p = await getTestPayload()
    const s = await mkShelf(p, 'pause'); const m = await mkMember(p)
    await p.update({ collection: 'people', id: m.id, overrideAccess: true, data: { shelf: s.id, subscriptionStatus: 'ACTIVE' } })
    await p.update({ collection: 'people', id: m.id, overrideAccess: true, context: { fromSquareWebhook: true }, data: { subscriptionStatus: 'PAUSED', status: 'paused' } })
    expect((await personOf(p, m.id)).shelf).toBe(s.id)
  })
```

- [ ] **Step 2: Run to verify**

Run: `pnpm test:int tests/int/shelf-sync.int.spec.ts`
Expected: PASS. If the "scheduled cancel" or "paused" test fails (shelf was freed), the branch-(A) condition is wrong — it must key off raw `subscriptionStatus` ∈ {CANCELED, DEACTIVATED}, not internal `status`. Fix in `syncShelfAssignment.ts` and re-run.

- [ ] **Step 3: Commit**

```bash
git add tests/int/shelf-sync.int.spec.ts src/hooks/syncShelfAssignment.ts
git commit -m "test(shelves): lock in expiry-frees vs scheduled-cancel-retains"
```

---

### Task 6: Cascade cleanup on shelf/tag deletion

**Files:**
- Modify: `src/collections/Shelves.ts` (add `beforeDelete` hook clearing the holder's `people.shelf`)
- Modify: `src/collections/Shelves.ts` `tag` field → relationship already nulls on tag delete via Postgres FK `ON DELETE set null` (Payload default for `hasMany:false` relationship). Add a test to confirm.
- Test: `tests/int/shelf-sync.int.spec.ts` (append)

**Interfaces:**
- Produces: deleting a shelf clears the assigned member's `people.shelf`; deleting a tag nulls `shelves.tag`.

- [ ] **Step 1: Write the failing tests** (append, new describe)

```ts
describe('shelf/tag deletion', () => {
  it('clears the member ref when an assigned shelf is deleted', async () => {
    const p = await getTestPayload()
    const s = await mkShelf(p, 'del'); const m = await mkMember(p)
    await p.update({ collection: 'people', id: m.id, overrideAccess: true, data: { shelf: s.id } })
    await p.delete({ collection: 'shelves', id: s.id, overrideAccess: true })
    expect((await personOf(p, m.id)).shelf).toBeFalsy()
  })

  it('nulls a shelf tag when the tag is deleted', async () => {
    const p = await getTestPayload()
    const tag = await p.create({ collection: 'shelf-tags', overrideAccess: true, data: { name: `Back room del ${Date.now()}` } })
    const s = await p.create({ collection: 'shelves', overrideAccess: true, data: { name: `PLAN-SHELF-tagdel-${Date.now()}`, tag: tag.id } })
    await p.delete({ collection: 'shelf-tags', id: tag.id, overrideAccess: true })
    expect((await shelfOf(p, s.id)).tag).toBeFalsy()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test:int tests/int/shelf-sync.int.spec.ts`
Expected: the first test FAILS (member.shelf still points at the deleted shelf, leaving a dangling ref). The tag test likely already passes (FK set-null).

- [ ] **Step 3: Add the `beforeDelete` hook to `src/collections/Shelves.ts`**

Add an import and a `hooks` block:
```ts
import type { CollectionConfig, CollectionBeforeDeleteHook } from 'payload'
// ...
const clearMemberOnShelfDelete: CollectionBeforeDeleteHook = async ({ req, id }) => {
  await req.payload.update({
    collection: 'people', where: { shelf: { equals: id } },
    overrideAccess: true, context: { fromShelfSync: true }, data: { shelf: null },
  })
}
```
And in the `Shelves` config add: `hooks: { beforeDelete: [clearMemberOnShelfDelete] },`

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test:int tests/int/shelf-sync.int.spec.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/collections/Shelves.ts tests/int/shelf-sync.int.spec.ts
git commit -m "feat(shelves): clear member ref when an assigned shelf is deleted"
```

---

### Task 7: Cancellation email shows the assigned shelf name

**Files:**
- Modify: `src/hooks/cancelSquareSubscription.ts:11`
- Test: `tests/int/shelf-cancel-email.int.spec.ts`

**Interfaces:**
- Consumes: `people.shelf`. Produces: the cancellation email's "Shelf" line shows the assigned shelf's `name`, or "none on file".

- [ ] **Step 1: Write the failing test**

```ts
// tests/int/shelf-cancel-email.int.spec.ts
import { describe, it, expect, afterAll, vi } from 'vitest'
import { getTestPayload } from './helpers'
import { resolveShelfName } from '../../src/hooks/cancelSquareSubscription'

describe('cancellation shelf name', () => {
  it('resolves the assigned shelf name, else "none on file"', async () => {
    const p = await getTestPayload()
    const s = await p.create({ collection: 'shelves', overrideAccess: true, data: { name: `PLAN-SHELF-email-${Date.now()}` } })
    const withShelf = await resolveShelfName(p, s.id)
    expect(withShelf).toBe(s.name)
    const without = await resolveShelfName(p, null)
    expect(without).toBe('none on file')
  })
})

afterAll(async () => {
  const p = await getTestPayload()
  await p.delete({ collection: 'shelves', where: { name: { contains: 'PLAN-SHELF' } }, overrideAccess: true })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test:int tests/int/shelf-cancel-email.int.spec.ts`
Expected: FAIL — `resolveShelfName` is not exported.

- [ ] **Step 3: Edit `src/hooks/cancelSquareSubscription.ts`**

Add an exported helper and use it. Replace the `const shelf = member.shelfLabel || 'none on file'` line. Add near the top of the file:
```ts
import type { Payload } from 'payload'

/** Resolve a member's assigned shelf name for staff emails, or "none on file". */
export async function resolveShelfName(payload: Payload, shelfRef: number | { id?: number } | null | undefined): Promise<string> {
  const id = shelfRef == null ? null : typeof shelfRef === 'object' ? shelfRef.id ?? null : shelfRef
  if (!id) return 'none on file'
  try {
    const shelf = await payload.findByID({ collection: 'shelves', id, depth: 0, overrideAccess: true })
    return shelf?.name || 'none on file'
  } catch {
    return 'none on file'
  }
}
```
Change `notifyStaffOfCancellation` to accept the resolved name. Update its signature to `(member: Person, lastDay: string | null, to: string | undefined, shelf: string)` and use `shelf` in the HTML instead of `member.shelfLabel`. (Note: `to` was already added in the prior Site-Settings change.) At the call site in the hook, compute it:
```ts
await notifyStaffOfCancellation(doc, res.subscription?.canceledDate ?? null, await getNotifyEmail(req.payload), await resolveShelfName(req.payload, doc.shelf))
```
Remove the old `const shelf = member.shelfLabel || 'none on file'` line inside `notifyStaffOfCancellation` and use the passed `shelf` parameter.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test:int tests/int/shelf-cancel-email.int.spec.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck the whole project**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0 (no `shelfLabel` references remain).

- [ ] **Step 6: Commit**

```bash
git add src/hooks/cancelSquareSubscription.ts tests/int/shelf-cancel-email.int.spec.ts
git commit -m "feat(shelves): cancellation email uses assigned shelf name"
```

---

### Task 8: Production migration + final verification

**Files:**
- Create: `src/migrations/<timestamp>_add_shelves.ts` (+ `.json`)
- Modify: `src/migrations/index.ts` (generated)

**Interfaces:** Consumes the final schema (Tasks 1–7). Produces a migration that creates `shelf_tags` + `shelves` (+ their `_rels`), adds the `people.shelf` relationship, and drops `people.shelf_label`.

- [ ] **Step 1: Start a throwaway dev DB at the current (pre-change) migrated state**

```bash
docker rm -f portside-migdev 2>/dev/null || true
docker run -d --name portside-migdev -e POSTGRES_USER=portside -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=portside_dev -p 5433:5432 postgres:16-alpine
sleep 3
DATABASE_URL="postgres://portside:dev@localhost:5433/portside_dev" PAYLOAD_SECRET=dev NODE_ENV=development pnpm payload migrate
```
Expected: the existing migrations apply through `add_firing_completed_at`.

- [ ] **Step 2: Generate the migration**

```bash
DATABASE_URL="postgres://portside:dev@localhost:5433/portside_dev" PAYLOAD_SECRET=dev NODE_ENV=development pnpm payload migrate:create add_shelves
```
Expected: a new file `src/migrations/<ts>_add_shelves.ts`. Open it and confirm `up()` contains: `CREATE TABLE "shelf_tags"`, `CREATE TABLE "shelves"`, relationship wiring for `shelves.tag`/`shelves.assignedMember` and `people.shelf` (a `shelf_id` column or `_rels` entries — whatever Payload generated), and `ALTER TABLE "people" DROP COLUMN "shelf_label"`. No data backfill is needed.

- [ ] **Step 3: Apply it on the dev DB to verify it runs**

```bash
DATABASE_URL="postgres://portside:dev@localhost:5433/portside_dev" PAYLOAD_SECRET=dev NODE_ENV=development pnpm payload migrate
```
Expected: `Migrating: <ts>_add_shelves` → `Done.` with no error.

- [ ] **Step 4: Tear down the dev DB**

```bash
docker rm -f portside-migdev
```

- [ ] **Step 5: Full typecheck + full int suite**

```bash
npx tsc --noEmit -p tsconfig.json
pnpm test:int
```
Expected: tsc exit 0; all integration tests pass. (If `push` prompts on the test DB, recreate `portside_test` per the Global Constraints note and re-run.)

- [ ] **Step 6: Commit**

```bash
git add src/migrations/
git commit -m "feat(shelves): migration — add shelves/shelf-tags, drop shelf_label"
```

---

## Deployment (after all tasks pass)

Follow the established deploy loop (not a per-task step): build `linux/amd64` image, `docker save | ssh docker load`, `docker compose run --rm app pnpm payload migrate`, then `docker compose up -d --force-recreate app`. Verify in the admin: create a couple of shelves + a tag, assign one from a member's page (dropdown shows only unassigned), check the Shelves list filtered by unassigned, and confirm reassigning frees the prior shelf.

## Self-Review notes
- Spec coverage: shelf-tags (T1), shelves + unassigned display (T2), member.shelf + filterOptions (T3), assignment sync + one↔one (T4), true-expiry auto-unassign (T5), delete cascades (T6), cancellation email + shelfLabel removal (T7), migration/cleanup (T8). All spec sections mapped.
- Filter-options dropdown is an admin-UI behavior verified manually at deploy (not unit-tested); the underlying unassigned query is tested in T2.

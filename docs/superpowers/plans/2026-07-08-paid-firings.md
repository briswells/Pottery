# Paid Firings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Self-serve pay-up-front firing requests — N half shelves × $25, up to 5 photos, stoneware-only, coupons supported — replacing the staff-quote/invoice flow entirely.

**Architecture:** `createPaidFiring` mirrors `src/services/booking.ts`'s proven order (validate → pending row holds the coupon slot → charge → paid → payments row → best-effort person/emails). Coupons gain a `firing` scope via a generalized `validateCoupon` target; redemption usage counts bookings + firing-requests. The public page/form mirror `BookingForm`'s Square SDK handling. Spec: `docs/superpowers/specs/2026-07-08-paid-firings-design.md`.

**Tech Stack:** Payload 3.85 (Postgres, Drizzle migrations), Next.js 16, Square Web Payments SDK, Vitest.

## Global Constraints

- Constants: `FIRING_HALF_SHELF_CENTS = 2500`, `MAX_HALF_SHELVES = 8` (min 1), `MAX_FIRING_PHOTOS = 5` (min 1). Half-shelf dimensions 11″×22″×6″ are page copy only.
- Coupon rejection reasons are EXACT strings. Existing six unchanged; new: `"That code isn't valid for firings."` (class-scoped code on a firing). Firing-scoped code on a class booking reuses `"That code isn't valid for this class."`
- The client is never trusted: charge-time validation is authoritative; the pending row carries the coupon (slot held); `finalCents === 0` skips Square; a non-zero total without `sourceId` throws exactly `'Payment information is required'`.
- Money-failure rollback: charge failure → firing request `cancelled` (same as bookings; cancelled rows release coupon slots because usage counts only `paid`/`pending`).
- Tests: `tests/int/*.int.spec.ts` via `pnpm test:int <path>`; Payload from `getTestPayload()` (`./helpers`). Schema changes in Tasks 2+ → recreate `portside_test` first: `docker run --rm --add-host=host.docker.internal:host-gateway postgres:16-alpine psql "postgres://portside:portside@host.docker.internal:5432/postgres" -c "DROP DATABASE IF EXISTS portside_test;" -c "CREATE DATABASE portside_test;"`
- Prod runs migrations (push off). Task 7 generates the migration on a throwaway dev DB; `down()` uses `IF EXISTS` drops (established lesson).
- Hooks/services touching the DB inside hooks pass `req` (documented footgun). `NEXT_PUBLIC_SQUARE_*` are build-time args (deploy note only).

---

### Task 1: Coupon firing scope + generalized target

**Files:**
- Modify: `src/collections/Coupons.ts` (appliesTo gains `firing`)
- Modify: `src/services/coupons.ts` (target union; cross-collection usage)
- Modify: `src/services/booking.ts` (call site → `target: { kind: 'class', classId }`)
- Modify: `src/app/api/coupons/validate/route.ts` (accept firing shape)
- Test: `tests/int/coupon-firing-scope.int.spec.ts` (new); existing `tests/int/coupon-validate.int.spec.ts` updated to the new signature

**Interfaces:**
- Consumes: existing `CouponCheck`, `computeDiscount` (unchanged).
- Produces:
  ```ts
  type CouponTarget = { kind: 'class'; classId: number } | { kind: 'firing' }
  validateCoupon(deps: { payload: Payload }, args: {
    code: string; priceCents: number; customerEmail?: string; target: CouponTarget
  }): Promise<CouponCheck>
  ```
  Scope rules: `all` → valid for both; `class` → only class targets with matching `classId` (firing target → reason `"That code isn't valid for firings."`); `firing` → only firing targets (class target → `"That code isn't valid for this class."`).
  Usage counts: `payload.count` on `bookings` PLUS `firing-requests`, both `status in ['paid','pending']`, coupon equals; `onePerCustomer` candidate query (`customerEmail like` + JS ci-equality, no cap) runs against BOTH collections. NOTE: `firing-requests.coupon` doesn't exist until Task 2 — guard the firing-requests queries with a try/catch this task (remove the guard is NOT needed later; a comment marks it) OR (preferred) land this task's usage-count change as: query bookings always, query firing-requests inside `try {} catch { /* field lands in Task 2 */ }`. Task 4's tests exercise the cross-collection path for real.

- [ ] **Step 1: Update `tests/int/coupon-validate.int.spec.ts` call sites** — every `validateCoupon(deps, { code, classId, priceCents, ... })` becomes `validateCoupon(deps, { code, priceCents, target: { kind: 'class', classId }, ... })`. Run: expect FAIL (signature not implemented).
- [ ] **Step 2: Write the new scope tests**

```ts
// tests/int/coupon-firing-scope.int.spec.ts
import { describe, it, expect, afterAll } from 'vitest'
import { getTestPayload } from './helpers'
import { validateCoupon } from '../../src/services/coupons'

const CP = () => `CPFIRE${Date.now()}${Math.floor(Math.random() * 1e4)}`
async function mkCoupon(p: any, over: Record<string, unknown> = {}) {
  return p.create({ collection: 'coupons', overrideAccess: true, data: { code: CP(), discountType: 'percent', percentOff: 20, ...over } })
}
async function mkClass(p: any) {
  return p.create({ collection: 'classes', overrideAccess: true, data: { title: `CpFireCls ${Date.now()}-${Math.random()}`, defaultPriceCents: 5000, defaultCapacity: 5 } })
}

describe('coupon firing scope', () => {
  it('all-scope works for both targets', async () => {
    const p = await getTestPayload()
    const cls = await mkClass(p)
    const c = await mkCoupon(p) // appliesTo defaults to all
    expect(await validateCoupon({ payload: p }, { code: c.code, priceCents: 5000, target: { kind: 'class', classId: cls.id } })).toMatchObject({ ok: true })
    expect(await validateCoupon({ payload: p }, { code: c.code, priceCents: 5000, target: { kind: 'firing' } })).toMatchObject({ ok: true, discountCents: 1000 })
  })

  it('class-scope rejects firing targets with the exact reason', async () => {
    const p = await getTestPayload()
    const cls = await mkClass(p)
    const c = await mkCoupon(p, { appliesTo: 'class', class: cls.id })
    expect(await validateCoupon({ payload: p }, { code: c.code, priceCents: 5000, target: { kind: 'firing' } }))
      .toMatchObject({ ok: false, reason: "That code isn't valid for firings." })
  })

  it('firing-scope rejects class targets and accepts firing targets', async () => {
    const p = await getTestPayload()
    const cls = await mkClass(p)
    const c = await mkCoupon(p, { appliesTo: 'firing' })
    expect(await validateCoupon({ payload: p }, { code: c.code, priceCents: 5000, target: { kind: 'class', classId: cls.id } }))
      .toMatchObject({ ok: false, reason: "That code isn't valid for this class." })
    expect(await validateCoupon({ payload: p }, { code: c.code, priceCents: 5000, target: { kind: 'firing' } })).toMatchObject({ ok: true })
  })
})

afterAll(async () => {
  const p = await getTestPayload()
  await p.delete({ collection: 'coupons', where: { code: { contains: 'CPFIRE' } }, overrideAccess: true })
  await p.delete({ collection: 'classes', where: { title: { contains: 'CpFireCls' } }, overrideAccess: true })
})
```

- [ ] **Step 3: Implement.** `Coupons.ts` appliesTo options: add `{ label: 'Firings only', value: 'firing' }` (the `class` relationship's condition/validate unchanged — only `appliesTo === 'class'` shows it). `coupons.ts`: replace `classId` arg with `target`; scope logic per Interfaces; extract a `countUsage(payload, couponId)`/`emailUsed(...)` pair that sums/ORs across `bookings` and `firing-requests` (try/catch on the latter until Task 2's field exists). `booking.ts` call site passes `target: { kind: 'class', classId }`. Preview route: keep the existing class shape; add firing shape `{ code, firing: true, halfShelves, email? }` → validate `halfShelves` 1–8 → `priceCents = 2500 * halfShelves` → `validateCoupon(..., target: { kind: 'firing' })` (import constants from Task 4's lib — this task defines them: create `src/lib/firing-pricing.ts` exporting `FIRING_HALF_SHELF_CENTS = 2500`, `MAX_HALF_SHELVES = 8`, `MAX_FIRING_PHOTOS = 5`).
- [ ] **Step 4: Regenerate types** (`pnpm generate:types`); run both coupon spec files + `tests/int/booking-coupon.int.spec.ts` → all green; `npx tsc --noEmit` → 0.
- [ ] **Step 5: Commit** `feat(coupons): firing scope + generalized validation target`

---

### Task 2: FiringRequests rebuild + invoice machinery removal

**Files:**
- Modify: `src/collections/FiringRequests.ts` (fields per spec)
- Delete: `src/hooks/sendFiringInvoice.ts`, `src/services/firing-invoice.ts`, `src/lib/firing-invoice-gateway.ts`
- Modify: `src/app/api/webhooks/square/route.ts` (remove firing-invoice handling; membership invoice handling stays intact)
- Modify: `src/app/api/firings/route.ts` (STUB ONLY this task: keep compiling by removing references to deleted fields — full rewrite is Task 5)
- Modify/Delete tests that exercise the removed machinery (grep `sendFiringInvoice|firing-invoice|quotedPriceCents` across `tests/`)
- Test: `tests/int/firing-requests.int.spec.ts` (new)

**Interfaces:**
- Produces `firing-requests` fields: keep `name` (required), `email` (required), `phone`, `description` (required), `notes`, `person`, `paidAt` (readOnly), `completedAt` (readOnly + existing `setFiringCompletedAt` hook stays); add `halfShelves` (number, required, min 1, max 8), `amountCents` (number, required, PriceField/PriceCell UI), `squarePaymentId` (text, index), `coupon` (relationship → coupons, hasMany false), `discountCents` (number, PriceField UI), `stonewareConfirmed` (checkbox, required — validate true), `photos` (upload relationTo media, `hasMany: true`, `maxRows`… upload hasMany uses `hasMany: true` + validate length ≤ 5). `status` select options exactly: pending (default), paid, completed, cancelled, refunded. `defaultColumns: ['name','halfShelves','status','amountCents','paidAt']`. Access unchanged (create server-side only).
- Webhook: delete the branches/lookups that resolve firing requests by `squareInvoiceId` (grep the route for `firing`); membership `invoice.updated` / `invoice.payment_made` logic must remain byte-equivalent for members.

- [ ] **Step 1: Failing test** (recreate `portside_test` first per Global Constraints)

```ts
// tests/int/firing-requests.int.spec.ts
import { describe, it, expect, afterAll } from 'vitest'
import { getTestPayload } from './helpers'

async function mkPhoto(p: any) {
  // 1x1 png buffer — media create needs a real file
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
  return p.create({ collection: 'media', overrideAccess: true, data: { alt: 'fr test' }, file: { data: png, mimetype: 'image/png', name: `fr-${Date.now()}-${Math.random()}.png`, size: png.length } })
}

describe('firing-requests (rebuilt)', () => {
  it('stores halfShelves, photos array, stoneware flag, coupon fields', async () => {
    const p = await getTestPayload()
    const ph1 = await mkPhoto(p); const ph2 = await mkPhoto(p)
    const fr = await p.create({ collection: 'firing-requests', overrideAccess: true, data: {
      name: 'FR Test', email: 'fr@frtest.local', description: 'two mugs', halfShelves: 2,
      amountCents: 5000, stonewareConfirmed: true, status: 'pending', photos: [ph1.id, ph2.id],
    } })
    expect(fr.halfShelves).toBe(2)
    expect((fr.photos as any[]).length).toBe(2)
    expect(fr.stonewareConfirmed).toBe(true)
  })

  it('rejects out-of-range halfShelves and missing stoneware confirmation', async () => {
    const p = await getTestPayload()
    await expect(p.create({ collection: 'firing-requests', overrideAccess: true, data: {
      name: 'X', email: 'x@frtest.local', description: 'd', halfShelves: 9, amountCents: 1, stonewareConfirmed: true,
    } })).rejects.toThrow()
    await expect(p.create({ collection: 'firing-requests', overrideAccess: true, data: {
      name: 'X', email: 'x2@frtest.local', description: 'd', halfShelves: 1, amountCents: 1, stonewareConfirmed: false,
    } })).rejects.toThrow()
  })

  it('no invoice-era fields remain', async () => {
    const p = await getTestPayload()
    const fr = await p.create({ collection: 'firing-requests', overrideAccess: true, data: {
      name: 'Y', email: 'y@frtest.local', description: 'd', halfShelves: 1, amountCents: 2500, stonewareConfirmed: true,
    } })
    expect(fr).not.toHaveProperty('quotedPriceCents')
    expect(fr).not.toHaveProperty('squareInvoiceId')
  })
})

afterAll(async () => {
  const p = await getTestPayload()
  await p.delete({ collection: 'firing-requests', where: { email: { contains: '@frtest.local' } }, overrideAccess: true })
  await p.delete({ collection: 'media', where: { alt: { equals: 'fr test' } }, overrideAccess: true })
})
```

- [ ] **Step 2: Implement** per Interfaces. `stonewareConfirmed` validate: `(v) => v === true || 'You must confirm your pieces are stoneware.'`. `photos` validate: array present, `1 ≤ length ≤ 5` at the FIELD level only for max (`'At most 5 photos.'`) — the ≥1 requirement is enforced by the service (Task 4), not the collection (admin may edit legacy rows). Delete the three invoice files; strip the webhook's firing-invoice handling; stub the firings route so tsc passes (`return Response.json({ error: 'Firings are temporarily unavailable' }, { status: 503 })` with a `// Task 5 rewrites this` comment). Update/remove broken tests found by the grep. `pnpm generate:types`.
- [ ] **Step 3: Verify** — new spec green; grep clean (`grep -rn "sendFiringInvoice\|firing-invoice\|quotedPriceCents" src tests` → nothing); webhook + membership suites green; tsc 0.
- [ ] **Step 4: Commit** `feat(firings)!: rebuild firing-requests for pay-up-front; remove invoice flow`

---

### Task 3: Multi-photo expiry

**Files:**
- Modify: `src/services/expire-firing-media.ts` (photo → photos array)
- Test: existing expiry spec updated (grep `expire-firing-media` usages in `tests/`; if none exists, add `tests/int/firing-media-expiry.int.spec.ts`)

**Interfaces:** unchanged export `expireFiringRequestMedia(payload)`; now the query filters `photos` exists and deletes EVERY photo id in the array, then clears `photos: []` on the request (context `fromFiringHook`, same as today's detach-then-delete order).

- [ ] **Step 1: Failing test** — create a request with 2 photos, `status: 'completed'`, `completedAt` 15 days ago (direct DB update via payload.update with overrideAccess + context to bypass hooks if needed, mirroring the shelf-expiry test style); run `expireFiringRequestMedia`; expect both media rows gone and `photos` empty. A second request completed 1 day ago keeps its photos.
- [ ] **Step 2: Implement, run, commit** `feat(firings): expire all request photos after completion window`

---

### Task 4: `createPaidFiring` service

**Files:**
- Create: `src/services/firing.ts`
- Modify: `src/lib/firing-pricing.ts` only if constants need re-export tweaks
- Test: `tests/int/firing-paid.int.spec.ts`

**Interfaces:**
- Consumes: `validateCoupon` (Task 1 target union), `chargeCard` types, `sendEmail`, `getNotifyEmail`, `upsertPersonByEmail`, constants from `src/lib/firing-pricing.ts`, `nextFiringDate` NOT needed here (email says "the next scheduled firing" generically or uses Task 6's util — keep email copy date-free to avoid a dependency: "We'll fire your pieces at the next monthly firing.").
- Produces:
  ```ts
  interface FiringDeps { payload: Payload; charge: (i: ChargeInput) => Promise<ChargeResult>; sendEmail: (i: EmailInput) => Promise<void> }
  interface FiringInput {
    halfShelves: number; photoIds: number[]; sourceId?: string; couponCode?: string
    customerName: string; customerEmail: string; customerPhone?: string
    description: string; notes?: string; stonewareConfirmed: boolean
  }
  createPaidFiring(deps: FiringDeps, input: FiringInput): Promise<FiringRequest>
  ```
  Behavior invariants (mirror `createPaidBooking` exactly, in this order): input validation (halfShelves 1–8 → `'Choose between 1 and 8 half shelves'`; `stonewareConfirmed !== true` → `'Please confirm your pieces are stoneware'`; `photoIds.length < 1 || > 5` → `'Please attach between 1 and 5 photos'`), price = `FIRING_HALF_SHELF_CENTS * halfShelves`, coupon check (`target: { kind: 'firing' }`, always pass customerEmail; throw reason), sourceId gate, pending row (with coupon/discount/amountCents/photos/status pending/stonewareConfirmed), charge (skip $0; failure → cancelled + rethrow), paid update (+ squarePaymentId when charged, paidAt now), payments row (`type: 'firing'`, `firingRequest: id`, squareId only when charged, status `charge?.status ?? 'COMPLETED'`), best-effort person link, best-effort emails: customer confirmation (halfShelves count, size copy "half shelf (11″×22″×6″)", amount line with the exact booking-style coupon variants) and staff notify via `getNotifyEmail(payload)`.

- [ ] **Step 1: Failing tests** — mirror `tests/int/booking-coupon.int.spec.ts` structure with `deps()` mock charge/sendEmail and a `mkPhoto` helper (from Task 2's spec file — duplicate the helper locally):
  1. paid, no coupon: charge called with `amountCents: 5000` for 2 shelves; request `paid`; payments row `type: 'firing'` with squareId; email html contains `$50.00` and `half shelf`.
  2. 30% coupon: charge `3500`, discountCents `1500`, email contains `(CODE applied)`.
  3. 100% coupon: charge NOT called; `amountCents 0`; payments row squareId null; email contains `Free with code`.
  4. missing sourceId (no coupon) → `'Payment information is required'`.
  5. class-scoped coupon → exact `"That code isn't valid for firings."`, charge not called.
  6. declined charge (mock throws) → request ends `cancelled`, error propagates.
  7. cross-collection redemption: coupon `maxRedemptions: 1`; a pending BOOKING with that coupon exists → firing throws `'That code has been fully redeemed.'`; and inversely a paid FIRING consumes the slot so `createPaidBooking` throws it too.
  8. `onePerCustomer`: paid firing by `a@x.local` blocks a booking by `A@X.LOCAL` with the same code.
- [ ] **Step 2: Implement**, run this spec + `booking-coupon` + `coupon-firing-scope` (all green), tsc 0.
- [ ] **Step 3: Commit** `feat(firings): pay-up-front firing service with coupons`

---

### Task 5: API routes

**Files:**
- Modify: `src/app/api/firings/route.ts` (full rewrite)
- Test: `tests/int/firing-route.int.spec.ts` (route-level parsing/orphan logic via exported helpers OR service-level coverage note — the route stays thin)

**Interfaces:**
- Consumes: `createPaidFiring` (Task 4), `chargeCard`, `sendEmail`, media create (multipart), constants.
- Produces `POST /api/firings` (multipart): fields `name,email,phone?,description,notes?,halfShelves,stonewareConfirmed ('true')`, `couponCode?`, `sourceId?`, files `photos` (1–5, each `image/*`, ≤ 10MB — reuse today's caps/messages). Flow: validate presence/counts BEFORE uploading; upload photos (alt `Firing request photo from <name>`); call service; on ANY service throw → delete the just-created media ids (best-effort, today's pattern) and map the error: seat-style 409 not applicable — return 402 with `e.message` (mirrors bookings route catch); validation-shaped messages (the service's own strings) still arrive as 402 — acceptable, the form shows the message regardless.

- [ ] **Step 1: Implement route** (thin; JSON error responses `{ error }`). Multipart parsing mirrors today's `req.formData()` route including the 10MB check per file and the `num()` helper for halfShelves.
- [ ] **Step 2: Verify** tsc + eslint on the file; run Task 4's spec (unchanged, still green). Manual happy-path check happens at deploy verification with the sandbox nonce (documented in Deployment).
- [ ] **Step 3: Commit** `feat(firings): pay-up-front API route with orphan-photo cleanup`

---

### Task 6: Page, form, nav, next-firing-date

**Files:**
- Create: `src/lib/firing-date.ts` (+ unit tests in `tests/int/firing-date.int.spec.ts`)
- Rewrite: `src/app/(frontend)/firings/page.tsx` (unhide; new copy)
- Rewrite: `src/app/(frontend)/firings/FiringRequestForm.tsx` (payment form)
- Modify: `src/app/(frontend)/components/Header.tsx` + `MobileNav.tsx` (restore "Firings" between Membership and Gallery)

**Interfaces:**
- Produces `nextFiringDate(now?: Date): Date` — last Friday of `now`'s month; if that date (compared date-only) is before `now`'s date, last Friday of the following month.
  ```ts
  export function lastFridayOfMonth(year: number, monthIndex: number): Date {
    const d = new Date(year, monthIndex + 1, 0) // last day of month
    d.setDate(d.getDate() - ((d.getDay() + 2) % 7)) // back off to Friday (5)
    return d
  }
  export function nextFiringDate(now: Date = new Date()): Date {
    const candidate = lastFridayOfMonth(now.getFullYear(), now.getMonth())
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    return candidate >= today ? candidate : lastFridayOfMonth(now.getFullYear(), now.getMonth() + 1)
  }
  ```
  Tests: 2026-07-15 → 2026-07-31 (July's last Friday); 2026-07-31 → same day; 2026-08-01 → 2026-08-28; 2026-12-30 → 2027-01-29; a month whose last day IS Friday (2026-07-31 check covers).
- Page: server component, `dynamic = 'force-dynamic'`, KEEPS the `firings-page` global headline/intro/steps where present; adds hard-requirement copy blocks: stoneware-only callout, "Half shelf (11″ × 22″ × 6″) — $25 each, up to 8 per request", "Next firing: **<formatted nextFiringDate()>** — firings happen at least once a month." Renders the form with `<FiringRequestForm />`. Delete `FIRINGS_PAGE_HIDDEN` + `notFound` + unused import.
- Form (client): mirrors `BookingForm.tsx`'s SDK handling EXACTLY — same SDK load effect, card attach/destroy effect keyed on `[payments, hasIdentity]`, `busyRef` double-submit guard, coupon Apply → `POST /api/coupons/validate` with `{ code, firing: true, halfShelves, email }`, free path (`applied.finalCents === 0`) with card form kept MOUNTED and CSS-hidden (`display:none` wrapper — the orphaned-card lesson), wallets get `priceCents={effectiveCents}` + `key={effectiveCents}` and `referenceId={'firing'}` variant. Differences from BookingForm: half-shelf stepper `1–8` (select or +/- buttons) with live `effectiveLabel` total; description textarea (required), notes textarea, stoneware checkbox (required, unchecked blocks submit), photo `<input type="file" accept="image/*" multiple>` capped at 5 with client-side count/size validation and small filename list; submit builds `FormData` (photos + fields + `sourceId`/`couponCode`) → `fetch('/api/firings', { method: 'POST', body: formData })` (NO JSON content-type) → success replaces the form with a confirmation message (`role="status"`) naming the next firing date; errors render in `role="alert"`. Reapplying the coupon when `halfShelves` changes: recompute preview client-side is NOT allowed (totals come from the server) — instead clear `applied` whenever `halfShelves` changes so the customer re-applies (one-line `useEffect`).
- Nav: `<Link href="/firings">Firings</Link>` restored in both navs between Membership and Gallery.

- [ ] Steps: failing date tests → implement lib → page/form/nav → `npx tsc --noEmit` 0, eslint clean on changed files, `pnpm test:int tests/int/firing-date.int.spec.ts` green.
- [ ] **Commit** `feat(firings): public pay-up-front page, form, nav, next-firing-date`

---

### Task 7: Migration + full verification

**Files:** `src/migrations/<ts>_paid_firings.ts` (+ json), `src/migrations/index.ts`

- [ ] Throwaway dev DB on :5433 → apply existing migrations → `migrate:create paid_firings`. Confirm `up()` covers: `applies_to` enum + `firing` value; firing_requests: new columns (half_shelves, amount_cents, square_payment_id, coupon_id FK set-null, discount_cents, stoneware_confirmed), photos rels table (or `firing_requests_rels` rows for media hasMany), status enum swap (Payload typically creates a new enum + `USING` cast — on prompt choose CREATE for new columns), DROP of quoted_price_cents/square_customer_id/square_invoice_id/square_invoice_url/invoiced_at/last_invoice_error/height_in/width_in/depth_in/quantity/photo_id.
- [ ] Hand-edit `down()`: `IF EXISTS` on every DROP CONSTRAINT/INDEX; if `down()` restores NOT NULLs on dropped-then-recreated columns, precede with safe backfills (same discipline as prior migrations).
- [ ] Verify up → down → re-up clean; tear down dev DB.
- [ ] `npx tsc --noEmit` → 0; recreate `portside_test`; `pnpm test:int` → ALL green.
- [ ] **Commit** `feat(firings): migration — pay-up-front firing schema + coupon firing scope`

---

## Deployment (after all tasks)

Build with ALL THREE sandbox `NEXT_PUBLIC_*` args → ship to **portside-prod** (`docker save | ssh docker load`) → `docker compose run --rm app pnpm payload migrate` → recreate. Verify live on dev.portsidepottery.com: `/firings` renders (next-firing date correct, stoneware callout), sandbox happy path via multipart curl with `sourceId=cnon:card-nonce-ok` + a generated tiny png (then clean the test rows), declined nonce shows the friendly message, a firing-scoped coupon applies. Also ship the same image to the dev droplet (brianwells.org) and run its migration so both environments stay on one schema.

## Self-Review notes
- Spec coverage: scope+target+cross-usage (T1), collection+removals (T2), multi-photo expiry (T3), service+invariants+cross-collection tests (T4), route (T5), page/form/nav/date (T6), migration (T7). Constants file lands in T1 so the preview route compiles before the service exists.
- Reason-string consistency: new firing reason defined once in T1 and asserted verbatim in T1/T4 tests.
- The T2 route stub keeps tsc green between T2 and T5.

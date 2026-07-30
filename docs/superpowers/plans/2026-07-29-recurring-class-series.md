# Recurring Class Series Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin "Schedule a series" tool that expands a recurrence rule (weekly, biweekly, day-of-month, ordinal weekdays) into a previewed batch of ordinary published single-day class instances.

**Architecture:** A pure recurrence engine (`src/lib/recurrence.ts`) expands rules into `YYYY-MM-DD` lists; a service layer (`src/services/class-series.ts`) previews conflicts and creates instances through the normal Payload create path (so `applyClassDefaults` fills template values); thin staff-only custom endpoints on the `class-instances` collection expose it; a custom admin view provides the form → preview → create flow. Zero schema change — output rows are indistinguishable from hand-made instances.

**Tech Stack:** Payload CMS 3.85 custom endpoints/views, Next.js 16 admin components (`@payloadcms/ui`), vitest int tests.

**Spec:** `docs/superpowers/specs/2026-07-29-recurring-class-series-design.md`

## Global Constraints

- Weekday values are the codebase's RRULE codes (`'SU' | 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA'` — `WEEKDAY_CODES` in `src/lib/studio.ts`), NOT weekday names.
- Date storage convention: instance `startDate` at **studio-midnight Pacific** via `studioMidnightIso(ymd)` — never `T00:00:00Z`.
- Hard cap **52 dates per batch**, enforced in the engine (throws) and re-checked in the service.
- Generated instances: `numberOfClasses: 1`, no `daysOfWeek`, no `skipDates`, `status: 'published'`. (`computeEndDate` returns null without meeting days, so `endDate` stays unset.)
- `dayOfMonth` rules SKIP months lacking the day (no shifting). All engine math is pure `YYYY-MM-DD`/UTC-calendar arithmetic — no timezones inside the engine.
- Staff gate everywhere admin-facing: user from `users` collection with role `admin` or `editor`.
- Zero schema change: `class-instances` fields/hooks/access are untouched (only `endpoints` and an `admin.components.beforeListTable` entry are added to the collection config).
- Commit messages: conventional style, NO AI attribution/Co-Authored-By.
- Package manager `pnpm`; int tests `pnpm run test:int <file>`; local Postgres `portside_test` must be running.
- Deploy target for testing: brianwells.org dev droplet (root@206.189.255.28). Production is live — no prod deploys in this plan.

---

### Task 1: Shared studio date helpers

Move `toLocal` / `studioMidnightIso` out of `scripts/import-old-classes.ts` into `src/lib/studio.ts` so runtime code can use them.

**Files:**
- Modify: `src/lib/studio.ts` (append)
- Modify: `scripts/import-old-classes.ts` (delete local copies, import from lib)
- Test: `tests/int/studio-dates.int.spec.ts`

**Interfaces:**
- Consumes: `STUDIO_TIMEZONE` (already in `src/lib/studio.ts`)
- Produces (used by Tasks 4, and by the import script):
  - `toStudioLocal(iso: string): { date: string; time: string }`
  - `studioMidnightIso(ymd: string): string`

- [ ] **Step 1: Write the failing test**

```ts
// tests/int/studio-dates.int.spec.ts
import { describe, it, expect } from 'vitest'
import { studioMidnightIso, toStudioLocal } from '../../src/lib/studio'

describe('studioMidnightIso', () => {
  it('resolves PDT dates to 07:00Z', () => {
    expect(studioMidnightIso('2026-07-18')).toBe('2026-07-18T07:00:00.000Z')
  })
  it('resolves PST dates to 08:00Z', () => {
    expect(studioMidnightIso('2026-01-15')).toBe('2026-01-15T08:00:00.000Z')
  })
  it('round-trips through toStudioLocal', () => {
    const iso = studioMidnightIso('2026-11-01') // DST fall-back day
    expect(toStudioLocal(iso)).toEqual({ date: '2026-11-01', time: '00:00' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test:int tests/int/studio-dates.int.spec.ts`
Expected: FAIL — `studioMidnightIso` is not exported from `../../src/lib/studio`

- [ ] **Step 3: Append the helpers to `src/lib/studio.ts`**

```ts
/** Local (studio-timezone) calendar date and wall-clock time of an ISO instant. */
export function toStudioLocal(iso: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: STUDIO_TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(iso))
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` }
}

/**
 * The ISO instant of midnight in the studio timezone on the given calendar day
 * ("YYYY-MM-DD") — the house convention for storing date-only fields (07:00Z in
 * PDT, 08:00Z in PST). Tries both offsets and verifies by round-trip so DST
 * transition days can't produce a wrong-day timestamp.
 */
export function studioMidnightIso(ymd: string): string {
  for (const off of ['-07:00', '-08:00']) {
    const d = new Date(`${ymd}T00:00:00${off}`)
    const back = toStudioLocal(d.toISOString())
    if (back.date === ymd && back.time === '00:00') return d.toISOString()
  }
  throw new Error(`Could not resolve studio midnight for ${ymd}`)
}
```

- [ ] **Step 4: Point the import script at the shared helpers**

In `scripts/import-old-classes.ts`: delete its local `toLocal` and `studioMidnightIso` function definitions, add `import { studioMidnightIso, toStudioLocal } from '../src/lib/studio'`, and rename the script's `toLocal(` call sites to `toStudioLocal(`. (The script's `TZ` constant stays if other code uses it; delete it if now unused.)

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm run test:int tests/int/studio-dates.int.spec.ts && pnpm exec tsc --noEmit`
Expected: 3 tests PASS, tsc clean

- [ ] **Step 6: Commit**

```bash
git add src/lib/studio.ts scripts/import-old-classes.ts tests/int/studio-dates.int.spec.ts
git commit -m "refactor(studio): shared studio-midnight date helpers"
```

---

### Task 2: Recurrence engine

**Files:**
- Create: `src/lib/recurrence.ts`
- Test: `tests/int/recurrence.int.spec.ts`

**Interfaces:**
- Consumes: `WeekdayCode` from `src/lib/studio.ts`
- Produces (used by Tasks 4, 5):
  - `type Ordinal = 1 | 2 | 3 | 4 | 5 | 'last'`
  - `type RecurrenceRule = { kind: 'weekly'; weekday: WeekdayCode; interval: 1 | 2 } | { kind: 'dayOfMonth'; day: number } | { kind: 'ordinalWeekday'; weekday: WeekdayCode; ordinals: Ordinal[] }`
  - `MAX_SERIES_DATES = 52`
  - `expandRule(rule: RecurrenceRule, range: { from: string; until: string }): string[]` — sorted ascending `YYYY-MM-DD`, throws `Error` with a human message on invalid input or cap overflow

- [ ] **Step 1: Write the failing test**

```ts
// tests/int/recurrence.int.spec.ts
import { describe, it, expect } from 'vitest'
import { expandRule, MAX_SERIES_DATES } from '../../src/lib/recurrence'

describe('expandRule — weekly', () => {
  it('every Tuesday across a month boundary', () => {
    expect(expandRule({ kind: 'weekly', weekday: 'TU', interval: 1 }, { from: '2026-08-25', until: '2026-09-09' }))
      .toEqual(['2026-08-25', '2026-09-01', '2026-09-08'])
  })
  it('anchors on the first matching weekday ≥ from', () => {
    // 2026-08-01 is a Saturday; first Tuesday is 08-04.
    expect(expandRule({ kind: 'weekly', weekday: 'TU', interval: 1 }, { from: '2026-08-01', until: '2026-08-11' }))
      .toEqual(['2026-08-04', '2026-08-11'])
  })
  it('every other Saturday keeps a biweekly cadence', () => {
    expect(expandRule({ kind: 'weekly', weekday: 'SA', interval: 2 }, { from: '2026-08-01', until: '2026-09-30' }))
      .toEqual(['2026-08-01', '2026-08-15', '2026-08-29', '2026-09-12', '2026-09-26'])
  })
})

describe('expandRule — dayOfMonth', () => {
  it('the 1st of every month', () => {
    expect(expandRule({ kind: 'dayOfMonth', day: 1 }, { from: '2026-08-15', until: '2026-11-15' }))
      .toEqual(['2026-09-01', '2026-10-01', '2026-11-01'])
  })
  it('skips months without the day instead of shifting', () => {
    expect(expandRule({ kind: 'dayOfMonth', day: 31 }, { from: '2026-08-01', until: '2026-12-31' }))
      .toEqual(['2026-08-31', '2026-10-31', '2026-12-31']) // no Sep 31 / Nov 31
  })
  it('Feb 29 only exists in leap years', () => {
    expect(expandRule({ kind: 'dayOfMonth', day: 29 }, { from: '2027-02-01', until: '2027-03-01' })).toEqual([])
    expect(expandRule({ kind: 'dayOfMonth', day: 29 }, { from: '2028-02-01', until: '2028-03-01' }))
      .toEqual(['2028-02-29'])
  })
})

describe('expandRule — ordinalWeekday', () => {
  it('1st & 3rd Tuesday', () => {
    expect(expandRule({ kind: 'ordinalWeekday', weekday: 'TU', ordinals: [1, 3] }, { from: '2026-08-01', until: '2026-09-30' }))
      .toEqual(['2026-08-04', '2026-08-18', '2026-09-01', '2026-09-15'])
  })
  it('5th weekday only lands in months that have one', () => {
    // Sep 2026 has five Tuesdays (1, 8, 15, 22, 29); Aug 2026 has only four.
    expect(expandRule({ kind: 'ordinalWeekday', weekday: 'TU', ordinals: [5] }, { from: '2026-08-01', until: '2026-09-30' }))
      .toEqual(['2026-09-29'])
  })
  it('last Tuesday works in 4- and 5-Tuesday months', () => {
    expect(expandRule({ kind: 'ordinalWeekday', weekday: 'TU', ordinals: ['last'] }, { from: '2026-08-01', until: '2026-09-30' }))
      .toEqual(['2026-08-25', '2026-09-29'])
  })
  it('dedupes when 5th and last coincide', () => {
    expect(expandRule({ kind: 'ordinalWeekday', weekday: 'TU', ordinals: [5, 'last'] }, { from: '2026-09-01', until: '2026-09-30' }))
      .toEqual(['2026-09-29'])
  })
})

describe('expandRule — validation and bounds', () => {
  it('from and until are inclusive', () => {
    expect(expandRule({ kind: 'weekly', weekday: 'TU', interval: 1 }, { from: '2026-09-01', until: '2026-09-01' }))
      .toEqual(['2026-09-01'])
  })
  it('rejects until before from', () => {
    expect(() => expandRule({ kind: 'weekly', weekday: 'TU', interval: 1 }, { from: '2026-09-02', until: '2026-09-01' }))
      .toThrow(/until/i)
  })
  it('rejects invalid calendar dates', () => {
    expect(() => expandRule({ kind: 'weekly', weekday: 'TU', interval: 1 }, { from: '2026-02-30', until: '2026-03-30' }))
      .toThrow(/date/i)
  })
  it('rejects day-of-month outside 1–31 and empty ordinals', () => {
    expect(() => expandRule({ kind: 'dayOfMonth', day: 0 }, { from: '2026-01-01', until: '2026-02-01' })).toThrow()
    expect(() => expandRule({ kind: 'dayOfMonth', day: 32 }, { from: '2026-01-01', until: '2026-02-01' })).toThrow()
    expect(() => expandRule({ kind: 'ordinalWeekday', weekday: 'TU', ordinals: [] }, { from: '2026-01-01', until: '2026-02-01' })).toThrow()
  })
  it(`caps a batch at ${MAX_SERIES_DATES} dates`, () => {
    expect(() => expandRule({ kind: 'weekly', weekday: 'TU', interval: 1 }, { from: '2026-01-01', until: '2027-12-31' }))
      .toThrow(/52/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test:int tests/int/recurrence.int.spec.ts`
Expected: FAIL — cannot find module `../../src/lib/recurrence`

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/recurrence.ts
import type { WeekdayCode } from './studio'

/**
 * Pure recurrence expansion for the class-series generator. All math is plain
 * calendar arithmetic on "YYYY-MM-DD" strings (backed by UTC Date objects used
 * only as day counters) — no timezones, so DST can never shift a date.
 */

export type Ordinal = 1 | 2 | 3 | 4 | 5 | 'last'

export type RecurrenceRule =
  | { kind: 'weekly'; weekday: WeekdayCode; interval: 1 | 2 }
  | { kind: 'dayOfMonth'; day: number }
  | { kind: 'ordinalWeekday'; weekday: WeekdayCode; ordinals: Ordinal[] }

/** Footgun guard: the largest batch one generator run may produce. */
export const MAX_SERIES_DATES = 52

const WEEKDAY_INDEX: Record<WeekdayCode, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 }

function parseYmd(ymd: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) throw new Error(`Invalid date "${ymd}" — use YYYY-MM-DD.`)
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  if (formatYmd(d) !== ymd) throw new Error(`"${ymd}" is not a real calendar date.`)
  return d
}

function formatYmd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function addDays(d: Date, n: number): Date {
  const next = new Date(d)
  next.setUTCDate(next.getUTCDate() + n)
  return next
}

/** All dates of `weekday` within the given month (0-based), ascending. */
function weekdaysInMonth(year: number, month: number, weekday: WeekdayCode): Date[] {
  const out: Date[] = []
  for (let d = new Date(Date.UTC(year, month, 1)); d.getUTCMonth() === month; d = addDays(d, 1)) {
    if (d.getUTCDay() === WEEKDAY_INDEX[weekday]) out.push(d)
  }
  return out
}

export function expandRule(rule: RecurrenceRule, range: { from: string; until: string }): string[] {
  const from = parseYmd(range.from)
  const until = parseYmd(range.until)
  if (until < from) throw new Error('The until date is before the from date.')

  const picked = new Set<string>()
  const push = (d: Date) => {
    if (d < from || d > until) return
    picked.add(formatYmd(d))
    if (picked.size > MAX_SERIES_DATES) {
      throw new Error(`That range makes more than ${MAX_SERIES_DATES} classes — shorten the range or split it into batches.`)
    }
  }

  if (rule.kind === 'weekly') {
    if (rule.interval !== 1 && rule.interval !== 2) throw new Error('Weekly cadence must be every week or every other week.')
    if (!(rule.weekday in WEEKDAY_INDEX)) throw new Error('Unknown weekday.')
    let d = from
    while (d.getUTCDay() !== WEEKDAY_INDEX[rule.weekday]) d = addDays(d, 1)
    for (; d <= until; d = addDays(d, 7 * rule.interval)) push(d)
  } else if (rule.kind === 'dayOfMonth') {
    if (!Number.isInteger(rule.day) || rule.day < 1 || rule.day > 31) {
      throw new Error('Day of month must be between 1 and 31.')
    }
    for (let y = from.getUTCFullYear(), m = from.getUTCMonth(); ; ) {
      const candidate = new Date(Date.UTC(y, m, rule.day))
      // Months without the day roll over (Feb 31 → Mar 3): skip those months.
      if (candidate.getUTCMonth() === m) push(candidate)
      if (y === until.getUTCFullYear() && m === until.getUTCMonth()) break
      m += 1
      if (m === 12) { m = 0; y += 1 }
    }
  } else if (rule.kind === 'ordinalWeekday') {
    if (!(rule.weekday in WEEKDAY_INDEX)) throw new Error('Unknown weekday.')
    if (!rule.ordinals.length) throw new Error('Pick at least one occurrence (1st–5th or last).')
    for (const o of rule.ordinals) {
      if (o !== 'last' && (!Number.isInteger(o) || o < 1 || o > 5)) throw new Error('Occurrences must be 1st–5th or last.')
    }
    for (let y = from.getUTCFullYear(), m = from.getUTCMonth(); ; ) {
      const days = weekdaysInMonth(y, m, rule.weekday)
      for (const o of rule.ordinals) {
        const d = o === 'last' ? days[days.length - 1] : days[o - 1]
        if (d) push(d)
      }
      if (y === until.getUTCFullYear() && m === until.getUTCMonth()) break
      m += 1
      if (m === 12) { m = 0; y += 1 }
    }
  } else {
    throw new Error('Unknown recurrence rule.')
  }

  return [...picked].sort()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run test:int tests/int/recurrence.int.spec.ts`
Expected: PASS (14 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/recurrence.ts tests/int/recurrence.int.spec.ts
git commit -m "feat(series): pure recurrence engine with 52-date cap"
```

---

### Task 3: Extract the shared staff-request gate

`isStaff` is currently copy-pasted in `src/endpoints/newsletters.ts` and `src/endpoints/newsletter-subscribers.ts` (flagged in the newsletter final review as "extract on next touch" — this is the next touch; Task 4 would be a third copy).

**Files:**
- Create: `src/lib/staff-request.ts`
- Modify: `src/endpoints/newsletters.ts` (delete local `isStaff`, import shared)
- Modify: `src/endpoints/newsletter-subscribers.ts` (same)

**Interfaces:**
- Produces (used by Task 4 and both newsletter endpoint files):
  - `isStaffRequest(req: PayloadRequest): boolean`

- [ ] **Step 1: Write the shared helper**

```ts
// src/lib/staff-request.ts
import type { PayloadRequest } from 'payload'

/** True when the request is authenticated as an admin or editor from the
 *  users collection — the gate for every custom staff-only endpoint. */
export function isStaffRequest(req: PayloadRequest): boolean {
  const user = req.user
  return Boolean(
    user && user.collection === 'users' && user.roles?.some((r: string) => r === 'admin' || r === 'editor'),
  )
}
```

- [ ] **Step 2: Refactor both endpoint files**

In `src/endpoints/newsletters.ts` and `src/endpoints/newsletter-subscribers.ts`: delete the local `isStaff` function, add `import { isStaffRequest } from '../lib/staff-request'`, and replace `isStaff(req)` call sites with `isStaffRequest(req)`.

- [ ] **Step 3: Verify nothing broke**

Run: `pnpm exec tsc --noEmit && pnpm run test:int tests/int/newsletter-send.int.spec.ts tests/int/newsletters-collection.int.spec.ts`
Expected: tsc clean, 10 tests PASS (endpoint gating itself is exercised manually; these prove the modules still load and the send flow is intact)

- [ ] **Step 4: Commit**

```bash
git add src/lib/staff-request.ts src/endpoints/newsletters.ts src/endpoints/newsletter-subscribers.ts
git commit -m "refactor(endpoints): shared isStaffRequest gate"
```

---

### Task 4: Series service + endpoints

**Files:**
- Create: `src/services/class-series.ts`
- Create: `src/endpoints/class-series.ts`
- Modify: `src/collections/ClassInstances.ts` (attach `endpoints`)
- Test: `tests/int/class-series.int.spec.ts`

**Interfaces:**
- Consumes: `expandRule`, `MAX_SERIES_DATES`, `RecurrenceRule` (Task 2); `studioMidnightIso` (Task 1); `isStaffRequest` (Task 3)
- Produces:
  - `previewSeries(payload: Payload, input: { classId: number; rule: RecurrenceRule; from: string; until: string }): Promise<{ ok: true; classTitle: string; dates: { date: string; conflict: boolean }[] } | { ok: false; status: 400 | 404; error: string }>`
  - `createSeries(payload: Payload, input: { classId: number; instructorId: number; dates: string[]; startTime: string; endTime: string; label?: string; capacity?: number; priceCents?: number; location?: string }): Promise<{ ok: true; created: number; skipped: { date: string; reason: string }[] } | { ok: false; status: 400 | 404; error: string }>`
  - HTTP (staff-only): `POST /api/class-instances/series-preview`, `POST /api/class-instances/series-create`

- [ ] **Step 1: Write the failing test**

```ts
// tests/int/class-series.int.spec.ts
import { describe, it, expect, beforeAll } from 'vitest'
import type { Payload } from 'payload'
import { getTestPayload } from './helpers'
import { previewSeries, createSeries } from '../../src/services/class-series'

let payload: Payload
let classId: number
let instructorId: number

beforeAll(async () => {
  payload = await getTestPayload()
  const unique = `series-${Date.now()}`
  const instructor = await payload.create({
    collection: 'users',
    overrideAccess: true,
    data: { email: `${unique}@test.local`, password: 'test-password-1', roles: ['instructor'], name: 'Series Teacher' },
  })
  instructorId = instructor.id as number
  const cls = await payload.create({
    collection: 'classes',
    overrideAccess: true,
    data: { title: `Wheel Basics ${unique}`, defaultPriceCents: 5500, defaultCapacity: 8, defaultNumberOfClasses: 4 },
  })
  classId = cls.id as number
})

const RULE = { kind: 'ordinalWeekday', weekday: 'TU', ordinals: [1, 3] } as const

describe('previewSeries', () => {
  it('expands the rule and flags no conflicts on a clean slate', async () => {
    const res = await previewSeries(payload, { classId, rule: RULE, from: '2027-01-01', until: '2027-02-28' })
    expect(res).toMatchObject({ ok: true })
    if (!res.ok) return
    expect(res.dates.map((d) => d.date)).toEqual(['2027-01-05', '2027-01-19', '2027-02-02', '2027-02-16'])
    expect(res.dates.every((d) => !d.conflict)).toBe(true)
  })

  it('404s an unknown class and 400s a bad rule', async () => {
    expect(await previewSeries(payload, { classId: 999999, rule: RULE, from: '2027-01-01', until: '2027-01-31' }))
      .toMatchObject({ ok: false, status: 404 })
    expect(await previewSeries(payload, { classId, rule: { kind: 'dayOfMonth', day: 40 }, from: '2027-01-01', until: '2027-01-31' }))
      .toMatchObject({ ok: false, status: 400 })
  })
})

describe('createSeries', () => {
  it('creates published single-day instances with class defaults and studio-midnight dates', async () => {
    const res = await createSeries(payload, {
      classId, instructorId,
      dates: ['2027-03-02', '2027-03-16'],
      startTime: '18:00', endTime: '20:00',
    })
    expect(res).toMatchObject({ ok: true, created: 2, skipped: [] })

    const { docs } = await payload.find({
      collection: 'class-instances',
      where: { and: [{ class: { equals: classId } }, { startDate: { greater_than: '2027-03-01' } }, { startDate: { less_than: '2027-03-20' } }] },
      overrideAccess: true, sort: 'startDate', limit: 10,
    })
    expect(docs).toHaveLength(2)
    const first = docs[0]
    expect(first.startDate).toBe('2027-03-02T08:00:00.000Z') // PST studio midnight
    expect(first.status).toBe('published')
    expect(first.numberOfClasses).toBe(1)
    expect(first.endDate ?? null).toBeNull()
    expect(first.daysOfWeek ?? []).toHaveLength(0)
    expect(first.priceCents).toBe(5500) // class default via applyClassDefaults
    expect(first.capacity).toBe(8)
    expect(first.label).toContain('Wheel Basics') // label defaulted from class title
  })

  it('skips dates that already have a non-cancelled instance of the same class', async () => {
    const res = await createSeries(payload, {
      classId, instructorId, dates: ['2027-03-02', '2027-03-30'], startTime: '18:00', endTime: '20:00',
    })
    expect(res).toMatchObject({ ok: true, created: 1 })
    if (!res.ok) return
    expect(res.skipped).toEqual([{ date: '2027-03-02', reason: 'already scheduled' }])
  })

  it('a cancelled instance does not block the date', async () => {
    const cancelled = await payload.create({
      collection: 'class-instances', overrideAccess: true,
      data: { class: classId, instructor: instructorId, startDate: '2027-04-06T07:00:00.000Z', startTime: '18:00', endTime: '20:00', numberOfClasses: 1, status: 'cancelled' },
    })
    expect(cancelled.status).toBe('cancelled')
    const res = await createSeries(payload, {
      classId, instructorId, dates: ['2027-04-06'], startTime: '18:00', endTime: '20:00',
    })
    expect(res).toMatchObject({ ok: true, created: 1, skipped: [] })
  })

  it('validates inputs', async () => {
    expect(await createSeries(payload, { classId, instructorId, dates: [], startTime: '18:00', endTime: '20:00' }))
      .toMatchObject({ ok: false, status: 400 })
    expect(await createSeries(payload, { classId, instructorId, dates: ['2027-05-04'], startTime: '25:00', endTime: '20:00' }))
      .toMatchObject({ ok: false, status: 400 })
    expect(await createSeries(payload, { classId, instructorId, dates: ['not-a-date'], startTime: '18:00', endTime: '20:00' }))
      .toMatchObject({ ok: false, status: 400 })
    expect(await createSeries(payload, { classId: 999999, instructorId, dates: ['2027-05-04'], startTime: '18:00', endTime: '20:00' }))
      .toMatchObject({ ok: false, status: 404 })
    const tooMany = Array.from({ length: 53 }, (_, i) => `2027-06-${String((i % 28) + 1).padStart(2, '0')}`)
    expect(await createSeries(payload, { classId, instructorId, dates: tooMany, startTime: '18:00', endTime: '20:00' }))
      .toMatchObject({ ok: false, status: 400 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test:int tests/int/class-series.int.spec.ts`
Expected: FAIL — cannot find module `../../src/services/class-series`

NOTE: if the `users` create in `beforeAll` fails on required fields, open `src/collections/Users.ts` and match its required fields (e.g. `name`) — adjust the fixture, not the service.

- [ ] **Step 3: Write the service**

```ts
// src/services/class-series.ts
import type { Payload } from 'payload'
import { expandRule, MAX_SERIES_DATES, type RecurrenceRule } from '../lib/recurrence'
import { studioMidnightIso } from '../lib/studio'

/**
 * The class-series generator: expands a recurrence rule to dates (preview) and
 * stamps out ordinary published single-day class instances (create). Payload
 * hooks still run on each create, so class-template defaults apply exactly as
 * they do for hand-made instances.
 */

const YMD = /^\d{4}-\d{2}-\d{2}$/
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

export interface SeriesPreviewInput {
  classId: number
  rule: RecurrenceRule
  from: string
  until: string
}
export type SeriesPreviewResult =
  | { ok: true; classTitle: string; dates: { date: string; conflict: boolean }[] }
  | { ok: false; status: 400 | 404; error: string }

export interface SeriesCreateInput {
  classId: number
  instructorId: number
  dates: string[]
  startTime: string
  endTime: string
  label?: string
  capacity?: number
  priceCents?: number
  location?: string
}
export type SeriesCreateResult =
  | { ok: true; created: number; skipped: { date: string; reason: string }[] }
  | { ok: false; status: 400 | 404; error: string }

/** True when a non-cancelled instance of this class already starts that day. */
async function hasConflict(payload: Payload, classId: number, startDateIso: string): Promise<boolean> {
  const { totalDocs } = await payload.count({
    collection: 'class-instances',
    where: {
      and: [
        { class: { equals: classId } },
        { startDate: { equals: startDateIso } },
        { status: { not_equals: 'cancelled' } },
      ],
    },
    overrideAccess: true,
  })
  return totalDocs > 0
}

export async function previewSeries(payload: Payload, input: SeriesPreviewInput): Promise<SeriesPreviewResult> {
  const cls = await payload.findByID({ collection: 'classes', id: input.classId, depth: 0 }).catch(() => null)
  if (!cls) return { ok: false, status: 404, error: 'Class not found.' }

  let dates: string[]
  try {
    dates = expandRule(input.rule, { from: input.from, until: input.until })
  } catch (e) {
    return { ok: false, status: 400, error: e instanceof Error ? e.message : 'Invalid recurrence rule.' }
  }

  const out: { date: string; conflict: boolean }[] = []
  for (const date of dates) {
    out.push({ date, conflict: await hasConflict(payload, input.classId, studioMidnightIso(date)) })
  }
  return { ok: true, classTitle: cls.title, dates: out }
}

export async function createSeries(payload: Payload, input: SeriesCreateInput): Promise<SeriesCreateResult> {
  if (!Array.isArray(input.dates) || input.dates.length === 0) {
    return { ok: false, status: 400, error: 'Pick at least one date.' }
  }
  if (input.dates.length > MAX_SERIES_DATES) {
    return { ok: false, status: 400, error: `A batch is capped at ${MAX_SERIES_DATES} classes.` }
  }
  if (input.dates.some((d) => !YMD.test(d))) return { ok: false, status: 400, error: 'Dates must be YYYY-MM-DD.' }
  if (!HHMM.test(input.startTime) || !HHMM.test(input.endTime)) {
    return { ok: false, status: 400, error: 'Times must be 24-hour HH:MM, e.g. 18:00.' }
  }

  const cls = await payload.findByID({ collection: 'classes', id: input.classId, depth: 0 }).catch(() => null)
  if (!cls) return { ok: false, status: 404, error: 'Class not found.' }
  const instructor = await payload.findByID({ collection: 'users', id: input.instructorId, depth: 0 }).catch(() => null)
  if (!instructor) return { ok: false, status: 404, error: 'Instructor not found.' }

  let created = 0
  const skipped: { date: string; reason: string }[] = []
  for (const date of [...input.dates].sort()) {
    const startDate = studioMidnightIso(date)
    try {
      // Re-check conflicts at create time so double-submits and stale previews
      // stay idempotent per (class, date).
      if (await hasConflict(payload, input.classId, startDate)) {
        skipped.push({ date, reason: 'already scheduled' })
        continue
      }
      await payload.create({
        collection: 'class-instances',
        overrideAccess: true,
        data: {
          class: input.classId,
          instructor: input.instructorId,
          ...(input.label ? { label: input.label } : {}),
          startDate,
          startTime: input.startTime,
          endTime: input.endTime,
          // Explicit single session: stops applyClassDefaults from inheriting a
          // multi-week default and computing an end date.
          numberOfClasses: 1,
          ...(input.capacity != null ? { capacity: input.capacity } : {}),
          ...(input.priceCents != null ? { priceCents: input.priceCents } : {}),
          ...(input.location ? { location: input.location } : {}),
          status: 'published',
        },
      })
      created++
    } catch (e) {
      // Per-date fault isolation: one bad date never sinks the batch.
      payload.logger.error(`Series create failed for ${date}: ${e instanceof Error ? e.message : e}`)
      skipped.push({ date, reason: e instanceof Error ? e.message : 'create failed' })
    }
  }
  return { ok: true, created, skipped }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run test:int tests/int/class-series.int.spec.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Write the endpoints and attach them**

```ts
// src/endpoints/class-series.ts
import type { Endpoint } from 'payload'
import { isStaffRequest } from '../lib/staff-request'
import { previewSeries, createSeries } from '../services/class-series'
import type { RecurrenceRule } from '../lib/recurrence'

/** Staff-only generator endpoints, mounted under /api/class-instances. */
export const classSeriesEndpoints: Endpoint[] = [
  {
    path: '/series-preview',
    method: 'post',
    handler: async (req) => {
      if (!isStaffRequest(req)) return Response.json({ error: 'Forbidden' }, { status: 403 })
      const body = req.json ? await req.json().catch(() => null) : null
      if (!body) return Response.json({ error: 'Invalid JSON' }, { status: 400 })
      const result = await previewSeries(req.payload, {
        classId: Number(body.classId),
        rule: body.rule as RecurrenceRule,
        from: String(body.from ?? ''),
        until: String(body.until ?? ''),
      })
      if (result.ok) return Response.json(result)
      return Response.json({ error: result.error }, { status: result.status })
    },
  },
  {
    path: '/series-create',
    method: 'post',
    handler: async (req) => {
      if (!isStaffRequest(req)) return Response.json({ error: 'Forbidden' }, { status: 403 })
      const body = req.json ? await req.json().catch(() => null) : null
      if (!body) return Response.json({ error: 'Invalid JSON' }, { status: 400 })
      const result = await createSeries(req.payload, {
        classId: Number(body.classId),
        instructorId: Number(body.instructorId),
        dates: Array.isArray(body.dates) ? body.dates.map(String) : [],
        startTime: String(body.startTime ?? ''),
        endTime: String(body.endTime ?? ''),
        label: body.label ? String(body.label) : undefined,
        capacity: body.capacity != null ? Number(body.capacity) : undefined,
        priceCents: body.priceCents != null ? Number(body.priceCents) : undefined,
        location: body.location ? String(body.location) : undefined,
      })
      if (result.ok) return Response.json(result)
      return Response.json({ error: result.error }, { status: result.status })
    },
  },
]
```

In `src/collections/ClassInstances.ts`: add `import { classSeriesEndpoints } from '../endpoints/class-series'` and, at the top level of the config object (next to `hooks`):

```ts
  endpoints: classSeriesEndpoints,
```

- [ ] **Step 6: Full verification**

Run: `pnpm exec tsc --noEmit && pnpm run test:int tests/int/class-series.int.spec.ts tests/int/class-instances.int.spec.ts tests/int/instructor-access.int.spec.ts`
Expected: tsc clean; series tests + existing class-instance suites all PASS (proves attaching endpoints broke nothing)

- [ ] **Step 7: Commit**

```bash
git add src/services/class-series.ts src/endpoints/class-series.ts src/collections/ClassInstances.ts tests/int/class-series.int.spec.ts
git commit -m "feat(series): preview/create service and staff endpoints"
```

---

### Task 5: Admin UI — Schedule a series

**Files:**
- Create: `src/admin/ScheduleSeriesButton.tsx`
- Create: `src/admin/views/ScheduleSeries.tsx`
- Create: `src/admin/views/ScheduleSeriesForm.tsx`
- Modify: `src/collections/ClassInstances.ts` (`admin.components.beforeListTable`)
- Modify: `src/payload.config.ts` (`admin.components.views` entry)
- Modify: `src/app/(payload)/admin/importMap.js` (regenerated)

**Interfaces:**
- Consumes: `POST /api/class-instances/series-preview` and `/series-create` (Task 4); REST `GET /api/classes?limit=200&depth=0` and `GET /api/users?limit=200&depth=0` (admin cookie auth, same-origin)
- Produces: admin view at `/admin/schedule-series`; button above the Class Instances list

- [ ] **Step 1: Write the list-view button**

```tsx
// src/admin/ScheduleSeriesButton.tsx
'use client'

import { Button } from '@payloadcms/ui'

/** Entry point to the series generator, shown above the Class Instances list. */
export default function ScheduleSeriesButton() {
  return (
    <div style={{ marginBottom: 12 }}>
      <Button el="link" to="/admin/schedule-series" buttonStyle="secondary" size="small">
        Schedule a series…
      </Button>
    </div>
  )
}
```

(If `Button` doesn't accept `el="link"`/`to` at 3.85 — check how it's typed in `node_modules/@payloadcms/ui` — fall back to wrapping `<Button>` in a Next `<Link href="/admin/schedule-series">`; report which variant was used.)

- [ ] **Step 2: Write the server view**

```tsx
// src/admin/views/ScheduleSeries.tsx
import type { AdminViewServerProps } from 'payload'
import { DefaultTemplate } from '@payloadcms/next/templates'
import { Gutter } from '@payloadcms/ui'
import { redirect } from 'next/navigation'

import { ScheduleSeriesForm } from './ScheduleSeriesForm'

export default async function ScheduleSeries({ initPageResult, params, searchParams }: AdminViewServerProps) {
  const { req, permissions, visibleEntities, locale } = initPageResult
  const { user, payload } = req
  const staff = user && user.collection === 'users' && user.roles?.some((r) => r === 'admin' || r === 'editor')
  if (!staff) redirect('/admin')

  return (
    <DefaultTemplate
      i18n={req.i18n}
      locale={locale}
      params={params}
      payload={payload}
      permissions={permissions}
      searchParams={searchParams}
      user={user}
      visibleEntities={visibleEntities}
    >
      <Gutter>
        <h1 style={{ marginBottom: 8 }}>Schedule a series</h1>
        <p style={{ color: 'var(--theme-elevation-500)', marginBottom: 20, maxWidth: 640 }}>
          Create a batch of single-day classes from a repeating pattern. Preview the exact dates, uncheck any you
          don&apos;t want, and the rest are published immediately as normal class instances.
        </p>
        <ScheduleSeriesForm />
      </Gutter>
    </DefaultTemplate>
  )
}
```

- [ ] **Step 3: Write the client form**

```tsx
// src/admin/views/ScheduleSeriesForm.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button, toast } from '@payloadcms/ui'

type Option = { id: number; label: string }
type PreviewDate = { date: string; conflict: boolean; checked: boolean }

const WEEKDAYS = [
  { value: 'SU', label: 'Sunday' }, { value: 'MO', label: 'Monday' }, { value: 'TU', label: 'Tuesday' },
  { value: 'WE', label: 'Wednesday' }, { value: 'TH', label: 'Thursday' }, { value: 'FR', label: 'Friday' },
  { value: 'SA', label: 'Saturday' },
]
const ORDINALS: { value: string; label: string }[] = [
  { value: '1', label: '1st' }, { value: '2', label: '2nd' }, { value: '3', label: '3rd' },
  { value: '4', label: '4th' }, { value: '5', label: '5th' }, { value: 'last', label: 'last' },
]

const inputStyle: React.CSSProperties = {
  padding: '8px 10px',
  border: '1px solid var(--theme-elevation-150)',
  borderRadius: 4,
  background: 'var(--theme-input-bg)',
  color: 'var(--theme-text)',
}
const rowStyle: React.CSSProperties = { display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }
const labelStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }

function todayYmd(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
}

function prettyDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  })
}

export function ScheduleSeriesForm() {
  const [classes, setClasses] = useState<Option[]>([])
  const [instructors, setInstructors] = useState<Option[]>([])
  const [classId, setClassId] = useState('')
  const [instructorId, setInstructorId] = useState('')
  const [startTime, setStartTime] = useState('18:00')
  const [endTime, setEndTime] = useState('20:00')
  const [label, setLabel] = useState('')
  const [capacity, setCapacity] = useState('')
  const [price, setPrice] = useState('')

  const [repeats, setRepeats] = useState<'weekly' | 'biweekly' | 'monthly'>('weekly')
  const [weekday, setWeekday] = useState('TU')
  const [monthlyMode, setMonthlyMode] = useState<'ordinal' | 'day'>('ordinal')
  const [dayOfMonth, setDayOfMonth] = useState('1')
  const [ordinals, setOrdinals] = useState<string[]>(['1'])

  const [from, setFrom] = useState(todayYmd())
  const [until, setUntil] = useState('')

  const [preview, setPreview] = useState<PreviewDate[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ created: number; skipped: { date: string; reason: string }[] } | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const [clsRes, usersRes] = await Promise.all([
          fetch('/api/classes?limit=200&depth=0&sort=title', { credentials: 'include' }),
          fetch('/api/users?limit=200&depth=0&sort=name', { credentials: 'include' }),
        ])
        if (clsRes.ok) {
          const data = await clsRes.json()
          setClasses(data.docs.map((c: { id: number; title: string }) => ({ id: c.id, label: c.title })))
        }
        if (usersRes.ok) {
          const data = await usersRes.json()
          setInstructors(
            data.docs.map((u: { id: number; name?: string; email: string }) => ({ id: u.id, label: u.name || u.email })),
          )
        }
      } catch {
        toast.error("Couldn't load classes — refresh and try again.")
      }
    })()
  }, [])

  const rule = useMemo(() => {
    if (repeats === 'weekly' || repeats === 'biweekly') {
      return { kind: 'weekly', weekday, interval: repeats === 'weekly' ? 1 : 2 }
    }
    if (monthlyMode === 'day') return { kind: 'dayOfMonth', day: Number(dayOfMonth) }
    return { kind: 'ordinalWeekday', weekday, ordinals: ordinals.map((o) => (o === 'last' ? 'last' : Number(o))) }
  }, [repeats, weekday, monthlyMode, dayOfMonth, ordinals])

  // Any input change invalidates the current preview — the create button only
  // ever acts on dates the admin has just seen.
  const previewKey = JSON.stringify({ classId, rule, from, until })
  useEffect(() => {
    setPreview(null)
    setDone(null)
  }, [previewKey])

  const runPreview = async () => {
    if (!classId) return toast.error('Pick a class first.')
    if (!until) return toast.error('Pick an until date.')
    setBusy(true)
    try {
      const res = await fetch('/api/class-instances/series-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classId: Number(classId), rule, from, until }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Preview failed.')
      if (data.dates.length === 0) {
        toast.error('That pattern makes no dates in the range.')
        setPreview(null)
      } else {
        setPreview(data.dates.map((d: { date: string; conflict: boolean }) => ({ ...d, checked: !d.conflict })))
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Preview failed.')
    }
    setBusy(false)
  }

  const runCreate = async () => {
    if (!preview) return
    if (!instructorId) return toast.error('Pick an instructor.')
    const dates = preview.filter((d) => d.checked).map((d) => d.date)
    if (dates.length === 0) return toast.error('No dates are checked.')
    if (!window.confirm(`Create and publish ${dates.length} class${dates.length === 1 ? '' : 'es'}?`)) return
    setBusy(true)
    try {
      const res = await fetch('/api/class-instances/series-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          classId: Number(classId),
          instructorId: Number(instructorId),
          dates,
          startTime,
          endTime,
          ...(label ? { label } : {}),
          ...(capacity !== '' ? { capacity: Number(capacity) } : {}),
          ...(price !== '' ? { priceCents: Math.round(Number(price) * 100) } : {}),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Create failed.')
      setDone(data)
      setPreview(null)
      toast.success(`Created ${data.created} class${data.created === 1 ? '' : 'es'}.`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Create failed.')
    }
    setBusy(false)
  }

  const toggle = (date: string) =>
    setPreview((p) => (p ? p.map((d) => (d.date === date ? { ...d, checked: !d.checked } : d)) : p))

  const checkedCount = preview?.filter((d) => d.checked).length ?? 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 720 }}>
      <div style={rowStyle}>
        <label style={labelStyle}>
          Class
          <select style={inputStyle} value={classId} onChange={(e) => setClassId(e.target.value)}>
            <option value="">Choose…</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </label>
        <label style={labelStyle}>
          Instructor
          <select style={inputStyle} value={instructorId} onChange={(e) => setInstructorId(e.target.value)}>
            <option value="">Choose…</option>
            {instructors.map((u) => (
              <option key={u.id} value={u.id}>{u.label}</option>
            ))}
          </select>
        </label>
        <label style={labelStyle}>
          Title override (optional)
          <input style={inputStyle} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Defaults to the class name" />
        </label>
      </div>

      <div style={rowStyle}>
        <label style={labelStyle}>
          Starts
          <input style={inputStyle} value={startTime} onChange={(e) => setStartTime(e.target.value)} placeholder="18:00" />
        </label>
        <label style={labelStyle}>
          Ends
          <input style={inputStyle} value={endTime} onChange={(e) => setEndTime(e.target.value)} placeholder="20:00" />
        </label>
        <label style={labelStyle}>
          Capacity (optional)
          <input style={{ ...inputStyle, width: 90 }} type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="default" />
        </label>
        <label style={labelStyle}>
          Price $ (optional)
          <input style={{ ...inputStyle, width: 90 }} type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="default" />
        </label>
      </div>

      <div style={rowStyle}>
        <label style={labelStyle}>
          Repeats
          <select style={inputStyle} value={repeats} onChange={(e) => setRepeats(e.target.value as typeof repeats)}>
            <option value="weekly">Every week</option>
            <option value="biweekly">Every other week</option>
            <option value="monthly">Monthly</option>
          </select>
        </label>

        {repeats === 'monthly' && (
          <label style={labelStyle}>
            On
            <select style={inputStyle} value={monthlyMode} onChange={(e) => setMonthlyMode(e.target.value as typeof monthlyMode)}>
              <option value="ordinal">a chosen weekday (e.g. 2nd Tuesday)</option>
              <option value="day">a day of the month (e.g. the 1st)</option>
            </select>
          </label>
        )}

        {(repeats !== 'monthly' || monthlyMode === 'ordinal') && (
          <label style={labelStyle}>
            Weekday
            <select style={inputStyle} value={weekday} onChange={(e) => setWeekday(e.target.value)}>
              {WEEKDAYS.map((w) => (
                <option key={w.value} value={w.value}>{w.label}</option>
              ))}
            </select>
          </label>
        )}

        {repeats === 'monthly' && monthlyMode === 'ordinal' && (
          <div style={{ ...labelStyle, flexDirection: 'column' }}>
            Occurrences
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {ORDINALS.map((o) => (
                <label key={o.value} style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={ordinals.includes(o.value)}
                    onChange={(e) =>
                      setOrdinals((prev) => (e.target.checked ? [...prev, o.value] : prev.filter((x) => x !== o.value)))
                    }
                  />
                  {o.label}
                </label>
              ))}
            </div>
          </div>
        )}

        {repeats === 'monthly' && monthlyMode === 'day' && (
          <label style={labelStyle}>
            Day of month
            <input style={{ ...inputStyle, width: 80 }} type="number" min={1} max={31} value={dayOfMonth} onChange={(e) => setDayOfMonth(e.target.value)} />
          </label>
        )}
      </div>

      <div style={rowStyle}>
        <label style={labelStyle}>
          From
          <input style={inputStyle} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label style={labelStyle}>
          Until
          <input style={inputStyle} type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
        </label>
        <div style={{ alignSelf: 'flex-end' }}>
          <Button size="small" buttonStyle="secondary" onClick={runPreview} disabled={busy}>
            Preview dates
          </Button>
        </div>
      </div>

      {preview && (
        <div>
          <table style={{ borderCollapse: 'collapse' }}>
            <tbody>
              {preview.map((d) => (
                <tr key={d.date}>
                  <td style={{ padding: '6px 10px 6px 0' }}>
                    <input type="checkbox" checked={d.checked} onChange={() => toggle(d.date)} />
                  </td>
                  <td style={{ padding: '6px 12px 6px 0', fontSize: 14 }}>{prettyDate(d.date)}</td>
                  <td style={{ padding: '6px 0', fontSize: 13, color: 'var(--theme-warning-600, #9a6700)' }}>
                    {d.conflict ? 'already scheduled — left unchecked' : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop: 12 }}>
            <Button size="small" onClick={runCreate} disabled={busy || checkedCount === 0}>
              Create {checkedCount} class{checkedCount === 1 ? '' : 'es'}
            </Button>
          </div>
        </div>
      )}

      {done && (
        <p role="status" style={{ fontSize: 14 }}>
          Created {done.created} class{done.created === 1 ? '' : 'es'}
          {done.skipped.length > 0 && <> · skipped {done.skipped.map((s) => `${s.date} (${s.reason})`).join(', ')}</>}
          {' — '}
          <a href="/admin/collections/class-instances">back to Class Instances</a>
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Register everything**

In `src/collections/ClassInstances.ts`, inside `admin`:

```ts
    components: { beforeListTable: ['/admin/ScheduleSeriesButton#default'] },
```

In `src/payload.config.ts`, add to `admin.components.views`:

```ts
        scheduleSeries: { Component: '/admin/views/ScheduleSeries#default', path: '/schedule-series', exact: true },
```

- [ ] **Step 5: Regenerate import map, typecheck, lint**

Run: `pnpm run generate:importmap && pnpm exec tsc --noEmit && pnpm run lint`
Expected: importMap.js gains `/admin/ScheduleSeriesButton#default` and `/admin/views/ScheduleSeries#default`; tsc clean; lint has only the known pre-existing `src/admin/PriceField.tsx` error.

- [ ] **Step 6: Manual smoke (local dev)**

`pnpm run dev` → `/admin` → Class Instances shows the "Schedule a series…" button → the view loads → pick a class, "Monthly / 1st & 3rd Tuesday", until ~2 months out → Preview shows the right dates → Create → instances appear in the list, published, with class-default price/capacity. Re-run the same pattern → all dates arrive flagged "already scheduled".

- [ ] **Step 7: Commit**

```bash
git add src/admin/ScheduleSeriesButton.tsx src/admin/views/ScheduleSeries.tsx src/admin/views/ScheduleSeriesForm.tsx src/collections/ClassInstances.ts src/payload.config.ts "src/app/(payload)/admin/importMap.js"
git commit -m "feat(series): schedule-a-series admin view and list button"
```

---

### Task 6: Full suite + dev deploy + E2E

**Files:** none new (verification and deploy)

- [ ] **Step 1: Full verification suite**

```bash
pnpm run test:int && pnpm exec tsc --noEmit && pnpm run lint && pnpm run build
```

Expected: all green (lint: only the pre-existing PriceField error). No migration exists for this feature — confirm `git status` shows no `src/migrations` changes.

- [ ] **Step 2: Deploy to the dev droplet** (build serially — concurrent builds deadlock the builder; run each command to completion)

```bash
docker build --platform linux/amd64 --build-arg NEXT_PUBLIC_SQUARE_ENVIRONMENT=sandbox --build-arg NEXT_PUBLIC_SQUARE_APP_ID=sandbox-sq0idb-BxeQOCwSZKHugBsZoIUXZA --build-arg NEXT_PUBLIC_SQUARE_LOCATION_ID=LMDEFJRFBWN3E -t portside:test .
docker save portside:test | gzip -1 | ssh root@206.189.255.28 'gunzip | docker load'
ssh root@206.189.255.28 'cd /opt/portside && docker compose up -d --force-recreate app && docker image prune -f >/dev/null'
```

Expected: app recreates clean (`docker compose logs app | tail -20` error-free). No migrate step needed.

- [ ] **Step 3: E2E checklist on https://brianwells.org** (Brian + Claude)

- [ ] "Schedule a series…" button on Class Instances; view gated (instructor-only account redirected)
- [ ] Weekly pattern preview shows correct dates; biweekly cadence holds
- [ ] "1st & 3rd Tuesday" through 2 months → 4 dates; create → published instances with class defaults
- [ ] Generated classes appear on the public schedule + class pages; booking one works end-to-end (sandbox card)
- [ ] Re-running the same pattern flags every date as already scheduled; unchecking dates excludes them
- [ ] Cancelling one generated instance doesn't affect siblings; delete-guard still blocks a booked one

- [ ] **Step 4: Push**

```bash
git push
```

Prod rollout happens with the next prod deploy (no migration; feature is purely additive).

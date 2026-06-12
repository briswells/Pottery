# Class / Class Instance Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the single `classes` collection into a reusable **Class** template and schedulable **Class Instances** that people sign up for, attach an `.ics` calendar file to booking confirmation emails, and give instructors a scoped admin view of their instances and rosters.

**Architecture:** A `classes` collection holds the definition (title, default price/capacity, description, image). A new `class-instances` collection holds each scheduled run (dates, days-of-week + times as a recurrence rule, instructor, per-instance price/capacity/image/location overrides, status). `bookings` re-point from `class` to `classInstance`. Occupancy, the booking service, and the public pages key off instances. ICS files are generated in-process with the `ics` npm package (floating local times in the studio's fixed Pacific timezone) and sent as a Resend attachment. Instructor scoping is pure Payload access control plus a `join` field for the roster.

**Tech Stack:** Next.js 16, Payload 3.85 (postgres/drizzle, `push` in dev), React 19, Square Web Payments, Resend, `ics`, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-12-class-instances-redesign-design.md`

**Pre-launch:** No production class/booking data — schema can be rebuilt. The test DB (`portside_test`) is dropped/recreated to avoid drizzle's interactive rename prompts; the dev DB is recreated and re-seeded.

---

## File Structure

**New files**
- `src/lib/studio.ts` — studio constants (timezone, default location, day-of-week options)
- `src/lib/schedule.ts` — pure date/recurrence helpers (parse times, expand sessions, month grid, human summary)
- `src/lib/ics.ts` — build an iCalendar string for an instance via the `ics` package
- `src/collections/ClassInstances.ts` — the new scheduled-run collection
- `src/hooks/applyClassDefaults.ts` — fills instance price/capacity/label from its class
- `src/app/(frontend)/classes/[slug]/signup/[instanceId]/page.tsx` — per-instance booking page
- `src/app/(frontend)/schedule/page.tsx` — month calendar of upcoming sessions
- Tests: `tests/int/schedule.int.spec.ts`, `tests/int/ics.int.spec.ts`, `tests/int/class-instances.int.spec.ts`, `tests/int/instructor-access.int.spec.ts`

**Modified files**
- `src/collections/Classes.ts` — drop run fields; rename price/capacity to `default*`
- `src/collections/Bookings.ts` — `class` → `classInstance`
- `src/collections/Users.ts` — add `instructor` role
- `src/lib/occupancy.ts` — count per instance
- `src/lib/email.ts` — optional `attachments`
- `src/lib/payload-email-adapter.ts` — pass attachments through to Resend
- `src/services/booking.ts` — instance-based; attach ICS
- `src/app/api/bookings/route.ts` — accept `classInstanceId`
- `src/payload.config.ts` — register `ClassInstances`
- `src/app/(frontend)/classes/page.tsx` — list classes + next-available date
- `src/app/(frontend)/classes/[slug]/page.tsx` — list a class's instances
- `src/app/(frontend)/classes/[slug]/BookingForm.tsx` — `classInstanceId` prop
- `src/seed/seed.ts` — seed a class + instance
- Tests: `tests/int/occupancy.int.spec.ts`, `tests/int/booking-service.int.spec.ts`, `tests/int/payload-email-adapter.int.spec.ts`

**Test command:** `pnpm run test:int -- <file>` runs one suite; `pnpm run test:int` runs all.

---

## Task 1: Studio constants & schedule helpers (pure)

**Files:**
- Create: `src/lib/studio.ts`
- Create: `src/lib/schedule.ts`
- Test: `tests/int/schedule.int.spec.ts`

- [ ] **Step 1: Write `src/lib/studio.ts`** (no test needed — plain constants)

```ts
/** The studio operates in a single fixed timezone; class times are local wall-clock. */
export const STUDIO_TIMEZONE = 'America/Los_Angeles'

/** Default event location used when an instance has no explicit location. */
export const STUDIO_LOCATION = process.env.STUDIO_ADDRESS || 'Portside Pottery'

/** Day-of-week options for scheduling. Values are RRULE BYDAY codes (Sunday-first). */
export const DAYS_OF_WEEK = [
  { label: 'Sunday', value: 'SU' },
  { label: 'Monday', value: 'MO' },
  { label: 'Tuesday', value: 'TU' },
  { label: 'Wednesday', value: 'WE' },
  { label: 'Thursday', value: 'TH' },
  { label: 'Friday', value: 'FR' },
  { label: 'Saturday', value: 'SA' },
] as const

export const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const
export type WeekdayCode = (typeof WEEKDAY_CODES)[number]
```

- [ ] **Step 2: Write the failing test** `tests/int/schedule.int.spec.ts`

```ts
import { describe, it, expect } from 'vitest'
import { parseHHMM, dateParts, expandSessions, monthGrid, scheduleSummary } from '../../src/lib/schedule'

describe('parseHHMM', () => {
  it('parses 24-hour times', () => {
    expect(parseHHMM('18:00')).toEqual([18, 0])
    expect(parseHHMM('09:30')).toEqual([9, 30])
  })
  it('throws on malformed input', () => {
    expect(() => parseHHMM('25:00')).toThrow()
    expect(() => parseHHMM('6pm')).toThrow()
  })
})

describe('dateParts', () => {
  it('extracts y/m/d from a UTC-midnight date-only ISO', () => {
    expect(dateParts('2026-07-03T00:00:00.000Z')).toEqual([2026, 7, 3])
  })
})

describe('expandSessions', () => {
  const range = (a: string, b: string) => [new Date(a), new Date(b)] as const

  it('returns a single session when there is no endDate', () => {
    const [s, e] = range('2026-07-01', '2026-07-31')
    expect(
      expandSessions({ startDate: '2026-07-04T00:00:00.000Z' }, s, e),
    ).toEqual(['2026-07-04'])
  })

  it('expands weekly Tue/Fri occurrences within the range', () => {
    const [s, e] = range('2026-07-01', '2026-07-15')
    // Jul 2026: 7th=Tue, 10th=Fri, 14th=Tue
    const out = expandSessions(
      {
        startDate: '2026-07-07T00:00:00.000Z',
        endDate: '2026-07-15T00:00:00.000Z',
        daysOfWeek: ['TU', 'FR'],
      },
      s,
      e,
    )
    expect(out).toEqual(['2026-07-07', '2026-07-10', '2026-07-14'])
  })

  it('excludes skipDates', () => {
    const [s, e] = range('2026-07-01', '2026-07-15')
    const out = expandSessions(
      {
        startDate: '2026-07-07T00:00:00.000Z',
        endDate: '2026-07-15T00:00:00.000Z',
        daysOfWeek: ['TU', 'FR'],
        skipDates: [{ date: '2026-07-10T00:00:00.000Z' }],
      },
      s,
      e,
    )
    expect(out).toEqual(['2026-07-07', '2026-07-14'])
  })

  it('clips occurrences to the requested range', () => {
    const [s, e] = range('2026-07-08', '2026-07-12')
    const out = expandSessions(
      {
        startDate: '2026-07-07T00:00:00.000Z',
        endDate: '2026-07-31T00:00:00.000Z',
        daysOfWeek: ['TU', 'FR'],
      },
      s,
      e,
    )
    expect(out).toEqual(['2026-07-10']) // only the Fri inside 8th–12th
  })
})

describe('monthGrid', () => {
  it('returns 6 weeks of 7 days, Sunday-first, padded with adjacent months', () => {
    const grid = monthGrid(2026, 7) // July 2026; 1st is a Wednesday
    expect(grid).toHaveLength(6)
    expect(grid[0]).toHaveLength(7)
    expect(grid[0][0]).toBe('2026-06-28') // Sunday before Jul 1
    expect(grid[0][3]).toBe('2026-07-01')
  })
})

describe('scheduleSummary', () => {
  it('summarizes a recurring course', () => {
    const s = scheduleSummary({
      startDate: '2026-07-07T00:00:00.000Z',
      endDate: '2026-08-11T00:00:00.000Z',
      daysOfWeek: ['TU', 'FR'],
      startTime: '18:00',
      endTime: '20:00',
    })
    expect(s).toContain('Tue')
    expect(s).toContain('Fri')
    expect(s).toContain('6:00')
    expect(s).toContain('8:00')
  })
  it('summarizes a single-day workshop', () => {
    const s = scheduleSummary({
      startDate: '2026-07-04T00:00:00.000Z',
      startTime: '10:00',
      endTime: '14:00',
    })
    expect(s).toContain('Jul')
    expect(s).toContain('10:00')
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm run test:int -- schedule`
Expected: FAIL — `schedule` module not found / functions undefined.

- [ ] **Step 4: Write `src/lib/schedule.ts`**

```ts
import { WEEKDAY_CODES, type WeekdayCode } from './studio'

const DAY_LABELS: Record<WeekdayCode, string> = {
  SU: 'Sun', MO: 'Mon', TU: 'Tue', WE: 'Wed', TH: 'Thu', FR: 'Fri', SA: 'Sat',
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Parse "HH:MM" (24-hour) into [hours, minutes]. Throws on malformed input. */
export function parseHHMM(value: string): [number, number] {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value ?? '')
  if (!m) throw new Error(`Invalid time "${value}" (expected HH:MM)`)
  return [Number(m[1]), Number(m[2])]
}

/** Format "HH:MM" (24h) as a 12-hour clock string, e.g. "18:00" -> "6:00 PM". */
export function formatTime(value: string): string {
  const [h, m] = parseHHMM(value)
  const period = h < 12 ? 'AM' : 'PM'
  const hour12 = h % 12 === 0 ? 12 : h % 12
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`
}

/** Extract [year, month, day] from a date-only ISO string (stored at UTC midnight). */
export function dateParts(iso: string): [number, number, number] {
  const d = new Date(iso)
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()]
}

/** Format a date-only ISO string as e.g. "Jul 4, 2026". */
export function formatDate(iso: string): string {
  const [y, m, d] = dateParts(iso)
  return `${MONTHS[m - 1]} ${d}, ${y}`
}

const ymd = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`

export interface SessionScheduleInput {
  startDate: string
  endDate?: string | null
  daysOfWeek?: (string | WeekdayCode)[] | null
  skipDates?: { date: string }[] | null
}

/**
 * Expand a schedule into the session dates ("YYYY-MM-DD") within [rangeStart, rangeEnd]
 * inclusive. No endDate (or no daysOfWeek) ⇒ a single session on startDate. Otherwise each
 * day from startDate..endDate whose weekday is in daysOfWeek, excluding skipDates.
 */
export function expandSessions(
  input: SessionScheduleInput,
  rangeStart: Date,
  rangeEnd: Date,
): string[] {
  const start = new Date(input.startDate)
  const days = input.daysOfWeek ?? []
  const out: string[] = []

  if (!input.endDate || days.length === 0) {
    if (start.getTime() >= rangeStart.getTime() && start.getTime() <= rangeEnd.getTime()) {
      out.push(ymd(start))
    }
    return out
  }

  const skip = new Set((input.skipDates ?? []).map((s) => ymd(new Date(s.date))))
  const end = new Date(input.endDate)
  const cursor = new Date(Math.max(start.getTime(), rangeStart.getTime()))
  cursor.setUTCHours(0, 0, 0, 0)
  const stop = Math.min(end.getTime(), rangeEnd.getTime())
  while (cursor.getTime() <= stop) {
    const code = WEEKDAY_CODES[cursor.getUTCDay()]
    const key = ymd(cursor)
    if (days.includes(code) && !skip.has(key)) out.push(key)
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return out
}

/** A fixed 6×7 month grid of "YYYY-MM-DD" strings, weeks starting Sunday. month is 1-based. */
export function monthGrid(year: number, month: number): string[][] {
  const first = new Date(Date.UTC(year, month - 1, 1))
  const cursor = new Date(first)
  cursor.setUTCDate(1 - first.getUTCDay())
  const weeks: string[][] = []
  for (let w = 0; w < 6; w++) {
    const week: string[] = []
    for (let d = 0; d < 7; d++) {
      week.push(ymd(cursor))
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    }
    weeks.push(week)
  }
  return weeks
}

/** Human-readable schedule, e.g. "Tue, Fri · 6:00 PM–8:00 PM · Jul 7, 2026 – Aug 11, 2026". */
export function scheduleSummary(input: {
  startDate: string
  endDate?: string | null
  daysOfWeek?: string[] | null
  startTime?: string | null
  endTime?: string | null
}): string {
  const parts: string[] = []
  const days = input.daysOfWeek ?? []
  if (input.endDate && days.length > 0) {
    parts.push(days.map((d) => DAY_LABELS[d as WeekdayCode] ?? d).join(', '))
  }
  if (input.startTime && input.endTime) {
    parts.push(`${formatTime(input.startTime)}–${formatTime(input.endTime)}`)
  }
  if (input.endDate && days.length > 0) {
    parts.push(`${formatDate(input.startDate)} – ${formatDate(input.endDate)}`)
  } else {
    parts.push(formatDate(input.startDate))
  }
  return parts.join(' · ')
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm run test:int -- schedule`
Expected: PASS (all cases green).

- [ ] **Step 6: Commit**

```bash
git add src/lib/studio.ts src/lib/schedule.ts tests/int/schedule.int.spec.ts
git commit -m "Add studio constants and pure schedule/recurrence helpers"
```

---

## Task 2: ICS builder (pure)

**Files:**
- Create: `src/lib/ics.ts`
- Test: `tests/int/ics.int.spec.ts`

- [ ] **Step 1: Install the `ics` package**

Run: `pnpm add ics`
Expected: `ics` added to dependencies.

- [ ] **Step 2: Write the failing test** `tests/int/ics.int.spec.ts`

```ts
import { describe, it, expect } from 'vitest'
import { buildClassIcs } from '../../src/lib/ics'

const base = {
  id: 42,
  startDate: '2026-07-07T00:00:00.000Z',
  startTime: '18:00',
  endTime: '20:00',
  location: 'Studio A',
}

describe('buildClassIcs', () => {
  it('builds a single-session event with no RRULE', () => {
    const ics = buildClassIcs(base, '6-Week Wheel Throwing')
    expect(ics).toContain('BEGIN:VEVENT')
    expect(ics).toContain('SUMMARY:6-Week Wheel Throwing')
    expect(ics).toContain('LOCATION:Studio A')
    expect(ics).toContain('UID:class-instance-42@portsidepottery')
    // floating local time (no trailing Z) at 18:00
    expect(ics).toMatch(/DTSTART:20260707T180000(?!Z)/)
    expect(ics).not.toContain('RRULE')
  })

  it('builds a weekly recurring event with BYDAY, UNTIL and EXDATE', () => {
    const ics = buildClassIcs(
      {
        ...base,
        endDate: '2026-08-11T00:00:00.000Z',
        daysOfWeek: ['TU', 'FR'],
        skipDates: [{ date: '2026-07-10T00:00:00.000Z' }],
      },
      'Wheel Series',
    )
    expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=TU,FR;UNTIL=20260811T235959Z')
    expect(ics).toContain('EXDATE')
    expect(ics).toContain('20260710')
  })

  it('falls back to the studio location when none is provided', () => {
    const { location, ...noLoc } = base
    const ics = buildClassIcs(noLoc, 'Raku Day')
    expect(ics).toContain('LOCATION:Portside Pottery')
  })

  it('throws when the end time is not after the start time', () => {
    expect(() => buildClassIcs({ ...base, endTime: '18:00' }, 'Bad')).toThrow()
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm run test:int -- ics`
Expected: FAIL — `buildClassIcs` not found.

- [ ] **Step 4: Write `src/lib/ics.ts`**

```ts
import { createEvent, type EventAttributes } from 'ics'
import { parseHHMM, dateParts } from './schedule'
import { STUDIO_LOCATION } from './studio'

export interface IcsInstance {
  id: number | string
  startDate: string
  endDate?: string | null
  startTime: string
  endTime: string
  daysOfWeek?: string[] | null
  skipDates?: { date: string }[] | null
  location?: string | null
}

/** Build a VCALENDAR/VEVENT string for a class instance. Throws on invalid input. */
export function buildClassIcs(instance: IcsInstance, className: string): string {
  const [y, mo, d] = dateParts(instance.startDate)
  const [sh, sm] = parseHHMM(instance.startTime)
  const [eh, em] = parseHHMM(instance.endTime)
  const durationMin = eh * 60 + em - (sh * 60 + sm)
  if (durationMin <= 0) throw new Error('Class end time must be after the start time')

  const attrs: EventAttributes = {
    uid: `class-instance-${instance.id}@portsidepottery`,
    productId: 'portside-pottery/ics',
    title: className,
    location: instance.location || STUDIO_LOCATION,
    start: [y, mo, d, sh, sm],
    startInputType: 'local',
    startOutputType: 'local',
    duration: { hours: Math.floor(durationMin / 60), minutes: durationMin % 60 },
  }

  const days = instance.daysOfWeek ?? []
  if (instance.endDate && days.length > 0) {
    const [ey, em2, ed] = dateParts(instance.endDate)
    const until = `${ey}${String(em2).padStart(2, '0')}${String(ed).padStart(2, '0')}T235959Z`
    attrs.recurrenceRule = `FREQ=WEEKLY;BYDAY=${days.join(',')};UNTIL=${until}`
    const skips = instance.skipDates ?? []
    if (skips.length > 0) {
      attrs.exclusionDates = skips.map((s) => {
        const [ky, km, kd] = dateParts(s.date)
        return [ky, km, kd, sh, sm] as [number, number, number, number, number]
      })
    }
  }

  const { error, value } = createEvent(attrs)
  if (error || !value) throw new Error(`ICS generation failed: ${error?.message ?? 'unknown error'}`)
  return value
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm run test:int -- ics`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ics.ts tests/int/ics.int.spec.ts package.json pnpm-lock.yaml
git commit -m "Add ICS calendar builder for class instances"
```

---

## Task 3: Email attachment support

**Files:**
- Modify: `src/lib/email.ts`
- Modify: `src/lib/payload-email-adapter.ts`
- Test: `tests/int/payload-email-adapter.int.spec.ts:1-44` (add cases)

- [ ] **Step 1: Add a failing test** to `tests/int/payload-email-adapter.int.spec.ts` (inside the `describe('resendEmailAdapter.sendEmail', ...)` block, after the existing cases)

```ts
  it('passes attachments through to Resend', async () => {
    await adapter().sendEmail({
      to: 'a@x.com',
      subject: 's',
      html: 'h',
      attachments: [{ filename: 'class.ics', content: 'BEGIN:VCALENDAR' }],
    } as any)
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [{ filename: 'class.ics', content: 'BEGIN:VCALENDAR' }],
      }),
    )
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm run test:int -- payload-email-adapter`
Expected: FAIL — `attachments` not present on the mapped payload.

- [ ] **Step 3: Add attachment mapping to the adapter** in `src/lib/payload-email-adapter.ts`

In `sendEmail`, after the `replyTo` line, add:

```ts
      const attachments = Array.isArray(message.attachments)
        ? message.attachments.map((a) => ({
            filename: String((a as { filename?: string }).filename ?? 'attachment'),
            content: (a as { content?: string | Buffer }).content as string | Buffer,
          }))
        : undefined
```

Then add `...(attachments ? { attachments } : {})` to the `payload` object literal (alongside the existing `...(replyTo ? { replyTo } : {})`).

- [ ] **Step 4: Add `attachments` to the app-level email helper** in `src/lib/email.ts`

Replace the `EmailInput` interface and `sendEmail` body:

```ts
export interface EmailAttachment {
  filename: string
  content: string | Buffer
}

export interface EmailInput {
  to: string
  subject: string
  html: string
  attachments?: EmailAttachment[]
}
```

```ts
export async function sendEmail({ to, subject, html, attachments }: EmailInput): Promise<void> {
  // Resend resolves with { data, error } instead of throwing on API errors,
  // so surface a failure explicitly rather than reporting a false success.
  const { error } = await getResend().emails.send({
    from: process.env.EMAIL_FROM!,
    to,
    subject,
    html,
    ...(attachments ? { attachments } : {}),
  })
  if (error) throw new Error(`Email send failed: ${error.message}`)
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm run test:int -- payload-email-adapter`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/email.ts src/lib/payload-email-adapter.ts tests/int/payload-email-adapter.int.spec.ts
git commit -m "Support optional email attachments via Resend"
```

---

## Task 4: Collections & booking server refactor

This is the structural core: it splits `classes`, adds `class-instances`, re-points `bookings`, adds the `instructor` role, refactors occupancy + the booking service, and updates the API route. Because the column renames ripple across server code, these land together. **Frontend pages still reference old fields after this task — they are fixed in Tasks 5–6; the integration suite is the gate here, not `next build`.**

**Files:**
- Modify: `src/collections/Classes.ts`
- Create: `src/collections/ClassInstances.ts`
- Create: `src/hooks/applyClassDefaults.ts`
- Modify: `src/collections/Bookings.ts`
- Modify: `src/collections/Users.ts`
- Modify: `src/payload.config.ts`
- Modify: `src/lib/occupancy.ts`
- Modify: `src/services/booking.ts`
- Modify: `src/app/api/bookings/route.ts`
- Test: `tests/int/class-instances.int.spec.ts` (new), `tests/int/instructor-access.int.spec.ts` (new), `tests/int/occupancy.int.spec.ts` (rewrite), `tests/int/booking-service.int.spec.ts` (rewrite)

### 4a. Schema

- [ ] **Step 1: Rewrite `src/collections/Classes.ts`** (drop run fields; rename price/capacity)

```ts
import type { CollectionConfig } from 'payload'
import { anyone } from '../access/anyone'
import { isAdminOrEditor } from '../access/isAdminOrEditor'
import { slugifyFromTitle } from '../hooks/slugify'

export const Classes: CollectionConfig = {
  slug: 'classes',
  admin: { useAsTitle: 'title', group: 'Studio', defaultColumns: ['title', 'category', 'status'] },
  access: {
    read: anyone,
    create: isAdminOrEditor,
    update: isAdminOrEditor,
    delete: isAdminOrEditor,
  },
  fields: [
    { name: 'title', type: 'text', required: true },
    {
      name: 'slug', type: 'text', unique: true, index: true,
      admin: { position: 'sidebar', description: 'Auto-filled from title; edit to override' },
      hooks: { beforeValidate: [slugifyFromTitle] },
    },
    {
      name: 'category', type: 'select', required: true,
      options: [
        { label: 'Wheel-throwing series', value: 'wheel-series' },
        { label: 'Day camp', value: 'day-camp' },
        { label: 'Raku', value: 'raku' },
        { label: 'Daytime multi-week', value: 'daytime-multiweek' },
      ],
    },
    { name: 'skillLevel', type: 'text' },
    { name: 'description', type: 'textarea' },
    { name: 'image', type: 'upload', relationTo: 'media', admin: { description: 'Title image; default for all instances' } },
    {
      name: 'defaultPriceCents',
      type: 'number',
      required: true,
      min: 0,
      label: 'Default price',
      admin: {
        description: 'Price in dollars, e.g. 220 for $220.00. Instances inherit this unless overridden.',
        components: {
          Field: '/admin/PriceField#PriceField',
          Cell: '/admin/PriceCell#PriceCell',
        },
      },
    },
    { name: 'defaultCapacity', type: 'number', required: true, min: 1, admin: { description: 'Instances inherit this unless overridden.' } },
    {
      name: 'status', type: 'select', defaultValue: 'active',
      options: [{ label: 'Active', value: 'active' }, { label: 'Archived', value: 'archived' }],
      admin: { position: 'sidebar' },
    },
  ],
}
```

- [ ] **Step 2: Write `src/hooks/applyClassDefaults.ts`**

```ts
import type { CollectionBeforeValidateHook } from 'payload'

/**
 * Fills a class-instance's priceCents / capacity from its parent class when left
 * blank, and maintains a human-readable `label` (class title + start date) for the
 * admin list and relationship dropdowns.
 */
export const applyClassDefaults: CollectionBeforeValidateHook = async ({ data, req }) => {
  if (!data) return data
  const classId = typeof data.class === 'object' && data.class ? data.class.id : data.class
  if (!classId) return data
  const cls = await req.payload.findByID({ collection: 'classes', id: classId, depth: 0 })
  if (data.priceCents == null) data.priceCents = cls.defaultPriceCents
  if (data.capacity == null) data.capacity = cls.defaultCapacity
  const dateLabel = data.startDate
    ? new Date(data.startDate).toISOString().slice(0, 10)
    : 'unscheduled'
  data.label = `${cls.title} — ${dateLabel}`
  return data
}
```

- [ ] **Step 3: Write `src/collections/ClassInstances.ts`**

```ts
import type { CollectionConfig, Access } from 'payload'
import { isAdminOrEditor } from '../access/isAdminOrEditor'
import { DAYS_OF_WEEK } from '../lib/studio'
import { applyClassDefaults } from '../hooks/applyClassDefaults'

const timeValidate = (val: unknown) =>
  (typeof val === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(val)) ||
  'Use 24-hour HH:MM, e.g. 18:00'

/**
 * Read access: admins/editors see everything; an instructor sees only their own
 * instances (so the admin list IS their class list); the public sees published only.
 */
const readAccess: Access = ({ req: { user } }) => {
  if (user && user.collection === 'users') {
    if (user.roles?.some((r) => r === 'admin' || r === 'editor')) return true
    if (user.roles?.includes('instructor')) return { instructor: { equals: user.id } }
  }
  return { status: { equals: 'published' } }
}

export const ClassInstances: CollectionConfig = {
  slug: 'class-instances',
  admin: {
    useAsTitle: 'label',
    group: 'Studio',
    defaultColumns: ['label', 'instructor', 'startDate', 'endDate', 'status'],
  },
  access: {
    read: readAccess,
    create: isAdminOrEditor,
    update: isAdminOrEditor,
    delete: isAdminOrEditor,
  },
  hooks: { beforeValidate: [applyClassDefaults] },
  fields: [
    { name: 'class', type: 'relationship', relationTo: 'classes', required: true },
    {
      name: 'label', type: 'text',
      admin: { readOnly: true, position: 'sidebar', description: 'Auto-filled from class + start date' },
    },
    { name: 'instructor', type: 'relationship', relationTo: 'users', required: true },
    { name: 'startDate', type: 'date', required: true, admin: { date: { pickerAppearance: 'dayOnly' }, description: 'First (or only) meeting date' } },
    { name: 'endDate', type: 'date', admin: { date: { pickerAppearance: 'dayOnly' }, description: 'Last meeting date. Leave blank for a single-day class.' } },
    {
      name: 'daysOfWeek', type: 'select', hasMany: true, options: [...DAYS_OF_WEEK],
      admin: { description: 'Which days the class meets (multi-week courses).' },
    },
    { name: 'startTime', type: 'text', required: true, validate: timeValidate, admin: { description: '24-hour HH:MM, e.g. 18:00' } },
    { name: 'endTime', type: 'text', required: true, validate: timeValidate, admin: { description: '24-hour HH:MM, e.g. 20:00' } },
    {
      name: 'skipDates', type: 'array',
      labels: { singular: 'Skip date', plural: 'Skip dates' },
      fields: [{ name: 'date', type: 'date', required: true, admin: { date: { pickerAppearance: 'dayOnly' } } }],
      admin: { description: 'Dates to exclude (e.g. holidays).' },
    },
    { name: 'capacity', type: 'number', min: 1, admin: { description: 'Defaults from the class if left blank.' } },
    {
      name: 'priceCents', type: 'number', min: 0, label: 'Price',
      admin: {
        description: 'Defaults from the class if left blank. Price in dollars.',
        components: { Field: '/admin/PriceField#PriceField', Cell: '/admin/PriceCell#PriceCell' },
      },
    },
    { name: 'image', type: 'upload', relationTo: 'media', admin: { description: 'Optional; falls back to the class image.' } },
    { name: 'location', type: 'text', admin: { description: 'Optional; falls back to the studio address.' } },
    {
      name: 'status', type: 'select', defaultValue: 'draft',
      options: [
        { label: 'Draft', value: 'draft' },
        { label: 'Published', value: 'published' },
        { label: 'Cancelled', value: 'cancelled' },
        { label: 'Completed', value: 'completed' },
      ],
      admin: { position: 'sidebar', description: 'Only Published instances appear on the website.' },
    },
    {
      name: 'roster', type: 'join', collection: 'bookings', on: 'classInstance',
      admin: { defaultColumns: ['customerName', 'customerEmail', 'status'], description: 'Everyone enrolled in this instance.' },
    },
  ],
}
```

- [ ] **Step 4: Re-point `src/collections/Bookings.ts`** — change the `class` field and `defaultColumns`

Replace line 6 (`admin: {...}`):

```ts
  admin: { group: 'Commerce', useAsTitle: 'customerEmail', defaultColumns: ['customerName', 'classInstance', 'status', 'amountCents'] },
```

Replace line 14 (the `class` relationship field):

```ts
    { name: 'classInstance', type: 'relationship', relationTo: 'class-instances', required: true },
```

- [ ] **Step 5: Add the `instructor` role** in `src/collections/Users.ts` — extend the `roles` options (after the `Editor` option):

```ts
        { label: 'Instructor', value: 'instructor' },
```

- [ ] **Step 6: Register the collection** in `src/payload.config.ts`

Add the import after the `Classes` import (line 13):

```ts
import { ClassInstances } from './collections/ClassInstances'
```

Update the `collections` array (line 61) to insert `ClassInstances` after `Classes`:

```ts
  collections: [Users, People, MembershipPlans, Media, Classes, ClassInstances, Bookings, Payments, FiringRequests],
```

### 4b. Refactor occupancy & booking to be instance-based

- [ ] **Step 7: Rewrite `src/lib/occupancy.ts`** (count per instance)

```ts
import type { Payload } from 'payload'

/** Raw number of seats held by active (paid or pending) bookings on an instance. */
export async function occupiedSeats(payload: Payload, classInstanceId: number | string): Promise<number> {
  const { totalDocs } = await payload.count({
    collection: 'bookings',
    where: { and: [{ classInstance: { equals: classInstanceId } }, { status: { in: ['paid', 'pending'] } }] },
  })
  return totalDocs
}

export async function seatsRemaining(payload: Payload, classInstanceId: number | string): Promise<number> {
  const inst = await payload.findByID({ collection: 'class-instances', id: classInstanceId })
  const occupied = await occupiedSeats(payload, classInstanceId)
  return Math.max(0, (inst.capacity ?? 0) - occupied)
}
```

- [ ] **Step 8: Rewrite `src/services/booking.ts`** to book an instance and attach an ICS

```ts
import type { Payload } from 'payload'
import { seatsRemaining, occupiedSeats } from '../lib/occupancy'
import type { ChargeInput, ChargeResult } from '../lib/payments'
import type { EmailInput } from '../lib/email'
import { usd } from '../lib/format'
import { scheduleSummary } from '../lib/schedule'
import { buildClassIcs } from '../lib/ics'
import { upsertPersonByEmail } from './people'

export interface BookingDeps {
  payload: Payload
  charge: (input: ChargeInput) => Promise<ChargeResult>
  sendEmail: (input: EmailInput) => Promise<void>
}

export interface BookingInput {
  classInstanceId: number | string
  sourceId: string
  customerName: string
  customerEmail: string
  customerPhone?: string
}

export async function createPaidBooking(deps: BookingDeps, input: BookingInput) {
  const { payload } = deps
  const inst = await payload.findByID({ collection: 'class-instances', id: input.classInstanceId, depth: 1 })
  if (!inst || inst.status !== 'published') throw new Error('This class is not available for booking')
  const cls = typeof inst.class === 'object' && inst.class
    ? inst.class
    : await payload.findByID({ collection: 'classes', id: inst.class as number | string })

  // Reserve a seat by creating a pending booking, then re-check occupancy.
  const remaining = await seatsRemaining(payload, inst.id)
  if (remaining <= 0) throw new Error('This class is full')

  const pending = await payload.create({
    collection: 'bookings',
    overrideAccess: true,
    data: {
      classInstance: inst.id, customerName: input.customerName, customerEmail: input.customerEmail,
      customerPhone: input.customerPhone, amountCents: inst.priceCents, status: 'pending',
    },
  })

  // Re-check AFTER reserving to catch a concurrent reservation; if reserving
  // pushed us over capacity, roll this booking back rather than oversell.
  if (await occupiedSeats(payload, inst.id) > (inst.capacity ?? 0)) {
    await payload.update({ collection: 'bookings', id: pending.id, overrideAccess: true, data: { status: 'cancelled' } })
    throw new Error('This class is full')
  }

  let charge: ChargeResult
  try {
    charge = await deps.charge({
      sourceId: input.sourceId, amountCents: inst.priceCents,
      referenceId: `booking-${pending.id}`, note: `Class: ${cls.title}`,
    })
  } catch (e) {
    await payload.update({ collection: 'bookings', id: pending.id, overrideAccess: true, data: { status: 'cancelled' } })
    throw e
  }

  const booking = await payload.update({
    collection: 'bookings', id: pending.id, overrideAccess: true,
    data: { status: 'paid', squarePaymentId: charge.paymentId },
  })

  await payload.create({
    collection: 'payments', overrideAccess: true,
    data: { type: 'booking', booking: pending.id, amountCents: inst.priceCents, squareId: charge.paymentId, status: charge.status, paidAt: new Date().toISOString() },
  })

  // Link the booking to a Person (find-or-create by email). A failure here must
  // not fail the already-paid booking — log and move on; the backfill can link later.
  try {
    const person = await upsertPersonByEmail(
      { payload },
      { name: input.customerName, email: input.customerEmail, phone: input.customerPhone },
    )
    await payload.update({ collection: 'bookings', id: booking.id, overrideAccess: true, data: { person: person.id } })
  } catch (e) {
    console.error(`Booking ${booking.id} person link failed:`, e)
  }

  // The booking is already paid and recorded at this point. A failed confirmation
  // email (or ICS generation) must NOT fail the request, so swallow+log errors.
  try {
    const summary = scheduleSummary(inst)
    const ics = buildClassIcs(inst, cls.title)
    await deps.sendEmail({
      to: input.customerEmail,
      subject: `You're booked: ${cls.title}`,
      html: `<p>Thanks, ${input.customerName}! You're registered for <strong>${cls.title}</strong> (${summary}).</p><p>Amount paid: ${usd(inst.priceCents)}.</p><p>A calendar invite is attached.</p>`,
      attachments: [{ filename: 'class.ics', content: Buffer.from(ics) }],
    })
  } catch (e) {
    console.error(`Booking ${pending.id} confirmation email failed:`, e)
  }

  return await payload.findByID({ collection: 'bookings', id: booking.id, overrideAccess: true })
}
```

- [ ] **Step 9: Update `src/app/api/bookings/route.ts`** to accept `classInstanceId`

Replace lines 15–25 (the destructure, validation, and `createPaidBooking` call):

```ts
  const { classInstanceId, sourceId, customerName, customerEmail, customerPhone } = body ?? {}
  if (!classInstanceId || !sourceId || !customerName || !customerEmail) {
    return Response.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const payload = await getPayload({ config: await config })
  try {
    const booking = await createPaidBooking(
      { payload, charge: chargeCard, sendEmail },
      { classInstanceId, sourceId, customerName, customerEmail, customerPhone },
    )
    return Response.json({ ok: true, bookingId: booking.id })
```

### 4c. Reset schema, regenerate types, write & run tests

- [ ] **Step 10: Recreate the test database** (drizzle would otherwise prompt interactively on the column renames)

Run:
```bash
docker compose -f docker-compose.dev.yml exec -T db psql -U portside -d postgres \
  -c "DROP DATABASE IF EXISTS portside_test;" -c "CREATE DATABASE portside_test;"
```
Expected: `DROP DATABASE` / `CREATE DATABASE`. (If the dev DB needs the same treatment, do it in Task 8.)

- [ ] **Step 11: Regenerate Payload types**

Run: `pnpm generate:types`
Expected: `src/payload-types.ts` updated with `ClassInstance`, `classInstance` on `Booking`, `defaultPriceCents`/`defaultCapacity` on `Class`, and the `instructor` role. No errors.

- [ ] **Step 12: Write `tests/int/class-instances.int.spec.ts`**

```ts
import { describe, it, expect, afterAll } from 'vitest'
import { getTestPayload } from './helpers'

async function makeClass(payload: any) {
  return payload.create({ collection: 'classes', data: {
    title: `Inst Class ${Date.now()}-${Math.random()}`, category: 'wheel-series',
    defaultPriceCents: 22000, defaultCapacity: 8,
  } })
}

describe('ClassInstances', () => {
  afterAll(async () => {
    const payload = await getTestPayload()
    await payload.delete({ collection: 'payments', where: {} })
    await payload.delete({ collection: 'bookings', where: {} })
    await payload.delete({ collection: 'class-instances', where: {} })
    await payload.delete({ collection: 'classes', where: {} })
  })

  it('inherits price and capacity from its class when left blank', async () => {
    const payload = await getTestPayload()
    const cls = await makeClass(payload)
    const inst = await payload.create({ collection: 'class-instances', data: {
      class: cls.id, instructor: undefined, startDate: '2026-07-07', startTime: '18:00', endTime: '20:00',
      // instructor required — create a user
    } as any }).catch((e: Error) => e)
    // instructor is required, so the above throws; assert that here
    expect(inst).toBeInstanceOf(Error)
  })

  it('fills defaults, label and status when fully specified', async () => {
    const payload = await getTestPayload()
    const cls = await makeClass(payload)
    const user = await payload.create({ collection: 'users', data: {
      name: 'Teacher', email: `t-${Date.now()}@test.local`, password: 'test12345', roles: ['instructor'],
    } })
    const inst = await payload.create({ collection: 'class-instances', data: {
      class: cls.id, instructor: user.id, startDate: '2026-07-07', startTime: '18:00', endTime: '20:00',
    } })
    expect(inst.priceCents).toBe(22000)
    expect(inst.capacity).toBe(8)
    expect(inst.status).toBe('draft')
    expect(inst.label).toContain('2026-07-07')
  })

  it('allows overriding price and capacity per instance', async () => {
    const payload = await getTestPayload()
    const cls = await makeClass(payload)
    const user = await payload.create({ collection: 'users', data: {
      name: 'Teacher2', email: `t2-${Date.now()}@test.local`, password: 'test12345', roles: ['instructor'],
    } })
    const inst = await payload.create({ collection: 'class-instances', data: {
      class: cls.id, instructor: user.id, startDate: '2026-07-07', startTime: '18:00', endTime: '20:00',
      priceCents: 9900, capacity: 3,
    } })
    expect(inst.priceCents).toBe(9900)
    expect(inst.capacity).toBe(3)
  })

  it('rejects a malformed start time', async () => {
    const payload = await getTestPayload()
    const cls = await makeClass(payload)
    const user = await payload.create({ collection: 'users', data: {
      name: 'Teacher3', email: `t3-${Date.now()}@test.local`, password: 'test12345', roles: ['instructor'],
    } })
    await expect(payload.create({ collection: 'class-instances', data: {
      class: cls.id, instructor: user.id, startDate: '2026-07-07', startTime: '6pm', endTime: '20:00',
    } })).rejects.toThrow()
  })
})
```

- [ ] **Step 13: Write `tests/int/instructor-access.int.spec.ts`**

```ts
import { describe, it, expect, afterAll } from 'vitest'
import { getTestPayload } from './helpers'

describe('Instructor access scoping', () => {
  afterAll(async () => {
    const payload = await getTestPayload()
    await payload.delete({ collection: 'class-instances', where: {} })
    await payload.delete({ collection: 'classes', where: {} })
  })

  it('an instructor reads only their own instances; public reads only published', async () => {
    const payload = await getTestPayload()
    const cls = await payload.create({ collection: 'classes', data: {
      title: `Acc ${Date.now()}`, category: 'raku', defaultPriceCents: 5000, defaultCapacity: 5,
    } })
    const mine = await payload.create({ collection: 'users', data: {
      name: 'Mine', email: `mine-${Date.now()}@test.local`, password: 'test12345', roles: ['instructor'],
    } })
    const other = await payload.create({ collection: 'users', data: {
      name: 'Other', email: `other-${Date.now()}@test.local`, password: 'test12345', roles: ['instructor'],
    } })
    const common = { class: cls.id, startTime: '18:00', endTime: '20:00' }
    const mineDraft = await payload.create({ collection: 'class-instances', data: { ...common, instructor: mine.id, startDate: '2026-07-07', status: 'draft' } })
    await payload.create({ collection: 'class-instances', data: { ...common, instructor: other.id, startDate: '2026-07-08', status: 'published' } })

    // Instructor "mine" sees only their own instance (including their draft).
    const asMine = await payload.find({ collection: 'class-instances', overrideAccess: false, user: mine })
    expect(asMine.docs.map((d) => d.id)).toEqual([mineDraft.id])

    // Public (no user) sees only published instances.
    const asPublic = await payload.find({ collection: 'class-instances', overrideAccess: false })
    expect(asPublic.docs.every((d) => d.status === 'published')).toBe(true)
    expect(asPublic.docs.some((d) => d.id === mineDraft.id)).toBe(false)
  })
})
```

- [ ] **Step 14: Rewrite `tests/int/occupancy.int.spec.ts`** to be instance-based

```ts
import { describe, it, expect, afterAll } from 'vitest'
import { getTestPayload } from './helpers'
import { seatsRemaining } from '../../src/lib/occupancy'

async function makeInstance(payload: any, capacity: number) {
  const cls = await payload.create({ collection: 'classes', data: {
    title: `Cap ${Date.now()}-${Math.random()}`, category: 'raku', defaultPriceCents: 1000, defaultCapacity: capacity,
  } })
  const user = await payload.create({ collection: 'users', data: {
    name: 'Inst', email: `inst-${Date.now()}-${Math.random()}@test.local`, password: 'test12345', roles: ['instructor'],
  } })
  return payload.create({ collection: 'class-instances', data: {
    class: cls.id, instructor: user.id, startDate: '2026-07-07', startTime: '18:00', endTime: '20:00', status: 'published', capacity,
  } })
}

describe('seatsRemaining', () => {
  afterAll(async () => {
    const payload = await getTestPayload()
    await payload.delete({ collection: 'payments', where: {} })
    await payload.delete({ collection: 'bookings', where: {} })
    await payload.delete({ collection: 'class-instances', where: {} })
    await payload.delete({ collection: 'classes', where: {} })
  })

  it('counts paid and pending bookings against capacity', async () => {
    const payload = await getTestPayload()
    const inst = await makeInstance(payload, 2)
    expect(await seatsRemaining(payload, inst.id)).toBe(2)
    await payload.create({ collection: 'bookings', overrideAccess: true, data: {
      classInstance: inst.id, customerName: 'A', customerEmail: 'a@test.local', amountCents: 1000, status: 'paid',
    } })
    await payload.create({ collection: 'bookings', overrideAccess: true, data: {
      classInstance: inst.id, customerName: 'B', customerEmail: 'b@test.local', amountCents: 1000, status: 'pending',
    } })
    expect(await seatsRemaining(payload, inst.id)).toBe(0)
  })

  it('ignores cancelled bookings', async () => {
    const payload = await getTestPayload()
    const inst = await makeInstance(payload, 1)
    await payload.create({ collection: 'bookings', overrideAccess: true, data: {
      classInstance: inst.id, customerName: 'C', customerEmail: 'c@test.local', amountCents: 1000, status: 'cancelled',
    } })
    expect(await seatsRemaining(payload, inst.id)).toBe(1)
  })
})
```

- [ ] **Step 15: Rewrite `tests/int/booking-service.int.spec.ts`** to book an instance and assert the ICS attachment

```ts
import { describe, it, expect, vi, afterAll } from 'vitest'
import { getTestPayload } from './helpers'
import { createPaidBooking } from '../../src/services/booking'

function deps(overrides = {}) {
  return {
    charge: vi.fn(async () => ({ paymentId: 'pay_123', status: 'COMPLETED' })),
    sendEmail: vi.fn(async () => {}),
    ...overrides,
  }
}

async function makeInstance(payload: any, capacity: number, status = 'published') {
  const cls = await payload.create({ collection: 'classes', data: {
    title: `Svc ${Date.now()}-${Math.random()}`, category: 'wheel-series', defaultPriceCents: 22000, defaultCapacity: capacity,
  } })
  const user = await payload.create({ collection: 'users', data: {
    name: 'Inst', email: `inst-${Date.now()}-${Math.random()}@test.local`, password: 'test12345', roles: ['instructor'],
  } })
  return payload.create({ collection: 'class-instances', data: {
    class: cls.id, instructor: user.id, startDate: '2026-07-07', endDate: '2026-08-11',
    daysOfWeek: ['TU'], startTime: '18:00', endTime: '20:00', status, capacity,
  } })
}

describe('createPaidBooking', () => {
  afterAll(async () => {
    const payload = await getTestPayload()
    await payload.delete({ collection: 'payments', where: {} })
    await payload.delete({ collection: 'bookings', where: {} })
    await payload.delete({ collection: 'class-instances', where: {} })
    await payload.delete({ collection: 'classes', where: {} })
    await payload.delete({ collection: 'people', where: { email: { like: '@test.local' } } })
  })

  it('charges the DB price and records a paid booking + payment + ICS email', async () => {
    const payload = await getTestPayload()
    const inst = await makeInstance(payload, 5)
    const d = deps()
    const booking = await createPaidBooking({ payload, ...d }, {
      classInstanceId: inst.id, sourceId: 'cnon:fake', customerName: 'Jo', customerEmail: 'jo@test.local',
    })
    expect(d.charge).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 22000, sourceId: 'cnon:fake' }))
    expect(booking.status).toBe('paid')
    expect(booking.squarePaymentId).toBe('pay_123')
    const pays = await payload.find({ collection: 'payments', where: { squareId: { equals: 'pay_123' } } })
    expect(pays.totalDocs).toBe(1)
    // Confirmation email carries a class.ics attachment.
    const emailArg = d.sendEmail.mock.calls[0][0]
    expect(emailArg.attachments[0].filename).toBe('class.ics')
    expect(emailArg.attachments[0].content.toString()).toContain('BEGIN:VCALENDAR')
  })

  it('refuses to book an unpublished instance', async () => {
    const payload = await getTestPayload()
    const inst = await makeInstance(payload, 5, 'draft')
    const d = deps()
    await expect(createPaidBooking({ payload, ...d }, {
      classInstanceId: inst.id, sourceId: 'cnon:x', customerName: 'X', customerEmail: 'x@test.local',
    })).rejects.toThrow(/not available/i)
    expect(d.charge).not.toHaveBeenCalled()
  })

  it('rejects when the instance is full and does not charge', async () => {
    const payload = await getTestPayload()
    const inst = await makeInstance(payload, 1)
    const d = deps()
    await createPaidBooking({ payload, ...d }, { classInstanceId: inst.id, sourceId: 'cnon:a', customerName: 'A', customerEmail: 'a@t.local' })
    d.charge.mockClear()
    await expect(createPaidBooking({ payload, ...d }, {
      classInstanceId: inst.id, sourceId: 'cnon:b', customerName: 'B', customerEmail: 'b@t.local',
    })).rejects.toThrow(/full/i)
    expect(d.charge).not.toHaveBeenCalled()
  })

  it('cancels the pending booking if the charge fails (frees the seat)', async () => {
    const payload = await getTestPayload()
    const inst = await makeInstance(payload, 1)
    const d = deps({ charge: vi.fn(async () => { throw new Error('card declined') }) })
    await expect(createPaidBooking({ payload, ...d }, {
      classInstanceId: inst.id, sourceId: 'cnon:x', customerName: 'X', customerEmail: 'x@t.local',
    })).rejects.toThrow(/declined/i)
    const remaining = await payload.count({ collection: 'bookings', where: { and: [
      { classInstance: { equals: inst.id } }, { status: { in: ['paid', 'pending'] } },
    ] } })
    expect(remaining.totalDocs).toBe(0)
  })

  it('never oversells under concurrent attempts', async () => {
    const payload = await getTestPayload()
    const inst = await makeInstance(payload, 1)
    await Promise.allSettled([
      createPaidBooking({ payload, ...deps() }, { classInstanceId: inst.id, sourceId: 'cnon:p1', customerName: 'P1', customerEmail: 'p1@t.local' }),
      createPaidBooking({ payload, ...deps() }, { classInstanceId: inst.id, sourceId: 'cnon:p2', customerName: 'P2', customerEmail: 'p2@t.local' }),
    ])
    const occupied = await payload.count({ collection: 'bookings', where: { and: [
      { classInstance: { equals: inst.id } }, { status: { in: ['paid', 'pending'] } },
    ] } })
    expect(occupied.totalDocs).toBeLessThanOrEqual(1)
  })

  it('links the booking to a person, reusing the same person on a repeat email', async () => {
    const payload = await getTestPayload()
    const inst = await makeInstance(payload, 5)
    const d = deps()
    const first = await createPaidBooking({ payload, ...d }, {
      classInstanceId: inst.id, sourceId: 'cnon:fake', customerName: 'Repeat', customerEmail: 'repeat@test.local', customerPhone: '999',
    })
    const firstFull = await payload.findByID({ collection: 'bookings', id: first.id, depth: 0 })
    expect(firstFull.person).toBeTruthy()
    const inst2 = await makeInstance(payload, 5)
    const second = await createPaidBooking({ payload, ...d }, {
      classInstanceId: inst2.id, sourceId: 'cnon:fake2', customerName: 'Repeat', customerEmail: 'REPEAT@test.local',
    })
    const secondFull = await payload.findByID({ collection: 'bookings', id: second.id, depth: 0 })
    expect(secondFull.person).toBe(firstFull.person)
  })
})
```

- [ ] **Step 16: Run the new/changed suites**

Run: `pnpm run test:int -- class-instances instructor-access occupancy booking-service`
Expected: PASS for all four suites. (First boot pushes the fresh schema to `portside_test`.)

- [ ] **Step 17: Run the full integration suite to catch regressions**

Run: `pnpm run test:int`
Expected: PASS. If `tests/int/classes.int.spec.ts` references the removed `scheduleText`/`priceCents`/`capacity` fields, update those creates to `defaultPriceCents`/`defaultCapacity` and drop `scheduleText` (mechanical — the slug-generation assertions are unchanged).

- [ ] **Step 18: Commit**

```bash
git add src/collections src/hooks/applyClassDefaults.ts src/payload.config.ts src/lib/occupancy.ts src/services/booking.ts src/app/api/bookings/route.ts src/payload-types.ts tests/int
git commit -m "Split classes into class + class-instance; book instances with ICS"
```

---

## Task 5: Public class pages (list, detail, signup)

**Files:**
- Modify: `src/app/(frontend)/classes/page.tsx`
- Modify: `src/app/(frontend)/classes/[slug]/page.tsx`
- Create: `src/app/(frontend)/classes/[slug]/signup/[instanceId]/page.tsx`
- Modify: `src/app/(frontend)/classes/[slug]/BookingForm.tsx`

No new automated tests (these are server components covered by the existing Playwright `public-pages` smoke); verification is manual via `pnpm dev` in Task 8.

- [ ] **Step 1: Update `BookingForm.tsx`** to take `classInstanceId`

Replace the prop name `classId` with `classInstanceId` throughout the component:
- Props type: `classInstanceId: string | number` (remove `classId`).
- Function signature destructure: `{ classInstanceId, slug, priceCents, priceLabel }`.
- In `completeBooking`, the POST body key `classId,` becomes `classInstanceId,`.
- The `useCallback` dependency array `[classId, slug, router]` becomes `[classInstanceId, slug, router]`.
- The `WalletButtons` `referenceId` prop `` `booking-${classId}` `` becomes `` `booking-instance-${classInstanceId}` ``.

- [ ] **Step 2: Rewrite `src/app/(frontend)/classes/page.tsx`** (classes + next-available date)

```tsx
import { getPayload } from 'payload'
import config from '@payload-config'
import Link from 'next/link'
import { usd, CATEGORY_LABELS } from '../../../lib/format'
import { mediaUrl, mediaAlt } from '../../../lib/media'
import { formatDate } from '../../../lib/schedule'

export const dynamic = 'force-dynamic'

export default async function ClassesPage() {
  const payload = await getPayload({ config: await config })
  const todayIso = new Date().toISOString().slice(0, 10)

  const { docs: classes } = await payload.find({
    collection: 'classes',
    where: { status: { equals: 'active' } },
    sort: 'title',
    limit: 100,
    depth: 2,
  })

  const { docs: instances } = await payload.find({
    collection: 'class-instances',
    where: { and: [{ status: { equals: 'published' } }, { startDate: { greater_than_equal: todayIso } }] },
    sort: 'startDate',
    limit: 500,
    depth: 0,
  })

  // Earliest upcoming start date per class id (instances are sorted ascending).
  const nextByClass = new Map<number | string, string>()
  for (const inst of instances) {
    const cid = typeof inst.class === 'object' && inst.class ? inst.class.id : inst.class
    if (cid != null && !nextByClass.has(cid)) nextByClass.set(cid, inst.startDate as string)
  }

  return (
    <div style={{ padding: '40px 0' }}>
      <h1>Classes</h1>
      <p style={{ marginBottom: 16 }}>
        <Link href="/schedule">View the full schedule →</Link>
      </p>
      {classes.length === 0 ? (
        <p>New classes are being scheduled — check back soon.</p>
      ) : (
        <div className="pp-cards-grid">
          {classes.map((c) => {
            const imgUrl = mediaUrl(c.image, 'card')
            const next = nextByClass.get(c.id)
            return (
              <article key={c.id} className="pp-card">
                {imgUrl && (
                  <div className="pp-card-img">
                    <img src={imgUrl} alt={mediaAlt(c.image)} loading="lazy" />
                  </div>
                )}
                <div className="pp-card-body">
                  <div className="pp-kicker">{CATEGORY_LABELS[c.category] ?? c.category}</div>
                  <h2>
                    <Link href={`/classes/${c.slug}`}>{c.title}</Link>
                  </h2>
                  <div className="pp-card-meta">
                    {next ? `Next session: ${formatDate(next)}` : 'New dates coming soon'} · from {usd(c.defaultPriceCents)}
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Rewrite `src/app/(frontend)/classes/[slug]/page.tsx`** (list a class's upcoming instances)

```tsx
import { getPayload } from 'payload'
import config from '@payload-config'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { usd, CATEGORY_LABELS } from '../../../../lib/format'
import { mediaUrl, mediaAlt } from '../../../../lib/media'
import { seatsRemaining } from '../../../../lib/occupancy'
import { scheduleSummary } from '../../../../lib/schedule'

export const dynamic = 'force-dynamic'

export default async function ClassDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const payload = await getPayload({ config: await config })
  const { docs } = await payload.find({ collection: 'classes', where: { slug: { equals: slug } }, limit: 1, depth: 2 })
  const cls = docs[0]
  if (!cls) notFound()

  const todayIso = new Date().toISOString().slice(0, 10)
  const { docs: instances } = await payload.find({
    collection: 'class-instances',
    where: { and: [
      { class: { equals: cls.id } },
      { status: { equals: 'published' } },
      { startDate: { greater_than_equal: todayIso } },
    ] },
    sort: 'startDate',
    limit: 100,
    depth: 2,
  })

  const withSeats = await Promise.all(
    instances.map(async (inst) => ({ inst, remaining: await seatsRemaining(payload, inst.id) })),
  )

  const bannerUrl = mediaUrl(cls.image, 'hero')

  return (
    <div style={{ padding: '40px 0', maxWidth: 720 }}>
      {bannerUrl && (
        <div className="pp-detail-banner">
          <img src={bannerUrl} alt={mediaAlt(cls.image)} loading="lazy" />
        </div>
      )}
      <div className="pp-kicker">{CATEGORY_LABELS[cls.category] ?? cls.category}</div>
      <h1>{cls.title}</h1>
      {cls.skillLevel && <div style={{ color: 'var(--pp-muted)' }}>Skill level: {cls.skillLevel}</div>}
      {cls.description && <p style={{ marginTop: 16 }}>{cls.description}</p>}

      <h2 style={{ marginTop: 32 }}>Upcoming sessions</h2>
      {withSeats.length === 0 ? (
        <p>No sessions are scheduled right now — check back soon.</p>
      ) : (
        <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
          {withSeats.map(({ inst, remaining }) => {
            const instructorName = typeof inst.instructor === 'object' && inst.instructor ? inst.instructor.name : null
            return (
              <div key={inst.id} className="pp-card" style={{ padding: 16 }}>
                <div style={{ fontWeight: 600 }}>{scheduleSummary(inst)}</div>
                <div style={{ color: 'var(--pp-muted)' }}>
                  {instructorName ? `With ${instructorName} · ` : ''}{usd(inst.priceCents)}
                </div>
                {remaining > 0 ? (
                  <p style={{ marginTop: 8 }}>
                    <Link className="pp-btn" href={`/classes/${slug}/signup/${inst.id}`}>
                      Sign up ({remaining} {remaining === 1 ? 'seat' : 'seats'} left)
                    </Link>
                  </p>
                ) : (
                  <p style={{ marginTop: 8, fontWeight: 600 }}>Full</p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Create `src/app/(frontend)/classes/[slug]/signup/[instanceId]/page.tsx`**

```tsx
import { getPayload } from 'payload'
import config from '@payload-config'
import { notFound } from 'next/navigation'
import { usd, CATEGORY_LABELS } from '../../../../../../lib/format'
import { seatsRemaining } from '../../../../../../lib/occupancy'
import { scheduleSummary } from '../../../../../../lib/schedule'
import { BookingForm } from '../../BookingForm'

export const dynamic = 'force-dynamic'

export default async function SignupPage({ params }: { params: Promise<{ slug: string; instanceId: string }> }) {
  const { slug, instanceId } = await params
  const payload = await getPayload({ config: await config })

  let inst: any
  try {
    inst = await payload.findByID({ collection: 'class-instances', id: instanceId, depth: 2 })
  } catch {
    notFound()
  }
  const cls = inst && typeof inst.class === 'object' ? inst.class : null
  if (!inst || inst.status !== 'published' || !cls || cls.slug !== slug) notFound()

  const remaining = await seatsRemaining(payload, inst.id)

  return (
    <div style={{ padding: '40px 0', maxWidth: 720 }}>
      <div className="pp-kicker">{CATEGORY_LABELS[cls.category] ?? cls.category}</div>
      <h1>{cls.title}</h1>
      <div style={{ color: 'var(--pp-muted)' }}>{scheduleSummary(inst)}</div>
      <p style={{ fontSize: 22, fontWeight: 600 }}>{usd(inst.priceCents)}</p>
      {remaining > 0 ? (
        <BookingForm classInstanceId={inst.id} slug={slug} priceCents={inst.priceCents} priceLabel={usd(inst.priceCents)} />
      ) : (
        <p style={{ fontWeight: 600 }}>This session is full.</p>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Type-check the frontend changes**

Run: `pnpm exec tsc --noEmit`
Expected: No errors in the four edited/created files. (Fix any prop/field mismatches surfaced.)

- [ ] **Step 6: Commit**

```bash
git add "src/app/(frontend)/classes"
git commit -m "Rebuild public class pages around instances + per-instance signup"
```

---

## Task 6: Schedule calendar page

**Files:**
- Create: `src/app/(frontend)/schedule/page.tsx`

- [ ] **Step 1: Create `src/app/(frontend)/schedule/page.tsx`**

```tsx
import { getPayload } from 'payload'
import config from '@payload-config'
import Link from 'next/link'
import { expandSessions, monthGrid, formatTime } from '../../../lib/schedule'

export const dynamic = 'force-dynamic'

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEKDAY_HEADS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

interface Chip { instanceId: number | string; slug: string; title: string; time: string }

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { month: monthParam } = await searchParams
  const now = new Date()
  const m = /^(\d{4})-(\d{2})$/.exec(monthParam ?? '')
  const year = m ? Number(m[1]) : now.getUTCFullYear()
  const month = m ? Number(m[2]) : now.getUTCMonth() + 1 // 1-based

  const grid = monthGrid(year, month)
  const gridStart = new Date(`${grid[0][0]}T00:00:00.000Z`)
  const gridEnd = new Date(`${grid[grid.length - 1][6]}T23:59:59.000Z`)

  const payload = await getPayload({ config: await config })
  const { docs: instances } = await payload.find({
    collection: 'class-instances',
    where: { status: { equals: 'published' } },
    limit: 500,
    depth: 2,
  })

  // Bucket session chips by "YYYY-MM-DD".
  const byDay = new Map<string, Chip[]>()
  for (const inst of instances) {
    const cls = typeof inst.class === 'object' && inst.class ? inst.class : null
    if (!cls) continue
    const sessions = expandSessions(
      { startDate: inst.startDate as string, endDate: inst.endDate as string | null, daysOfWeek: inst.daysOfWeek as string[] | null, skipDates: inst.skipDates as { date: string }[] | null },
      gridStart,
      gridEnd,
    )
    for (const day of sessions) {
      const chip: Chip = { instanceId: inst.id, slug: cls.slug, title: cls.title, time: inst.startTime ? formatTime(inst.startTime as string) : '' }
      const list = byDay.get(day) ?? []
      list.push(chip)
      byDay.set(day, list)
    }
  }

  const prev = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`
  const next = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`

  return (
    <div style={{ padding: '40px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1>{MONTH_NAMES[month - 1]} {year}</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link className="pp-btn" href={`/schedule?month=${prev}`}>← Prev</Link>
          <Link className="pp-btn" href={`/schedule?month=${next}`}>Next →</Link>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginTop: 16 }}>
        {WEEKDAY_HEADS.map((d) => (
          <div key={d} style={{ fontWeight: 600, textAlign: 'center', padding: 4 }}>{d}</div>
        ))}
        {grid.flat().map((day) => {
          const inMonth = Number(day.slice(5, 7)) === month
          const chips = byDay.get(day) ?? []
          return (
            <div key={day} style={{ minHeight: 96, border: '1px solid var(--pp-border, #d9cdbf)', borderRadius: 4, padding: 4, opacity: inMonth ? 1 : 0.45 }}>
              <div style={{ fontSize: 12, color: 'var(--pp-muted)' }}>{Number(day.slice(8, 10))}</div>
              <div style={{ display: 'grid', gap: 2, marginTop: 2 }}>
                {chips.map((c, i) => (
                  <Link key={`${c.instanceId}-${i}`} href={`/classes/${c.slug}/signup/${c.instanceId}`}
                    style={{ fontSize: 11, background: 'var(--pp-accent, #A8502F)', color: '#fff', borderRadius: 3, padding: '2px 4px', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.time && `${c.time} `}{c.title}
                  </Link>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(frontend)/schedule"
git commit -m "Add month calendar schedule view of upcoming class sessions"
```

---

## Task 7: Update the seed script

**Files:**
- Modify: `src/seed/seed.ts`

The current seed creates two classes with the old fields (`priceCents`, `capacity`, `scheduleText`). Update them to the new class fields and add a published instance for each so the dev site shows live sessions.

- [ ] **Step 1: Update the `ensureClass` calls** in `src/seed/seed.ts` (around lines 116–124) to the new field names

```ts
  // Classes (templates)
  await ensureClass(payload, '6wk-wheel-throwing-tuesdays', {
    title: '6-Week Wheel Throwing', category: 'wheel-series', skillLevel: 'Beginner',
    description: 'Six weeks of wheel-throwing fundamentals.', defaultPriceCents: 22000, defaultCapacity: 8,
    status: 'active',
  })
  await ensureClass(payload, 'kids-day-camp-pottery-pizza', {
    title: 'Kids Day Camp: Pottery & Pizza', category: 'day-camp', skillLevel: 'All ages',
    description: 'A fun day of clay and pizza for kids.', defaultPriceCents: 6500, defaultCapacity: 12,
    status: 'active',
  })
```

- [ ] **Step 2: Add an `ensureInstance` helper** near `ensureClass` (after line 19)

```ts
async function ensureInstance(payload: Payload, classSlug: string, data: Record<string, unknown>) {
  const cls = await payload.find({ collection: 'classes', where: { slug: { equals: classSlug } }, limit: 1 })
  if (cls.totalDocs === 0) return
  const classId = cls.docs[0].id
  const existing = await payload.find({
    collection: 'class-instances',
    where: { and: [{ class: { equals: classId } }, { startDate: { equals: data.startDate as string } }] },
    limit: 1,
  })
  if (existing.totalDocs > 0) return existing.docs[0]
  return payload.create({ collection: 'class-instances', data: { class: classId, ...data } } as Parameters<Payload['create']>[0])
}
```

- [ ] **Step 3: Seed an instance for each class** — after the class image updates (after line 134), using the existing `eric`/`naiomi` user records (the seed already creates instructors; reference whichever variable holds a created user — inspect the surrounding code for the instructor user variable, e.g. `eric`)

```ts
  // Class instances (scheduled runs)
  await ensureInstance(payload, '6wk-wheel-throwing-tuesdays', {
    instructor: eric.id, startDate: '2026-09-01', endDate: '2026-10-06',
    daysOfWeek: ['TU'], startTime: '18:00', endTime: '20:00', status: 'published',
  })
  await ensureInstance(payload, 'kids-day-camp-pottery-pizza', {
    instructor: naiomi.id, startDate: '2026-08-15', startTime: '10:00', endTime: '14:00', status: 'published',
  })
```

> If the instructor user variables are named differently, use the actual variables created earlier in `seed.ts` (the file creates the staff users that back `eric`/`naiomi`). Do not invent IDs.

- [ ] **Step 4: Commit** (seed runs against the dev DB in Task 8)

```bash
git add src/seed/seed.ts
git commit -m "Seed a class instance for each seeded class"
```

---

## Task 8: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Recreate and reseed the dev database** (column renames; pre-launch so data is disposable). Stop the dev server first if running.

```bash
docker compose -f docker-compose.dev.yml exec -T db psql -U portside -d postgres \
  -c "DROP DATABASE IF EXISTS portside;" -c "CREATE DATABASE portside;"
pnpm seed
```
Expected: seed completes; classes + instances created.

- [ ] **Step 2: Run the full integration suite**

Run: `pnpm run test:int`
Expected: PASS (all suites).

- [ ] **Step 3: Lint and type-check**

Run: `pnpm lint && pnpm exec tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Manual smoke via the running app** (use the `run` skill or `pnpm dev`)

Verify:
- `/classes` lists the two seeded classes with a "Next session" date.
- A class detail page lists its upcoming published instance(s) with seats + a working **Sign up** link.
- `/schedule` shows the recurring Tuesday wheel sessions and the single kids-camp day, each chip linking to signup.
- In Payload admin: create a class instance, confirm price/capacity prefill from the class and the `roster` join field appears; a user with only the `instructor` role sees just their own instances and the roster.
- Complete a sandbox booking and confirm the email arrives with a `class.ics` attachment that imports into a calendar with the correct time/recurrence.

- [ ] **Step 5: Final commit (if any verification fixes were needed)**

```bash
git add -A
git commit -m "Fixups from class-instance redesign verification"
```

---

## Self-Review

- **Spec coverage:** Class/Instance split (Task 4) ✓; recurrence rule + skip dates (Tasks 1,2,4) ✓; booking re-point + occupancy (Task 4) ✓; ICS attachment with fixed Pacific timezone (Tasks 2,3,4) ✓; instructor admin view via access control + roster join (Task 4) ✓; public class pages + per-instance signup (Task 5) ✓; calendar schedule (Task 6) ✓; pre-launch schema reset, no migration (Tasks 4,8) ✓; overridable instance image (Task 4 — `image` field; surfaced on pages where shown) ✓; testing (Tasks 1–4) ✓.
- **Type consistency:** `classInstance` (booking field), `classInstanceId` (BookingInput / API / BookingForm), `defaultPriceCents`/`defaultCapacity` (class), `priceCents`/`capacity` (instance, inherited), `buildClassIcs(instance, className)`, `scheduleSummary`/`expandSessions`/`monthGrid`/`formatTime`/`formatDate` (schedule) — used consistently across tasks.
- **Notes for the implementer:** After Task 4 the frontend temporarily references new fields before Task 5 lands them; the per-task gate through Task 4 is the integration suite, with `tsc`/`lint`/`build` going green in Tasks 5–6 and 8.

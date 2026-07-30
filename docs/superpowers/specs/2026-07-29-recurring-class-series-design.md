# Recurring Class Series (Generator) — Design

**Date:** 2026-07-29
**Status:** Approved

## Goal

Let admins create many single-day class instances at once from a recurrence
rule — "every Tuesday", "every other Saturday", "the 1st of the month",
"1st & 3rd Tuesday" — instead of hand-creating each instance. Each generated
instance is a normal, individually bookable `class-instances` doc.

## Decisions (settled during brainstorming)

- **Generator, not a series entity.** The admin runs a tool: class + rule +
  range → preview → create batch. Once created, instances are fully
  independent — edited, cancelled, completed exactly like hand-made ones.
  Re-run the generator later to extend the schedule. No rolling-horizon jobs,
  no series-wide edit propagation.
- **Zero schema change.** The generator's output is plain `class-instances`
  rows. No migration; the existing prod instances (17 published, 7 completed
  as of 2026-07-29) are untouched and indistinguishable from generated ones.
  Booking, rosters, auto-complete, ICS, and the delete-guard all apply as-is.
- **Published immediately.** The preview step is the review; confirmed dates
  go live on the site at once (status `published`).
- **All four patterns:** weekly, every-other-week, day-of-month, ordinal
  weekday(s) of the month.
- **Skip dates = uncheck in preview.** No separate skip-date input.

## Architecture

```
Admin: Class Instances list ── "Schedule a series" button ──▶ /admin/schedule-series
                                                                   │ (client form)
                                              POST /api/class-instances/series-preview
                                                                   │ dates + conflicts
                                              POST /api/class-instances/series-create
                                                                   │
                                                    payload.create × N (normal instances)
                        src/lib/recurrence.ts (pure) ◀── both endpoints
```

### 1. Recurrence engine — `src/lib/recurrence.ts` (pure, no I/O)

```ts
type Weekday = 'sunday' | … | 'saturday'            // match DAYS_OF_WEEK in lib/studio
type Ordinal = 1 | 2 | 3 | 4 | 5 | 'last'

type RecurrenceRule =
  | { kind: 'weekly'; weekday: Weekday; interval: 1 | 2 }   // interval 2 = every other week
  | { kind: 'dayOfMonth'; day: number }                     // 1–31
  | { kind: 'ordinalWeekday'; weekday: Weekday; ordinals: Ordinal[] }  // e.g. [1, 3]

function expandRule(rule: RecurrenceRule, range: { from: string; until: string }): string[]
```

- Input/output dates are plain `YYYY-MM-DD` strings (calendar math only —
  no timezones inside the engine; DST cannot bite because no timestamps are
  involved).
- `from` is the first candidate date (inclusive); `until` is inclusive.
- `weekly` with `interval: 2` anchors the cadence on the first matching
  weekday ≥ `from`.
- `dayOfMonth` **skips** months that lack the day (no Feb 31 → Mar 3 shift).
- `ordinalWeekday` supports multiple ordinals in one rule ("1st & 3rd
  Tuesday"); ordinal `5` yields nothing in months without a 5th such weekday;
  `'last'` is always valid.
- Results are sorted ascending, deduped (e.g. 5th ∩ last), and **hard-capped
  at 52 dates** — `expandRule` throws a descriptive error beyond the cap
  (footgun guard against a far-future `until`).

### 2. Endpoints — `src/endpoints/class-series.ts`, attached to the

`class-instances` collection (Payload custom endpoints, so `req.user` arrives
authenticated — same pattern as the newsletter endpoints). Both staff-only
(`users` collection, role `admin` or `editor`; 403 otherwise).

**`POST /api/class-instances/series-preview`**
Body: `{ classId, rule, from, until }`
Returns: `{ dates: [{ date: 'YYYY-MM-DD', conflict: boolean }], classTitle }`
- `conflict: true` where a non-cancelled instance of the same class already
  starts on that date (equality against studio-midnight storage) — the UI
  shows these unchecked with a "already scheduled" note.
- 400 on invalid rule/range/cap, with the engine's error message.

**`POST /api/class-instances/series-create`**
Body: `{ classId, dates: string[], startTime, endTime, label?, capacity?, priceCents?, instructorId, location? }`
- `dates` is the exact list the admin confirmed (preview is advisory; create
  re-checks conflicts and silently skips any date that gained a conflict
  between preview and create — reported in the response).
- Creates one instance per date via `payload.create`:
  - `startDate`: the date at **studio-midnight Pacific** (07:00Z PDT / 08:00Z
    PST — the house convention; a `studioMidnightIso(ymd)` helper moves from
    `scripts/import-old-classes.ts` into `src/lib/studio.ts` and the script
    imports it from there)
  - `numberOfClasses: 1` explicitly — this stops `applyClassDefaults` from
    inheriting a multi-week default and computing an `endDate`
  - no `daysOfWeek`, no `endDate`, no `skipDates`
  - `status: 'published'`
  - `label`, `capacity`, `priceCents` optional → `applyClassDefaults` fills
    from the class template as usual; `instructor` required (relationship)
- Returns `{ created: number, skipped: [{ date, reason }] }`.
- Cap: rejects > 52 dates (mirror of the engine cap).

### 3. Admin UI

- **Entry point:** a "Schedule a series" button rendered above the Class
  Instances list via the collection's `admin.components.beforeListTable`,
  linking to the custom view.
- **View:** `/admin/schedule-series` — custom admin view + registration in
  `payload.config.ts` `admin.components.views` (same pattern as the
  newsletter Subscribers view; staff-gated server component, client form).
- **Form** (client component):
  1. Class (select, from `/api/classes`), instructor (select, from users
     with instructor/admin/editor role — same options the instance form
     offers), start/end time (HH:MM, validated like the collection),
     optional label/capacity/price overrides (blank = class defaults)
  2. Pattern controls that read as a sentence:
     - Repeats: `weekly | every other week | monthly` (radio)
     - weekly/biweekly → weekday select
     - monthly → `on day N` **or** `on the [1st|2nd|3rd|4th|5th|last]
       [weekday]` with multi-select ordinals
  3. Range: from (default today) / until (date, required)
  4. **Preview** button → table of dates, each with a checkbox (conflicts
     arrive unchecked and annotated); count of checked dates shown
  5. **Create N classes** button → series-create with the checked dates →
     success summary with a link back to the Class Instances list
- Rule/date changes invalidate the current preview (create button disabled
  until re-previewed).

### 4. What deliberately does NOT change

- `ClassInstances` collection schema, hooks, access — untouched
- Multi-week course scheduling (daysOfWeek/numberOfClasses/endDate) — the
  generator only emits single-day instances
- Existing prod data — no backfill, no linkage, no migration

## Error handling

- Engine: invalid weekday/day/ordinal combinations and >52 expansions throw
  typed errors surfaced as 400s with the message shown in the form.
- Create is per-date fault-isolated: one failed `payload.create` (e.g. a
  validation surprise) records `{ date, reason }` in `skipped` and continues;
  the summary shows both counts. Re-running create for missed dates is safe —
  the conflict re-check makes it idempotent per (class, date).
- Both endpoints 403 for non-staff, 404 unknown class.

## Testing

- `tests/int/recurrence.int.spec.ts` (pure): weekly across month boundaries;
  biweekly anchoring; day-of-month skipping short months (31st, Feb 29 in
  non-leap years); ordinal 1st/3rd; 5th-weekday months with and without a
  5th; `last` == 4th vs 5th; from/until inclusivity; dedupe of `5 ∩ last`;
  the 52-date cap error.
- `tests/int/class-series.int.spec.ts`: series-create builds instances with
  studio-midnight startDate, `numberOfClasses: 1`, no endDate, published,
  class defaults applied; conflict skip (existing same-class same-date);
  cancelled instances don't count as conflicts; per-date fault isolation;
  cap rejection.
- Manual E2E on brianwells.org: schedule "1st & 3rd Tuesday" through
  year-end for a real class, verify the schedule page, book one generated
  instance, cancel one, delete-guard still blocks where booked.

## Deployment

No migration. Normal deploy loop (dev droplet first, prod at the next prod
deploy). Existing instances unaffected; the feature is purely additive.

# "My Classes" instructor view — design

**Date:** 2026-06-15
**Status:** Approved

## Problem

Teachers who want to see the classes they're running today have to open the
Class Instances collection, filter by instructor, and read a row dense with
scheduling/pricing metadata. To see who's signed up they then dig into the
roster join field. It works, but it's clunky for less-technical instructors.

We want a friendlier, purpose-built view: an instructor lands on a list of
*their own* classes (soonest first, with past classes available), clicks one,
and sees just the people enrolled — no payment IDs or other metadata.

## Audience & scope

- **For instructors viewing their own classes only.** Queries are always scoped
  to `instructor = currentUser.id`. An admin who is also assigned as an
  instructor sees their own assigned runs here; admins otherwise keep the full
  collection views.
- **One row per course run** (one `class-instances` document), not per session.
  Bookings attach to the instance, so the roster is per run.
- **Out of scope:** per-session expansion, "email all students", printable
  rosters, attendance tracking, and any editing. Read-only.

## Architecture

Two custom Payload admin views registered in `payload.config.ts` under
`admin.components.views`, rendered inside the normal admin chrome (sidebar +
header):

| Path | View | Purpose |
| --- | --- | --- |
| `/admin/my-classes` | `MyClasses` | List, Upcoming/Past tabs, cards |
| `/admin/my-classes/:id` | `MyClassRoster` | Roster for one class run |

A **"My Classes" sidebar link** — new `src/admin/MyClassesNavLink.tsx`, injected
via `admin.components.beforeNavLinks` alongside the existing `MembersNavLink`.
Shown only to users whose `roles` include `instructor`.

Both views are **server components**. They read the logged-in user from the view
props (`initPageResult.req.user`) and query through the Payload local API
(`req.payload`). Scoping every query to `instructor = currentUser.id` means a
hand-typed `/admin/my-classes/:id` for someone else's class returns nothing.

Views are wrapped in Payload's `DefaultTemplate` so they keep the admin nav
gutter and header, consistent with the rest of the admin.

## List view — `/admin/my-classes`

**Data**
- `payload.find({ collection: 'class-instances', where: { instructor: { equals: user.id }, status: { not_equals: 'cancelled' } }, depth: 1, limit: 0 })` (depth 1 to resolve the parent `class` title; `limit: 0` = all).
- Split into **Upcoming/current** vs **Past** using a pure helper
  `splitByTiming(instances, today)`:
  - An instance is *upcoming/current* when `(endDate ?? startDate) >= today`
    (date-only comparison, UTC), else *past*.
  - Upcoming sorted soonest-first (by `startDate` asc).
  - Past sorted most-recent-first (by `startDate` desc).
- Enrolled count per instance via `occupiedSeats(payload, instance.id)` from
  `src/lib/occupancy.ts` (counts paid + pending bookings).

**Render**
- Two tabs, **Upcoming** (default) and **Past**. Tab toggle is a small client
  component; both sections render server-side and the client only controls which
  is visible.
- Each card: class label (instance `label`, falling back to the parent class
  title), `scheduleSummary({ startDate, endDate, daysOfWeek, startTime, endTime })`
  from `src/lib/schedule.ts`, and an enrolled pill `"{occupied} / {capacity}"`
  styled "full" when `occupied >= capacity`.
- Card links to `/admin/my-classes/{id}`.
- Empty states: "You have no upcoming classes." / "No past classes."

## Roster view — `/admin/my-classes/:id`

**Data**
- Load the instance: `payload.findByID({ collection: 'class-instances', id, depth: 1 })`.
- Guard: if not found or `instance.instructor` (id) !== `user.id`, render a
  simple "Class not found" message (no detail leak) and a back link.
- Bookings: `payload.find({ collection: 'bookings', where: { classInstance: { equals: id }, status: { in: ['paid', 'pending'] } }, sort: 'customerName', limit: 0 })`.

**Render**
- Back link to `/admin/my-classes`.
- Header: class label, `scheduleSummary(...)`, `location` (if set), and
  "N enrolled · M spots left" (M from `capacity - occupied`, floored at 0).
- Table, one row per booking: **Name · Email · Phone · Status**.
  - Status pill: paid = green, pending = amber.
  - Phone shows "—" when absent.
- No Square IDs, amounts, or other booking metadata.
- Empty state: "No one is signed up yet."

## Reused building blocks

- `scheduleSummary`, `formatDate` — `src/lib/schedule.ts`
- `occupiedSeats` — `src/lib/occupancy.ts`
- `MembersNavLink.tsx` — pattern reference for the nav link + `beforeNavLinks`
  registration.

## Testing

- **Unit-test `splitByTiming`** (Vitest, the project's `test:int` runner) — the
  one piece of non-trivial pure logic:
  - upcoming/past bucketing relative to a fixed `today`
  - an instance whose run ends today counts as upcoming/current
  - sort order within each bucket
  - single-session instance (no `endDate`) bucketed by `startDate`
- The view components are thin glue over the local API and Payload templates;
  verify them manually in the running admin (nav link visibility by role, list
  scoping, roster scoping/guard, fields shown).

## Files

**New**
- `src/admin/views/MyClasses.tsx` — list view (server component)
- `src/admin/views/MyClassRoster.tsx` — roster view (server component)
- `src/admin/views/MyClassesTabs.tsx` — small client component for the tab toggle
- `src/admin/MyClassesNavLink.tsx` — sidebar link (instructor-only)
- `src/lib/myClasses.ts` — `splitByTiming` helper (+ any shared shaping)
- `tests/int/myClasses.int.spec.ts` — unit tests (matches the repo's
  `tests/int/**/*.int.spec.ts` layout / `test:int` runner)

**Changed**
- `src/payload.config.ts` — register the two views and the nav link

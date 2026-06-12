# Class / Class Instance Redesign

**Date:** 2026-06-12
**Status:** Approved (pre-implementation)

## Problem

The current `Classes` collection conflates two distinct concepts: the *definition*
of a class (title, price, capacity, category) and a *specific scheduled run* of it
(start date, schedule, instructor). This forces staff to recreate a whole class
every time an 8-week cycle repeats, and `Bookings` point directly at the class.

We want:

- A reusable **Class** (template) and a **Class Instance** (a specific scheduled run).
- People sign up for a *class instance*, which may be a multi-week course or a single day.
- Booking confirmation emails carry an **`.ics` calendar attachment** (time, location, recurrence).
- **Instructors** can view their class instances and rosters (current / upcoming / past).

This is a **pre-launch** change — there is no production class/booking data to migrate.
Collections can be restructured cleanly.

## Decisions (from brainstorming)

- **Schedule representation:** recurrence rule (start/end date + days-of-week + start/end
  time), with an optional list of skip dates for holidays (→ ICS `EXDATE`).
- **Instructor view:** inside the existing Payload admin (access control + roster view),
  no separate frontend portal.
- **Existing data:** pre-launch / disposable — no migration.
- **Public browsing:** class pages list their upcoming instances *and* a chronological
  `/schedule` **calendar** view.
- **ICS generation:** the `ics` npm package.
- **Timezone:** single fixed studio timezone — `America/Los_Angeles` (Pacific).

## Data Model

### `classes` (template — "what this class is")

| Field | Type | Notes |
|---|---|---|
| `title` | text, required | |
| `slug` | text, unique | auto-generated from title (unchanged `slugifyFromTitle` hook) |
| `category` | select | wheel-series / day-camp / raku / daytime-multiweek (unchanged) |
| `skillLevel` | text | |
| `description` | textarea | |
| `image` | upload → media | |
| `defaultPriceCents` | number, required, min 0 | renamed from `priceCents`; uses existing dollar PriceField/PriceCell |
| `defaultCapacity` | number, required, min 1 | renamed from `capacity` |
| `status` | select | active / archived (default active) |

Removed from `classes`: `startDate`, `scheduleText`, `instructor` (they describe a run).

### `class-instances` (a specific scheduled run — "when / who")

| Field | Type | Notes |
|---|---|---|
| `class` | relationship → classes, required | |
| `instructor` | relationship → users, required | |
| `startDate` | date, required | first meeting date |
| `endDate` | date | last meeting date; blank ⇒ single-session instance |
| `daysOfWeek` | select hasMany | Sun…Sat; which days it meets |
| `startTime` | time | meeting start time of day |
| `endTime` | time | meeting end time of day |
| `skipDates` | array of date | holidays/exclusions → ICS `EXDATE` |
| `capacity` | number, min 1 | defaults from `class.defaultCapacity`, overridable |
| `priceCents` | number, min 0 | defaults from `class.defaultPriceCents`, overridable; dollar input |
| `location` | text | optional; falls back to a studio address constant |
| `status` | select | draft / published / cancelled / completed (default draft); only **published** is public |
| `roster` | join → bookings | reverse relationship surfacing this instance's bookings in admin |

- **Single-day workshop:** `endDate` blank, one `startDate`, one session.
- **6-week course:** `startDate`→`endDate`, `daysOfWeek: [Tue, Fri]`, times set.
- **Seats remaining** is computed at runtime, not stored.

`startTime`/`endTime` are stored as time-of-day. `priceCents`/`capacity` defaulting from the
parent class happens via a `class-instances` field hook/admin default (admin can override).

### `bookings` (changes)

- `class` relationship (→ classes) becomes `classInstance` (→ class-instances).
- `amountCents` mirrors the **instance** `priceCents`.
- All else unchanged: `person`, `customerName`, `customerEmail`, `customerPhone`,
  `status` (pending/paid/cancelled/refunded), `squarePaymentId`.

## Signup Flow & Occupancy

- **`src/lib/occupancy.ts`**: counts `pending`/`paid` bookings for a given **class instance**
  and compares against `instance.capacity`. `seatsRemaining(instanceId)` / `occupiedSeats(instanceId)`.
- **`src/services/booking.ts` (`createPaidBooking`)**: accepts a `classInstanceId`. Validates
  the instance exists and is `published`; reserves the seat with the existing concurrent-oversell
  guard (now per-instance); charges `instance.priceCents` via Square `chargeCard()`; writes the
  `paid` booking + `Payment` record; upserts the Person by email. Otherwise unchanged.
- **`src/app/api/bookings/route.ts`**: accepts `classInstanceId` instead of `classId`.
- **`BookingForm.tsx`**: posts the instance id; Square Web Payments flow untouched.
- A `cancelled` instance refuses new signups; `completed`/past instances are not shown publicly.

## ICS Calendar Attachment

- **`src/lib/ics.ts`**: builds an iCalendar event from an instance using the `ics` npm package.
  - `DTSTART`/`DTEND` from `startDate` + `startTime`/`endTime`.
  - Recurring instances: weekly `RRULE` with `BYDAY` from `daysOfWeek` and `UNTIL` from `endDate`;
    one `EXDATE` per skip date.
  - Single-session instances: a plain event, no `RRULE`.
  - `SUMMARY` = class title, `LOCATION` = instance location (or studio constant),
    `DESCRIPTION`, and a stable `UID` (e.g. derived from instance id).
  - Times are emitted in the fixed studio timezone `America/Los_Angeles`.
- **Email attachment support**: `src/lib/email.ts` (`sendEmail`) and the Payload Resend adapter
  (`src/lib/payload-email-adapter.ts`) gain an optional `attachments` field
  (`{ filename, content }`, as Resend supports). The booking confirmation email
  (`src/services/booking.ts`) attaches `class.ics`. Attachment generation is in-process.

## Instructor Admin View

- Add an **`instructor`** role to `Users.roles` (alongside admin / editor).
- **Access control** (instructors are read-only):
  - `class-instances` read: admin/editor → all; instructor → only `instructor == self`.
  - `bookings` read: admin/editor → all; instructor → only bookings whose instance's
    instructor is them (the roster). Implemented via a `where` constraint on the
    `classInstance.instructor` path.
  - Instructors get no create/update/delete on these collections and no access to
    payments / people / membership collections.
- **Roster**: the `roster` join field on `class-instances` shows enrolled bookings
  (name, email, status) when an instructor opens an instance. Booking rows already carry
  `customerName`/`customerEmail`, so no `people` access is needed.
- **Current / upcoming / past**: the instance list shows `startDate`/`endDate`/`status`
  columns, sortable and filterable, so instructors distinguish current vs. past classes.

## Public Pages & Calendar

- **`/classes`**: lists active classes; each card shows the soonest upcoming "next available"
  instance date and links to the class detail page.
- **`/classes/[slug]`**: class description/image + a list of its upcoming **published**
  instances (dates, time, instructor, seats left), each with a **Sign up** button leading to
  that instance's booking form (the existing Square form, keyed to the instance).
- **`/schedule`**: a **month calendar**. Each published instance's recurrence is expanded into
  individual session occurrences within the visible month, rendered as a chip in the day cell
  (class title + time). Clicking a chip goes to that instance's signup. Prev/next month
  navigation. Past/cancelled instances excluded.

## Testing

- **Vitest integration tests**:
  - Per-instance occupancy (`seatsRemaining`, oversell guard).
  - `createPaidBooking` against an instance (published required, price from instance, person upsert).
  - ICS generation: single-session vs. recurring-with-skip-dates output.
  - Instructor access control: instructor sees only own instances/rosters.
- **Playwright**: signup against an instance end-to-end (smoke).
- Implementation follows TDD (tests before implementation).

## Out of Scope

- Migration of existing class/booking data (pre-launch, none to migrate).
- A branded frontend instructor portal (admin view only; clean seam left for later).
- Member self-login, attendance tracking, multi-timezone studios.
- Per-instance default-schedule prefill on the class template (instructor enters schedule per instance).

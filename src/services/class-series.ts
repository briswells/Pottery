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

/** Next calendar day after `ymd` ("YYYY-MM-DD"), via plain UTC date-counter arithmetic. */
function nextYmd(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) throw new Error(`Invalid date "${ymd}" — use YYYY-MM-DD.`)
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1))
  return d.toISOString().slice(0, 10)
}

/**
 * True when a non-cancelled instance of this class already starts on that studio
 * calendar day. Matches by a half-open [studio midnight, next studio midnight) range
 * rather than exact instant equality, so instances stored at any other same-day
 * timestamp (legacy write paths, bare-date seeds, a hardcoded offset) still count
 * as a conflict.
 */
async function hasConflict(payload: Payload, classId: number, date: string): Promise<boolean> {
  const { totalDocs } = await payload.count({
    collection: 'class-instances',
    where: {
      and: [
        { class: { equals: classId } },
        { startDate: { greater_than_equal: studioMidnightIso(date) } },
        { startDate: { less_than: studioMidnightIso(nextYmd(date)) } },
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
    out.push({ date, conflict: await hasConflict(payload, input.classId, date) })
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
    try {
      // Re-check conflicts at create time so double-submits and stale previews
      // stay idempotent per (class, date).
      if (await hasConflict(payload, input.classId, date)) {
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
          startDate: studioMidnightIso(date),
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

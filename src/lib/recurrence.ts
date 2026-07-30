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

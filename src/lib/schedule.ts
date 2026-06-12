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

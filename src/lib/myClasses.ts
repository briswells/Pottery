/** The fields of a class instance that timing/sorting depends on. */
export interface TimedInstance {
  startDate: string
  endDate?: string | null
}

export interface SplitInstances<T> {
  upcoming: T[]
  past: T[]
}

/** Date-only key "YYYY-MM-DD" from a date-only ISO string (stored at UTC midnight). */
const dayKey = (iso: string): string => iso.slice(0, 10)

/** Today's date-only key in UTC, "YYYY-MM-DD" — matches how dates are stored. */
export function todayKey(now: Date): string {
  return now.toISOString().slice(0, 10)
}

/**
 * Split class instances into upcoming/current vs past relative to `today`
 * (a "YYYY-MM-DD" string). An instance is upcoming/current when its last meeting
 * (endDate, or startDate for a single-session class) is on or after today.
 * Upcoming is sorted soonest-first; past is sorted most-recent-first (both by startDate).
 * Lexicographic comparison of "YYYY-MM-DD" keys is equivalent to date order.
 */
export function splitByTiming<T extends TimedInstance>(instances: T[], today: string): SplitInstances<T> {
  const upcoming: T[] = []
  const past: T[] = []
  for (const inst of instances) {
    const lastDay = dayKey(inst.endDate || inst.startDate)
    if (lastDay >= today) upcoming.push(inst)
    else past.push(inst)
  }
  upcoming.sort((a, b) => dayKey(a.startDate).localeCompare(dayKey(b.startDate)))
  past.sort((a, b) => dayKey(b.startDate).localeCompare(dayKey(a.startDate)))
  return { upcoming, past }
}

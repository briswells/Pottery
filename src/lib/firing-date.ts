/** Date helpers for the pay-up-front custom firing schedule. */

/** The last Friday of the given month (year, 0-indexed monthIndex). */
export function lastFridayOfMonth(year: number, monthIndex: number): Date {
  const d = new Date(year, monthIndex + 1, 0) // last day of month
  d.setDate(d.getDate() - ((d.getDay() + 2) % 7)) // back off to Friday (5)
  return d
}

/**
 * The next scheduled firing date: the last Friday of `now`'s month, or — if
 * that date has already passed (compared date-only) — the last Friday of the
 * following month.
 */
export function nextFiringDate(now: Date = new Date()): Date {
  const candidate = lastFridayOfMonth(now.getFullYear(), now.getMonth())
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return candidate >= today ? candidate : lastFridayOfMonth(now.getFullYear(), now.getMonth() + 1)
}

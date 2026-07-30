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

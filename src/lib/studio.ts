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

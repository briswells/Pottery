import { createEvent, type EventAttributes } from 'ics'
import { parseHHMM, dateParts } from './schedule'
import { STUDIO_LOCATION } from './studio'

const pad = (n: number) => String(n).padStart(2, '0')

export interface IcsInstance {
  id: number | string
  startDate: string
  endDate?: string | null
  startTime: string
  endTime: string
  daysOfWeek?: string[] | null
  skipDates?: { date: string }[] | null
  location?: string | null
}

/** Build a VCALENDAR/VEVENT string for a class instance. Throws on invalid input. */
export function buildClassIcs(instance: IcsInstance, className: string): string {
  const [y, mo, d] = dateParts(instance.startDate)
  const [sh, sm] = parseHHMM(instance.startTime)
  const [eh, em] = parseHHMM(instance.endTime)
  const durationMin = eh * 60 + em - (sh * 60 + sm)
  if (durationMin <= 0) throw new Error('Class end time must be after the start time')

  const attrs: EventAttributes = {
    uid: `class-instance-${instance.id}@portsidepottery`,
    productId: 'portside-pottery/ics',
    title: className,
    location: instance.location || STUDIO_LOCATION,
    start: [y, mo, d, sh, sm],
    startInputType: 'local',
    startOutputType: 'local',
    duration: { hours: Math.floor(durationMin / 60), minutes: durationMin % 60 },
  }

  const days = instance.daysOfWeek ?? []
  let exdateLine = ''
  if (instance.endDate && days.length > 0) {
    const [endY, endMo, endD] = dateParts(instance.endDate)
    const until = `${endY}${pad(endMo)}${pad(endD)}T235959`
    attrs.recurrenceRule = `FREQ=WEEKLY;BYDAY=${days.join(',')};UNTIL=${until}`
    const skips = instance.skipDates ?? []
    if (skips.length > 0) {
      // The `ics` package emits exclusionDates in UTC (trailing Z), which would NOT
      // match our floating-local recurring occurrences (DTSTART has no timezone). So
      // build a floating EXDATE ourselves, using the same wall-clock time as the start,
      // and inject it after the RRULE line so excluded dates actually drop.
      // NOTE: this EXDATE line is not RFC 5545 line-folded; fine for the few skip
      // dates a class realistically has (a 75-octet line fits ~4 dates).
      const exdates = skips
        .map((s) => {
          const [ky, km, kd] = dateParts(s.date)
          return `${ky}${pad(km)}${pad(kd)}T${pad(sh)}${pad(sm)}00`
        })
        .join(',')
      exdateLine = `EXDATE:${exdates}`
    }
  }

  const { error, value } = createEvent(attrs)
  if (error || !value) throw new Error(`ICS generation failed: ${error?.message ?? 'unknown error'}`)
  if (exdateLine) return value.replace(/(RRULE:[^\r\n]*\r?\n)/, `$1${exdateLine}\r\n`)
  return value
}

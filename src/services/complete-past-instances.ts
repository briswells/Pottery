import type { Payload } from 'payload'

const TZ = 'America/Los_Angeles'

/** Today's date as YYYY-MM-DD in studio-local time. */
export function studioToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(now)
}

/**
 * Flip published class instances to `completed` once their last session day has
 * passed (endDate for multi-week runs, startDate for single-day classes).
 * Idempotent; drafts and cancelled instances are left alone.
 */
export async function completePastInstances(payload: Payload, now: Date = new Date()): Promise<number> {
  const today = `${studioToday(now)}T00:00:00.000Z`
  const { docs } = await payload.find({
    collection: 'class-instances',
    where: {
      and: [
        { status: { equals: 'published' } },
        {
          or: [
            { endDate: { less_than: today } },
            { and: [{ endDate: { exists: false } }, { startDate: { less_than: today } }] },
          ],
        },
      ],
    },
    limit: 500,
    depth: 0,
    overrideAccess: true,
  })
  for (const inst of docs) {
    await payload.update({
      collection: 'class-instances',
      id: inst.id,
      data: { status: 'completed' },
      depth: 0,
      overrideAccess: true,
    })
  }
  return docs.length
}

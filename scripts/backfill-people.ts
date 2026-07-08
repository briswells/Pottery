import { getPayload, type Payload } from 'payload'
import config from '@payload-config'
import { upsertPersonByEmail } from '../src/services/people'

/**
 * Link every booking and firing-request with no `person` to a Person, deduping by
 * email. Existing members are already people. Idempotent: rows already linked are
 * skipped, so re-running is a no-op. Returns counts for logging/asserting.
 */
export async function backfillPeople(payload: Payload): Promise<{ linked: number; failed: number }> {
  let linked = 0
  let failed = 0

  // Bookings without a person.
  const { docs: bookings, totalDocs: bookingsTotal } = await payload.find({
    collection: 'bookings', where: { person: { exists: false } }, limit: 100000, depth: 0, overrideAccess: true,
  })
  if (bookingsTotal > bookings.length) {
    console.warn(`WARNING: ${bookingsTotal - bookings.length} unlinked bookings were not fetched (limit reached) — re-run after increasing the limit.`)
  }
  for (const b of bookings) {
    try {
      const person = await upsertPersonByEmail({ payload }, { name: b.customerName, email: b.customerEmail, phone: b.customerPhone })
      await payload.update({ collection: 'bookings', id: b.id, overrideAccess: true, data: { person: person.id } })
      linked++
    } catch (e) {
      failed++
      console.error(`Backfill booking ${b.id} failed:`, e instanceof Error ? e.message : e)
    }
  }

  // Firing-requests without a person.
  const { docs: firings, totalDocs: firingsTotal } = await payload.find({
    collection: 'firing-requests', where: { person: { exists: false } }, limit: 100000, depth: 0, overrideAccess: true,
  })
  if (firingsTotal > firings.length) {
    console.warn(`WARNING: ${firingsTotal - firings.length} unlinked firing-requests were not fetched (limit reached) — re-run after increasing the limit.`)
  }
  for (const f of firings) {
    try {
      const person = await upsertPersonByEmail({ payload }, { name: f.name, email: f.email, phone: f.phone })
      await payload.update({ collection: 'firing-requests', id: f.id, overrideAccess: true, data: { person: person.id } })
      linked++
    } catch (e) {
      failed++
      console.error(`Backfill firing ${f.id} failed:`, e instanceof Error ? e.message : e)
    }
  }

  return { linked, failed }
}

// Allow `tsx scripts/backfill-people.ts` as a one-off CLI run.
if (process.argv[1] && process.argv[1].endsWith('backfill-people.ts')) {
  ;(async () => {
    const payload = await getPayload({ config: await config })
    const { linked, failed } = await backfillPeople(payload)
    console.log(`Backfill complete. Linked ${linked}, failed ${failed}.`)
    process.exit(failed > 0 ? 1 : 0)
  })()
}

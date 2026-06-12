import { getPayload } from 'payload'
import config from '@payload-config'
import { getSquareClient, SQUARE_LOCATION_ID } from '../src/lib/square'
import { squareMembershipGateway } from '../src/lib/membership-gateway'
import { ensureMemberFromSubscription } from '../src/services/square-member-sync'
import { syncSquarePlans } from '../src/services/sync-square-plans'

async function run() {
  const payload = await getPayload({ config: await config })
  const client = getSquareClient()

  // Find subscriptions at our location.
  // TODO: paginate via search cursor if subscriptions exceed one page
  const search = await client.subscriptions.search({
    query: { filter: { locationIds: [SQUARE_LOCATION_ID()] } },
  })
  const subscriptions = search.subscriptions ?? []

  // Sync the plan mirror once up front; the per-subscription service then runs
  // with syncPlansOnMiss:false so a bulk import never re-syncs per row.
  await syncSquarePlans({ payload, gateway: squareMembershipGateway })

  let processed = 0,
    skipped = 0,
    failed = 0

  for (const s of subscriptions) {
    if (!s.id) {
      skipped++
      continue
    }
    try {
      // ensureMemberFromSubscription maps the plan, finds-or-creates the Person,
      // and promotes them — the same path the subscription.created webhook uses.
      // It returns null for subscriptions we skip (no customer/plan, unknown plan,
      // already linked, or a conflicting existing subscription). We can't tell
      // "already existed" from "newly created" by the return alone, so count
      // non-null as processed and null as skipped.
      const person = await ensureMemberFromSubscription(
        { payload, gateway: squareMembershipGateway, syncPlansOnMiss: false },
        { id: s.id, customerId: s.customerId, planVariationId: s.planVariationId, status: s.status, startDate: s.startDate },
      )
      if (person) processed++
      else skipped++
    } catch (e) {
      failed++
      console.error(`Failed to import subscription ${s.id}:`, e instanceof Error ? e.message : e)
    }
  }

  // The search only returned the first page; warn if more exist so an operator
  // isn't misled by "Import complete" on a large account.
  if (search.cursor) {
    console.warn('WARNING: more subscriptions exist beyond the first page — pagination is not implemented, so some members were NOT imported.')
  }

  console.log(`Import complete. Processed ${processed}, skipped ${skipped}, failed ${failed}.`)
  process.exit(failed > 0 ? 1 : 0)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})

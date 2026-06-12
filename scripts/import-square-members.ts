import { getPayload } from 'payload'
import config from '@payload-config'
import { getSquareClient, SQUARE_LOCATION_ID } from '../src/lib/square'
import { squareMembershipGateway } from '../src/lib/membership-gateway'
import { syncSquarePlans } from '../src/services/sync-square-plans'

type MemberStatus = 'active' | 'past_due' | 'paused' | 'cancelled'

async function run() {
  const payload = await getPayload({ config: await config })
  const client = getSquareClient()

  // Make sure the Plans mirror is current, then map each Square plan variation id
  // to our membership-plans record so imported members are linked to their plan.
  await syncSquarePlans({ payload, gateway: squareMembershipGateway })
  const { docs: plans } = await payload.find({
    collection: 'membership-plans',
    where: { kind: { equals: 'square' } },
    limit: 1000,
    overrideAccess: true,
  })
  const planByVariation = new Map<string, number>()
  for (const p of plans) if (p.squarePlanVariationId) planByVariation.set(p.squarePlanVariationId, p.id)

  // Find subscriptions at our location.
  // TODO: paginate via search cursor if subscriptions exceed one page
  const search = await client.subscriptions.search({
    query: { filter: { locationIds: [SQUARE_LOCATION_ID()] } },
  })
  const subscriptions = search.subscriptions ?? []
  let created = 0,
    skipped = 0,
    failed = 0

  const statusMap: Record<string, MemberStatus> = {
    ACTIVE: 'active',
    PAUSED: 'paused',
    CANCELED: 'cancelled',
    DEACTIVATED: 'cancelled',
  }

  for (const sub of subscriptions) {
    if (!sub.customerId || !sub.id || !sub.planVariationId) {
      skipped++
      continue
    }
    // Only import subscriptions on one of our known membership plans, and capture
    // which plan to link the member to.
    const planId = planByVariation.get(sub.planVariationId)
    if (!planId) {
      skipped++
      continue
    }

    const existing = await payload.find({
      collection: 'people',
      where: { squareSubscriptionId: { equals: sub.id } },
      limit: 1,
      overrideAccess: true,
    })
    if (existing.totalDocs > 0) {
      skipped++
      continue
    }

    const customerRes = await client.customers.get({ customerId: sub.customerId })
    const c = customerRes.customer
    const email = c?.emailAddress ?? `${sub.customerId}@imported.portsidepottery.com`
    const name = [c?.givenName, c?.familyName].filter(Boolean).join(' ') || 'Imported Member'

    try {
      await payload.create({
        collection: 'people',
        overrideAccess: true,
        // These members are ALREADY provisioned in Square — we're syncing FROM
        // Square. Mark the write as webhook-sourced so the reconcile hook skips:
        // otherwise it would treat the (plan + existing subscription) as a plan
        // change and cancel + recreate the live subscription.
        context: { fromSquareWebhook: true },
        data: {
          name,
          email,
          phone: c?.phoneNumber,
          plan: planId,
          status: statusMap[sub.status ?? 'ACTIVE'] ?? 'active',
          joinedDate: sub.startDate,
          squareCustomerId: sub.customerId,
          squareSubscriptionId: sub.id,
          subscriptionStatus: sub.status,
        },
      })
      created++
    } catch (e) {
      // Most likely a unique-email collision with an existing member (member
      // emails are unique). Skip and keep going rather than aborting the run.
      failed++
      console.error(`Failed to import subscription ${sub.id} (${email}):`, e instanceof Error ? e.message : e)
    }
  }

  // The search only returned the first page; warn if more exist so an operator
  // isn't misled by "Import complete" on a large account.
  if (search.cursor) {
    console.warn('WARNING: more subscriptions exist beyond the first page — pagination is not implemented, so some members were NOT imported.')
  }

  console.log(`Import complete. Created ${created}, skipped ${skipped}, failed ${failed}.`)
  process.exit(failed > 0 ? 1 : 0)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})

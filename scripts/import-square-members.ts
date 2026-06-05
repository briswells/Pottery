import { randomBytes } from 'crypto'
import { getPayload } from 'payload'
import config from '@payload-config'
import { getSquareClient, SQUARE_LOCATION_ID } from '../src/lib/square'

const PLAN_VARIATION_ID = process.env.SQUARE_MEMBERSHIP_PLAN_VARIATION_ID

type MemberStatus = 'active' | 'past_due' | 'paused' | 'cancelled'

async function run() {
  const payload = await getPayload({ config: await config })
  const client = getSquareClient()

  // Find subscriptions at our location (optionally filtered to our plan).
  // TODO: paginate via search cursor if subscriptions exceed one page
  const search = await client.subscriptions.search({
    query: { filter: { locationIds: [SQUARE_LOCATION_ID()] } },
  })
  const subscriptions = search.subscriptions ?? []
  let created = 0,
    skipped = 0

  const statusMap: Record<string, MemberStatus> = {
    ACTIVE: 'active',
    PAUSED: 'paused',
    CANCELED: 'cancelled',
    DEACTIVATED: 'cancelled',
  }

  for (const sub of subscriptions) {
    if (PLAN_VARIATION_ID && sub.planVariationId !== PLAN_VARIATION_ID) {
      skipped++
      continue
    }
    if (!sub.customerId || !sub.id) {
      skipped++
      continue
    }

    const existing = await payload.find({
      collection: 'members',
      where: { squareSubscriptionId: { equals: sub.id } },
      limit: 1,
    })
    if (existing.totalDocs > 0) {
      skipped++
      continue
    }

    const customerRes = await client.customers.get({ customerId: sub.customerId })
    const c = customerRes.customer
    const email = c?.emailAddress ?? `${sub.customerId}@imported.portsidepottery.com`
    const name = [c?.givenName, c?.familyName].filter(Boolean).join(' ') || 'Imported Member'

    await payload.create({
      collection: 'members',
      overrideAccess: true,
      data: {
        name,
        email,
        password: randomBytes(24).toString('hex'),
        phone: c?.phoneNumber,
        status: statusMap[sub.status ?? 'ACTIVE'] ?? 'active',
        joinedDate: sub.startDate,
        squareCustomerId: sub.customerId,
        squareSubscriptionId: sub.id,
        subscriptionStatus: sub.status,
      },
    })
    created++
  }

  console.log(`Import complete. Created ${created}, skipped ${skipped}.`)
  process.exit(0)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})

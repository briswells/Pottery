import type { Payload } from 'payload'
import type { MembershipGateway } from '../lib/membership-gateway'
import { syncSquarePlans } from './sync-square-plans'
import { upsertPersonByEmail } from './people'
import type { Person } from '../payload-types'

/** Square subscription status → our membership status. Shared by the webhook + import. */
export const SQUARE_SUBSCRIPTION_STATUS_MAP: Record<string, Person['status']> = {
  ACTIVE: 'active',
  PAUSED: 'paused',
  CANCELED: 'cancelled',
  DEACTIVATED: 'cancelled',
}

export interface SquareSubscriptionInput {
  id: string
  customerId?: string
  planVariationId?: string
  status?: string
  startDate?: string
}

export interface EnsureMemberDeps {
  payload: Payload
  gateway: MembershipGateway
}

async function findPlanByVariation(payload: Payload, variationId: string): Promise<number | null> {
  const { docs } = await payload.find({
    collection: 'membership-plans',
    where: { squarePlanVariationId: { equals: variationId } },
    limit: 1,
    overrideAccess: true,
  })
  return (docs[0]?.id as number | undefined) ?? null
}

/**
 * Ensure a member exists for this Square subscription. Maps the plan variation to
 * a known plan (syncing once on a miss), finds-or-creates the Person by the Square
 * customer's email, then promotes them to a member. Marked `fromSquareWebhook` so
 * the reconcile hook never tries to create a NEW Square subscription. Returns the
 * Person, or null when skipped (missing ids, or a plan we don't track).
 */
export async function ensureMemberFromSubscription(
  { payload, gateway }: EnsureMemberDeps,
  sub: SquareSubscriptionInput,
): Promise<Person | null> {
  const existingBySub = await payload.find({
    collection: 'people',
    where: { squareSubscriptionId: { equals: sub.id } },
    limit: 1,
    overrideAccess: true,
  })
  if (existingBySub.docs[0]) return existingBySub.docs[0] as Person

  if (!sub.customerId || !sub.planVariationId) {
    console.warn(`Square subscription ${sub.id} skipped: missing customerId or planVariationId.`)
    return null
  }

  let planId = await findPlanByVariation(payload, sub.planVariationId)
  if (planId == null) {
    await syncSquarePlans({ payload, gateway })
    planId = await findPlanByVariation(payload, sub.planVariationId)
  }
  if (planId == null) {
    console.warn(`Square subscription ${sub.id} skipped: plan variation ${sub.planVariationId} is not a known membership plan.`)
    return null
  }

  const customer = await gateway.getCustomer(sub.customerId)
  const email = customer?.email ?? `${sub.customerId}@imported.portsidepottery.com`
  // upsertPersonByEmail won't rename an existing person — this fallback only
  // names a brand-new person when Square returned no name.
  const name = [customer?.givenName, customer?.familyName].filter(Boolean).join(' ') || 'Imported Member'

  const person = await upsertPersonByEmail({ payload }, { name, email, phone: customer?.phone, squareCustomerId: sub.customerId })

  // A person matched by email who already has a DIFFERENT live subscription is a
  // conflict (e.g. cancel-and-resubscribe, or two Square subs sharing an email).
  // Don't silently overwrite their subscription link — log and leave it to staff.
  if (person.squareSubscriptionId && person.squareSubscriptionId !== sub.id) {
    console.warn(
      `Square subscription ${sub.id} skipped: person ${person.id} already has a different subscription ${person.squareSubscriptionId}.`,
    )
    return null
  }

  const status = SQUARE_SUBSCRIPTION_STATUS_MAP[sub.status ?? 'ACTIVE'] ?? 'active'
  const promoted = await payload.update({
    collection: 'people',
    id: person.id,
    overrideAccess: true,
    depth: 0,
    context: { fromSquareWebhook: true },
    data: {
      plan: planId,
      status,
      squareSubscriptionId: sub.id,
      subscriptionStatus: sub.status,
      ...(person.joinedDate ? {} : { joinedDate: sub.startDate }),
    },
  })
  return promoted as Person
}

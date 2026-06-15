import type { Payload } from 'payload'
import type { MembershipGateway } from '../lib/membership-gateway'
import { syncSquarePlans } from './sync-square-plans'
import { upsertPersonByEmail } from './people'
import type { Person } from '../payload-types'

/** Square subscription status → our membership status. Used by the service and the subscription.updated webhook branch. */
export const SQUARE_SUBSCRIPTION_STATUS_MAP: Record<string, Person['status']> = {
  ACTIVE: 'active',
  PAUSED: 'paused',
  CANCELED: 'cancelled',
  DEACTIVATED: 'cancelled',
}

/**
 * Map a Square subscription's raw status to our membership status. A subscription
 * with a `canceled_date` is treated as cancelled even while Square still reports it
 * ACTIVE until that date — otherwise a scheduled (e.g. self-serve) cancellation
 * would show as active for the rest of the billing period, and the very webhook that
 * scheduling it triggers would revert a member we just cancelled back to active.
 * Returns undefined for an unrecognized status so callers can keep the existing value.
 */
export function mapSubscriptionStatus(
  rawStatus: string | undefined,
  canceledDate?: string | null,
): Person['status'] | undefined {
  if (canceledDate) return 'cancelled'
  return rawStatus ? SQUARE_SUBSCRIPTION_STATUS_MAP[rawStatus] : undefined
}

export interface SquareSubscriptionInput {
  id: string
  customerId?: string
  planVariationId?: string
  status?: string
  startDate?: string
  /** Set by Square once a cancellation is scheduled; the sub stays ACTIVE until then. */
  canceledDate?: string
}

export interface EnsureMemberDeps {
  payload: Payload
  gateway: MembershipGateway
  /** Re-sync the plan mirror once on a plan-variation miss. Default true (webhook).
   *  Bulk callers (the import) sync upfront and pass false to avoid a per-row sync. */
  syncPlansOnMiss?: boolean
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
  { payload, gateway, syncPlansOnMiss = true }: EnsureMemberDeps,
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
  if (planId == null && syncPlansOnMiss) {
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

  const status = mapSubscriptionStatus(sub.status, sub.canceledDate) ?? 'active'
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

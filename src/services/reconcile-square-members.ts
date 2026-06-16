import type { Payload } from 'payload'
import type { MembershipGateway } from '../lib/membership-gateway'
import { getSquareClient, SQUARE_LOCATION_ID } from '../lib/square'
import { ensureMemberFromSubscription } from './square-member-sync'
import { syncSquarePlans } from './sync-square-plans'

export interface ReconcileMembersDeps {
  payload: Payload
  gateway: MembershipGateway
  /** Sync the plan mirror once up front. Default true. Pass false when the caller
   *  has just synced plans (e.g. boot, where onInit syncs plans before this runs). */
  syncPlans?: boolean
}

export interface ReconcileMembersResult {
  processed: number
  skipped: number
  failed: number
  pages: number
}

/**
 * Reconcile our member records against Square subscriptions at our location.
 * Paginates through every subscription (the manual import historically read only
 * the first page) and runs the same idempotent path the subscription webhook uses,
 * so it is safe to run on every boot and on a timer: it creates members missed
 * during downtime and never duplicates existing ones (keyed by subscription id).
 */
export async function reconcileSquareMembers(
  { payload, gateway, syncPlans = true }: ReconcileMembersDeps,
): Promise<ReconcileMembersResult> {
  const client = getSquareClient()

  // Map the plan mirror once up front; per-subscription mapping then runs with
  // syncPlansOnMiss:false so a bulk pass never re-syncs plans per row.
  if (syncPlans) await syncSquarePlans({ payload, gateway })

  let cursor: string | undefined
  let processed = 0
  let skipped = 0
  let failed = 0
  let pages = 0

  do {
    const search = await client.subscriptions.search({
      cursor,
      query: { filter: { locationIds: [SQUARE_LOCATION_ID()] } },
    })
    pages++

    for (const s of search.subscriptions ?? []) {
      if (!s.id) {
        skipped++
        continue
      }
      try {
        const person = await ensureMemberFromSubscription(
          { payload, gateway, syncPlansOnMiss: false },
          {
            id: s.id,
            customerId: s.customerId,
            planVariationId: s.planVariationId,
            status: s.status,
            startDate: s.startDate,
            canceledDate: s.canceledDate ?? undefined,
          },
        )
        if (person) processed++
        else skipped++
      } catch (e) {
        failed++
        payload.logger.error(
          `Square member reconcile: subscription ${s.id} failed: ${e instanceof Error ? e.message : e}`,
        )
      }
    }

    cursor = search.cursor ?? undefined
  } while (cursor)

  return { processed, skipped, failed, pages }
}

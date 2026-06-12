import type { CollectionBeforeDeleteHook } from 'payload'
import { getSquareClient } from '../lib/square'

/**
 * Before a member is deleted, cancel their Square subscription so billing stops —
 * the same effect as setting their status to Cancelled. Cancels an ACTIVE or
 * PAUSED subscription; the Square customer record is left intact.
 *
 * This runs BEFORE the row is removed and rethrows on a Square failure, which
 * aborts the delete. That guarantees we never end up with a deleted member whose
 * subscription is still live and billing — fix the Square issue and retry.
 */
export const cancelSquareSubscriptionOnDelete: CollectionBeforeDeleteHook = async ({ id, req }) => {
  const member = (await req.payload.findByID({
    collection: 'people',
    id,
    req,
    overrideAccess: true,
  })) as { squareSubscriptionId?: string | null; status?: string }

  // Nothing to cancel: no linked subscription, or already cancelled (the status
  // hook already cancelled it in Square — a second cancel would error).
  if (!member?.squareSubscriptionId || member.status === 'cancelled') return

  try {
    await getSquareClient().subscriptions.cancel({ subscriptionId: member.squareSubscriptionId })
  } catch (e) {
    console.error(`Failed to cancel Square subscription on member ${id} delete:`, e)
    throw new Error(
      'Could not cancel the Square subscription, so the member was not deleted. Try again, or cancel it in Square first.',
    )
  }
}

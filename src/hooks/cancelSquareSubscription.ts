import type { CollectionAfterChangeHook } from 'payload'
import { getSquareClient } from '../lib/square'

/** When a member is set to cancelled/paused in the admin, reflect it in Square. */
export const cancelSquareSubscription: CollectionAfterChangeHook = async ({ doc, previousDoc, operation }) => {
  if (operation !== 'update') return doc
  const becameCancelled = doc.status === 'cancelled' && previousDoc?.status !== 'cancelled'
  const becamePaused = doc.status === 'paused' && previousDoc?.status !== 'paused'
  if (!doc.squareSubscriptionId || (!becameCancelled && !becamePaused)) return doc

  const client = getSquareClient()
  try {
    if (becameCancelled) await client.subscriptions.cancel({ subscriptionId: doc.squareSubscriptionId })
    if (becamePaused) await client.subscriptions.pause({ subscriptionId: doc.squareSubscriptionId })
  } catch (e) {
    // Surface but don't crash the admin save; staff can retry.
    console.error('Failed to propagate membership status to Square:', e)
  }
  return doc
}

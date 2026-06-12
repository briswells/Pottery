import type { CollectionAfterChangeHook } from 'payload'
import { squareMembershipGateway } from '../lib/membership-gateway'
import { reconcileMemberPlan } from '../services/membership'
import type { Person } from '../payload-types'

const planId = (p: unknown): unknown => (p && typeof p === 'object' ? (p as { id: unknown }).id : p)

/**
 * Keep a member's Square subscription in sync with their assigned plan. Runs on
 * create, and on update only when the plan changed. Skips our own write-back and
 * webhook-driven changes.
 */
export const reconcileMemberSubscription: CollectionAfterChangeHook<Person> = async ({ doc, previousDoc, operation, req }) => {
  if (req?.context?.fromMemberHook) return doc
  if (req?.context?.fromSquareWebhook) return doc
  const planChanged = planId(doc.plan) !== planId(previousDoc?.plan)
  if (operation !== 'create' && !planChanged) return doc

  try {
    await reconcileMemberPlan(
      { payload: req.payload, gateway: squareMembershipGateway, req },
      { member: doc as any, previousDoc: previousDoc as any },
    )
  } catch (e) {
    console.error(`Person ${doc.id} reconcile hook error:`, e)
  }
  return doc
}

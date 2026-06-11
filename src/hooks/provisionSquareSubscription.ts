import type { CollectionAfterChangeHook } from 'payload'
import type { Member } from '../payload-types'

/**
 * Superseded by reconcileMemberPlan (wired into a new hook in the next task).
 * Gutted to a no-op so the old provisionMemberSubscription service export can be
 * removed without breaking tsc; this file is deleted in the next task.
 */
export const provisionSquareSubscription: CollectionAfterChangeHook<Member> = async ({ doc }) => {
  return doc
}

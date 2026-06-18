import type { CollectionAfterChangeHook } from 'payload'
import type { Person } from '../payload-types'

/** Square statuses that mean the subscription has truly ended (not a scheduled cancel). */
const ENDED_SQUARE_STATUSES = ['CANCELED', 'DEACTIVATED']

function relId(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === 'object') return (v as { id?: number }).id ?? null
  return typeof v === 'number' ? v : Number(v) || null
}

/**
 * Keep `shelves.assignedMember` in sync with the member's `shelf` selection
 * (the member page is where shelves are assigned), and free the shelf when the
 * membership truly ends in Square. Writes pass `req` (transaction-safe) and set
 * `fromShelfSync` so re-entry is a no-op.
 */
export const syncShelfAssignment: CollectionAfterChangeHook<Person> = async ({ doc, previousDoc, operation, req }) => {
  if (operation !== 'create' && operation !== 'update') return doc
  if (req?.context?.fromShelfSync) return doc
  const payload = req.payload

  const shelfId = relId(doc.shelf)
  const prevShelfId = relId(previousDoc?.shelf)

  // (A) Free the shelf on true Square expiry (raw status edge into CANCELED/DEACTIVATED).
  const prevEnded = ENDED_SQUARE_STATUSES.includes(previousDoc?.subscriptionStatus ?? '')
  const nowEnded = ENDED_SQUARE_STATUSES.includes(doc.subscriptionStatus ?? '')
  if (shelfId && nowEnded && !prevEnded) {
    await payload.update({ collection: 'people', id: doc.id, overrideAccess: true, req, context: { fromShelfSync: true }, data: { shelf: null } })
    await payload.update({ collection: 'shelves', id: shelfId, overrideAccess: true, req, context: { fromShelfSync: true }, data: { assignedMember: null } })
    return { ...doc, shelf: null }
  }

  // (B) Sync assignedMember to the chosen shelf.
  if (shelfId === prevShelfId) return doc

  if (prevShelfId) {
    await payload.update({ collection: 'shelves', id: prevShelfId, overrideAccess: true, req, context: { fromShelfSync: true }, data: { assignedMember: null } })
  }
  if (shelfId) {
    const shelf = await payload.findByID({ collection: 'shelves', id: shelfId, depth: 0, overrideAccess: true, req })
    const priorHolder = relId(shelf.assignedMember)
    if (priorHolder && priorHolder !== doc.id) {
      await payload.update({ collection: 'people', id: priorHolder, overrideAccess: true, req, context: { fromShelfSync: true }, data: { shelf: null } })
    }
    await payload.update({ collection: 'shelves', id: shelfId, overrideAccess: true, req, context: { fromShelfSync: true }, data: { assignedMember: doc.id } })
  }

  return doc
}

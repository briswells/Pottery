import type { Payload } from 'payload'

/** Photos attached to completed firing requests are deleted this long after completion. */
export const FIRING_MEDIA_TTL_MS = 14 * 24 * 60 * 60 * 1000 // 2 weeks

/** Photos attached to cancelled firing requests are deleted this long after cancellation.
 * Cancelled requests have no completedAt, so we use updatedAt as the age signal.
 * A later staff edit just delays cleanup harmlessly. */
export const CANCELLED_FIRING_MEDIA_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 1 week

export interface ExpireFiringMediaResult {
  deleted: number
  failed: number
}

/**
 * Delete all uploaded photos on any firing request that has been "completed" for
 * more than two weeks, or "cancelled" for more than one week. All photos in the
 * request are deleted: the array is detached first so a deleted media row never
 * leaves a dangling reference. Each firing photo is dedicated to its request
 * (uploaded via /api/firings), so deleting is safe.
 * Idempotent: once the photos are gone the request no longer matches the query.
 */
export async function expireFiringRequestMedia(payload: Payload): Promise<ExpireFiringMediaResult> {
  const completedCutoff = new Date(Date.now() - FIRING_MEDIA_TTL_MS).toISOString()
  const cancelledCutoff = new Date(Date.now() - CANCELLED_FIRING_MEDIA_TTL_MS).toISOString()

  // Query completed requests older than 2 weeks
  const { docs: completedDocs } = await payload.find({
    collection: 'firing-requests',
    where: {
      and: [
        { status: { equals: 'completed' } },
        { completedAt: { less_than_equal: completedCutoff } },
        { photos: { exists: true } },
      ],
    },
    depth: 0,
    limit: 500,
    overrideAccess: true,
  })

  // Query cancelled requests older than 1 week (using updatedAt as age signal)
  const { docs: cancelledDocs } = await payload.find({
    collection: 'firing-requests',
    where: {
      and: [
        { status: { equals: 'cancelled' } },
        { updatedAt: { less_than_equal: cancelledCutoff } },
        { photos: { exists: true } },
      ],
    },
    depth: 0,
    limit: 500,
    overrideAccess: true,
  })

  // Process both sets of docs with the same loop
  const docs = [...completedDocs, ...cancelledDocs]

  let deleted = 0
  let failed = 0

  for (const r of docs) {
    const photoIds = (r.photos ?? [])
      .map((p) => (typeof p === 'object' && p ? p.id : p))
      .filter((id): id is number => id != null)
    if (photoIds.length === 0) continue
    try {
      await payload.update({
        collection: 'firing-requests',
        id: r.id,
        data: { photos: [] },
        overrideAccess: true,
      })
      for (const photoId of photoIds) {
        await payload.delete({ collection: 'media', id: photoId, overrideAccess: true })
      }
      deleted++
    } catch (e) {
      failed++
      payload.logger.error(
        `Firing media expiry failed for request ${r.id}: ${e instanceof Error ? e.message : e}`,
      )
    }
  }

  return { deleted, failed }
}

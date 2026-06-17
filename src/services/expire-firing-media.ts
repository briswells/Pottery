import type { Payload } from 'payload'

/** Photos attached to completed firing requests are deleted this long after completion. */
export const FIRING_MEDIA_TTL_MS = 14 * 24 * 60 * 60 * 1000 // 2 weeks

export interface ExpireFiringMediaResult {
  deleted: number
  failed: number
}

/**
 * Delete the uploaded photo on any firing request that has been "completed" for
 * more than two weeks. The photo is detached from the request first so a deleted
 * media row never leaves a dangling reference. Each firing photo is dedicated to
 * its request (uploaded via /api/firings), so deleting it is safe. Idempotent:
 * once the photo is gone the request no longer matches.
 */
export async function expireFiringRequestMedia(payload: Payload): Promise<ExpireFiringMediaResult> {
  const cutoff = new Date(Date.now() - FIRING_MEDIA_TTL_MS).toISOString()

  const { docs } = await payload.find({
    collection: 'firing-requests',
    where: {
      and: [
        { status: { equals: 'completed' } },
        { completedAt: { less_than_equal: cutoff } },
        { photo: { exists: true } },
      ],
    },
    depth: 0,
    limit: 500,
    overrideAccess: true,
  })

  let deleted = 0
  let failed = 0

  for (const r of docs) {
    const photoId = typeof r.photo === 'object' && r.photo ? r.photo.id : r.photo
    if (!photoId) continue
    try {
      await payload.update({
        collection: 'firing-requests',
        id: r.id,
        data: { photo: null },
        overrideAccess: true,
        context: { fromFiringHook: true },
      })
      await payload.delete({ collection: 'media', id: photoId, overrideAccess: true })
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

import type { Payload } from 'payload'
import type { Media } from '../payload-types'

/**
 * Deterministic per-hour shuffle: the order is stable within a clock hour and
 * reshuffles when the hour rolls over. Seeded so every request inside the same
 * hour produces the same order (no per-request churn), using a small mulberry32
 * PRNG with a Fisher–Yates pass.
 */
function hourlyShuffle<T>(items: T[]): T[] {
  const arr = [...items]
  let seed = Math.floor(Date.now() / 3_600_000) >>> 0
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

/**
 * The public gallery: every Media item flagged `includeInGallery`, reshuffled
 * each hour. Pass a limit for previews (e.g. the homepage strip).
 */
export async function getGalleryMedia(payload: Payload, limit = 200): Promise<Media[]> {
  const { docs } = await payload.find({
    collection: 'media',
    where: { includeInGallery: { equals: true } },
    limit,
    depth: 0,
    overrideAccess: true,
  })
  return hourlyShuffle(docs as Media[])
}

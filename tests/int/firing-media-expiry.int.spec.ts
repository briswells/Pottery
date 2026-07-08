// The default jsdom test environment gives Node `Buffer`s a cross-realm
// `Uint8Array` that fails `instanceof` checks inside `file-type` (used by
// Payload's upload validation), so a real file upload always fails there.
// Force node for this file, which actually creates media with file data.
// @vitest-environment node
import { describe, it, expect, afterAll } from 'vitest'
import { getTestPayload } from './helpers'
import { expireFiringRequestMedia, FIRING_MEDIA_TTL_MS, CANCELLED_FIRING_MEDIA_TTL_MS } from '../../src/services/expire-firing-media'

async function mkPhoto(p: any) {
  // 1x1 png buffer — media create needs a real file
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
  return p.create({ collection: 'media', overrideAccess: true, data: { alt: 'firing-expiry-test' }, file: { data: png, mimetype: 'image/png', name: `firing-expiry-${Date.now()}-${Math.random()}.png`, size: png.length } })
}

describe('firing-media-expiry', () => {
  it('deletes photos on requests completed 15+ days ago', async () => {
    const p = await getTestPayload()

    // Create two photos
    const ph1 = await mkPhoto(p)
    const ph2 = await mkPhoto(p)

    // Create a firing request with the photos (starts as pending)
    const fr = await p.create({
      collection: 'firing-requests',
      overrideAccess: true,
      data: {
        name: 'Expiry Test 1',
        email: 'expiry-test-1@test.local',
        description: 'test request',
        halfShelves: 2,
        amountCents: 5000,
        stonewareConfirmed: true,
        status: 'pending',
        photos: [ph1.id, ph2.id],
      },
    })

    // Update to completed — this sets completedAt to now via the hook
    await p.update({
      collection: 'firing-requests',
      id: fr.id,
      overrideAccess: true,
      data: { status: 'completed' },
    })

    // Update again to backdate completedAt — since status is already 'completed',
    // the hook won't trigger and the backdated value will stick
    const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString()
    const updated = await p.update({
      collection: 'firing-requests',
      id: fr.id,
      overrideAccess: true,
      context: { fromFiringHook: true },
      data: { completedAt: fifteenDaysAgo },
    })

    // Verify the backdated value is actually set
    expect(updated.completedAt).toBeDefined()
    expect(new Date(updated.completedAt as string).getTime()).toBeLessThan(Date.now() - 14 * 24 * 60 * 60 * 1000)

    // Verify the photos exist before expiry
    const mediaIds = [ph1.id, ph2.id]
    for (const mid of mediaIds) {
      const media = await p.findByID({ collection: 'media', id: mid, overrideAccess: true })
      expect(media).toBeDefined()
    }

    // Run the expiry service
    const result = await expireFiringRequestMedia(p)

    // Verify result
    expect(result.deleted).toBeGreaterThanOrEqual(1)
    expect(result.failed).toBe(0)

    // Verify the photos are now deleted
    for (const mid of mediaIds) {
      await expect(p.findByID({ collection: 'media', id: mid, overrideAccess: true }))
        .rejects.toThrow()
    }

    // Verify the request's photos array is now empty
    const frAfter = await p.findByID({ collection: 'firing-requests', id: fr.id, overrideAccess: true })
    expect(frAfter.photos).toEqual([])
  })

  it('keeps photos on requests completed less than 15 days ago', async () => {
    const p = await getTestPayload()

    // Create two photos
    const ph1 = await mkPhoto(p)
    const ph2 = await mkPhoto(p)

    // Create a firing request with the photos
    const fr = await p.create({
      collection: 'firing-requests',
      overrideAccess: true,
      data: {
        name: 'Expiry Test 2',
        email: 'expiry-test-2@test.local',
        description: 'test request',
        halfShelves: 2,
        amountCents: 5000,
        stonewareConfirmed: true,
        status: 'pending',
        photos: [ph1.id, ph2.id],
      },
    })

    // Update to completed
    await p.update({
      collection: 'firing-requests',
      id: fr.id,
      overrideAccess: true,
      data: { status: 'completed' },
    })

    // Backdate to 1 day ago (still within the 14-day window)
    const oneDayAgo = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString()
    await p.update({
      collection: 'firing-requests',
      id: fr.id,
      overrideAccess: true,
      context: { fromFiringHook: true },
      data: { completedAt: oneDayAgo },
    })

    // Run the expiry service
    const result = await expireFiringRequestMedia(p)

    // Verify the request was not processed (not deleted)
    expect(result.failed).toBe(0)

    // Verify the photos still exist
    const frAfter = await p.findByID({ collection: 'firing-requests', id: fr.id, overrideAccess: true })
    expect((frAfter.photos as any[]).length).toBe(2)

    for (const photoId of [ph1.id, ph2.id]) {
      const media = await p.findByID({ collection: 'media', id: photoId, overrideAccess: true })
      expect(media).toBeDefined()
    }
  })

  it('deletes photos on cancelled requests updated 8+ days ago', async () => {
    const p = await getTestPayload()

    // Create a photo
    const ph1 = await mkPhoto(p)

    // Create a firing request with the photo (starts as pending)
    const fr = await p.create({
      collection: 'firing-requests',
      overrideAccess: true,
      data: {
        name: 'Cancelled Expiry Test 1',
        email: 'cancelled-expiry-test-1@test.local',
        description: 'test cancelled request',
        halfShelves: 2,
        amountCents: 5000,
        stonewareConfirmed: true,
        status: 'pending',
        photos: [ph1.id],
      },
    })

    // Update to cancelled — this sets updatedAt to now via the hook
    await p.update({
      collection: 'firing-requests',
      id: fr.id,
      overrideAccess: true,
      data: { status: 'cancelled' },
    })

    // Backdate updatedAt to 8 days ago using raw SQL (payload.update would overwrite it)
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
    const pool = (p.db as any).pool
    await pool.query(
      'UPDATE firing_requests SET updated_at = $1 WHERE id = $2',
      [eightDaysAgo, fr.id],
    )

    // Verify the backdated value is actually set
    const beforeExpiry = await p.findByID({ collection: 'firing-requests', id: fr.id, overrideAccess: true })
    expect(beforeExpiry.updatedAt).toBeDefined()
    expect(new Date(beforeExpiry.updatedAt as string).getTime()).toBeLessThan(Date.now() - 7 * 24 * 60 * 60 * 1000)

    // Verify the photo exists before expiry
    const media = await p.findByID({ collection: 'media', id: ph1.id, overrideAccess: true })
    expect(media).toBeDefined()

    // Run the expiry service
    const result = await expireFiringRequestMedia(p)

    // Verify result
    expect(result.deleted).toBeGreaterThanOrEqual(1)
    expect(result.failed).toBe(0)

    // Verify the photo is now deleted
    await expect(p.findByID({ collection: 'media', id: ph1.id, overrideAccess: true }))
      .rejects.toThrow()

    // Verify the request's photos array is now empty
    const frAfter = await p.findByID({ collection: 'firing-requests', id: fr.id, overrideAccess: true })
    expect(frAfter.photos).toEqual([])
  })

  it('keeps photos on cancelled requests updated less than 7 days ago', async () => {
    const p = await getTestPayload()

    // Create a photo
    const ph1 = await mkPhoto(p)

    // Create a firing request with the photo
    const fr = await p.create({
      collection: 'firing-requests',
      overrideAccess: true,
      data: {
        name: 'Cancelled Expiry Test 2',
        email: 'cancelled-expiry-test-2@test.local',
        description: 'test cancelled request',
        halfShelves: 2,
        amountCents: 5000,
        stonewareConfirmed: true,
        status: 'pending',
        photos: [ph1.id],
      },
    })

    // Update to cancelled
    await p.update({
      collection: 'firing-requests',
      id: fr.id,
      overrideAccess: true,
      data: { status: 'cancelled' },
    })

    // Backdate to 1 day ago (still within the 7-day window)
    const oneDayAgo = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString()
    const pool = (p.db as any).pool
    await pool.query(
      'UPDATE firing_requests SET updated_at = $1 WHERE id = $2',
      [oneDayAgo, fr.id],
    )

    // Run the expiry service
    const result = await expireFiringRequestMedia(p)

    // Verify the request was not processed (not deleted)
    expect(result.failed).toBe(0)

    // Verify the photo still exists
    const frAfter = await p.findByID({ collection: 'firing-requests', id: fr.id, overrideAccess: true })
    expect((frAfter.photos as any[]).length).toBe(1)

    const media = await p.findByID({ collection: 'media', id: ph1.id, overrideAccess: true })
    expect(media).toBeDefined()
  })
})

afterAll(async () => {
  const p = await getTestPayload()
  await p.delete({
    collection: 'firing-requests',
    where: { email: { contains: '@test.local' } },
    overrideAccess: true,
  })
  await p.delete({
    collection: 'media',
    where: { alt: { equals: 'firing-expiry-test' } },
    overrideAccess: true,
  })
})

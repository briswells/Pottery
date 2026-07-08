// The default jsdom test environment gives Node `Buffer`s a cross-realm
// `Uint8Array` that fails `instanceof` checks inside `file-type` (used by
// Payload's upload validation), so a real file upload always fails there.
// Force node for this file, which actually creates media with file data.
// @vitest-environment node
import { describe, it, expect, afterAll } from 'vitest'
import { getTestPayload } from './helpers'

async function mkPhoto(p: any) {
  // 1x1 png buffer — media create needs a real file
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
  return p.create({ collection: 'media', overrideAccess: true, data: { alt: 'fr test' }, file: { data: png, mimetype: 'image/png', name: `fr-${Date.now()}-${Math.random()}.png`, size: png.length } })
}

describe('firing-requests (rebuilt)', () => {
  it('stores halfShelves, photos array, stoneware flag, coupon fields', async () => {
    const p = await getTestPayload()
    const ph1 = await mkPhoto(p); const ph2 = await mkPhoto(p)
    const fr = await p.create({ collection: 'firing-requests', overrideAccess: true, data: {
      name: 'FR Test', email: 'fr@frtest.local', description: 'two mugs', halfShelves: 2,
      amountCents: 5000, stonewareConfirmed: true, status: 'pending', photos: [ph1.id, ph2.id],
    } })
    expect(fr.halfShelves).toBe(2)
    expect((fr.photos as any[]).length).toBe(2)
    expect(fr.stonewareConfirmed).toBe(true)
  })

  it('rejects out-of-range halfShelves and missing stoneware confirmation', async () => {
    const p = await getTestPayload()
    await expect(p.create({ collection: 'firing-requests', overrideAccess: true, data: {
      name: 'X', email: 'x@frtest.local', description: 'd', halfShelves: 9, amountCents: 1, stonewareConfirmed: true,
    } })).rejects.toThrow()
    await expect(p.create({ collection: 'firing-requests', overrideAccess: true, data: {
      name: 'X', email: 'x2@frtest.local', description: 'd', halfShelves: 1, amountCents: 1, stonewareConfirmed: false,
    } })).rejects.toThrow()
  })

  it('no invoice-era fields remain', async () => {
    const p = await getTestPayload()
    const fr = await p.create({ collection: 'firing-requests', overrideAccess: true, data: {
      name: 'Y', email: 'y@frtest.local', description: 'd', halfShelves: 1, amountCents: 2500, stonewareConfirmed: true,
    } })
    expect(fr).not.toHaveProperty('quotedPriceCents')
    expect(fr).not.toHaveProperty('squareInvoiceId')
  })
})

afterAll(async () => {
  const p = await getTestPayload()
  await p.delete({ collection: 'firing-requests', where: { email: { contains: '@frtest.local' } }, overrideAccess: true })
  await p.delete({ collection: 'media', where: { alt: { equals: 'fr test' } }, overrideAccess: true })
})

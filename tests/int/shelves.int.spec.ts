import { describe, it, expect, afterAll } from 'vitest'
import { getTestPayload } from './helpers'

describe('shelf-tags', () => {
  it('creates a tag with a unique name', async () => {
    const payload = await getTestPayload()
    const tag = await payload.create({
      collection: 'shelf-tags', overrideAccess: true,
      data: { name: `Back room ${Date.now()}` },
    })
    expect(tag.id).toBeTruthy()
    expect(tag.name).toContain('Back room')
  })
})

describe('shelves', () => {
  it('creates a shelf with required name and optional tag', async () => {
    const payload = await getTestPayload()
    const shelf = await payload.create({
      collection: 'shelves', overrideAccess: true,
      data: { name: `PLAN-SHELF-${Date.now()}` },
    })
    expect(shelf.name).toContain('PLAN-SHELF')
    expect(shelf.assignedMember).toBeFalsy()
  })

  it('can be filtered by unassigned (assignedMember exists:false)', async () => {
    const payload = await getTestPayload()
    await payload.create({ collection: 'shelves', overrideAccess: true, data: { name: `PLAN-SHELF-unassigned-${Date.now()}` } })
    const { docs } = await payload.find({
      collection: 'shelves', overrideAccess: true,
      where: { assignedMember: { exists: false } }, limit: 100,
    })
    expect(docs.length).toBeGreaterThan(0)
    expect(docs.every((d) => !d.assignedMember)).toBe(true)
  })
})

describe('people.shelf', () => {
  it('stores a shelf relationship and no longer has shelfLabel', async () => {
    const payload = await getTestPayload()
    const shelf = await payload.create({ collection: 'shelves', overrideAccess: true, data: { name: `PLAN-SHELF-rel-${Date.now()}` } })
    const member = await payload.create({
      collection: 'people', overrideAccess: true,
      data: { name: 'ShelfRel', email: `rel-${Date.now()}@shelftest.local`, status: 'active', shelf: shelf.id },
    })
    expect(member).not.toHaveProperty('shelfLabel')
    const fresh = await payload.findByID({ collection: 'people', id: member.id, depth: 0, overrideAccess: true })
    expect(fresh.shelf).toBe(shelf.id)
  })
})

afterAll(async () => {
  const payload = await getTestPayload()
  await payload.delete({ collection: 'people', where: { email: { contains: '@shelftest.local' } }, overrideAccess: true })
  try {
    await payload.delete({ collection: 'shelves', where: { name: { contains: 'PLAN-SHELF' } }, overrideAccess: true })
  } catch {
    // shelves collection may not exist yet
  }
  await payload.delete({ collection: 'shelf-tags', where: { name: { contains: 'Back room' } }, overrideAccess: true })
})

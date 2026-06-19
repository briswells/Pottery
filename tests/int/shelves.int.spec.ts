import { describe, it, expect, afterAll } from 'vitest'
import { getTestPayload } from './helpers'
import { naturalSortKey } from '../../src/lib/naturalSort'

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

describe('natural shelf sorting', () => {
  const cmp = (a: string, b: string) => {
    const ka = naturalSortKey(a)
    const kb = naturalSortKey(b)
    return ka < kb ? -1 : ka > kb ? 1 : 0
  }

  it('orders numbers numerically and before letters', () => {
    const names = ['B-12', '10', '2', 'A1', '1', '20']
    expect([...names].sort(cmp)).toEqual(['1', '2', '10', '20', 'A1', 'B-12'])
  })

  it('computes and stores sortKey from the name on a shelf', async () => {
    const payload = await getTestPayload()
    const name = `PLAN-SHELF-sortkey-${Date.now()}`
    const s = await payload.create({ collection: 'shelves', overrideAccess: true, data: { name } })
    const fresh = await payload.findByID({ collection: 'shelves', id: s.id, depth: 0, overrideAccess: true })
    expect((fresh as { sortKey?: string }).sortKey).toBe(naturalSortKey(name))
  })
})

describe('duplicate name messages', () => {
  // The friendly message surfaces as the field-level validation error (shown
  // inline under the Name field in the admin), not the generic top-level message.
  const fieldErrorText = (err: unknown): string => {
    const e = err as { data?: { errors?: { message?: string }[] }; message?: string }
    const fromData = (e?.data?.errors ?? []).map((x) => x?.message).join(' ')
    return `${fromData} ${e?.message ?? ''}`
  }

  it('rejects a duplicate shelf name with a friendly message', async () => {
    const payload = await getTestPayload()
    const name = `PLAN-SHELF-dup-${Date.now()}`
    await payload.create({ collection: 'shelves', overrideAccess: true, data: { name } })
    const err = await payload
      .create({ collection: 'shelves', overrideAccess: true, data: { name } })
      .catch((e) => e)
    expect(fieldErrorText(err)).toMatch(/a shelf with that name already exists/i)
  })

  it('rejects a duplicate shelf-tag name with a friendly message', async () => {
    const payload = await getTestPayload()
    const name = `Back room dup ${Date.now()}`
    await payload.create({ collection: 'shelf-tags', overrideAccess: true, data: { name } })
    const err = await payload
      .create({ collection: 'shelf-tags', overrideAccess: true, data: { name } })
      .catch((e) => e)
    expect(fieldErrorText(err)).toMatch(/a tag with that name already exists/i)
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

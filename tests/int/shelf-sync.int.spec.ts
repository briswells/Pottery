// tests/int/shelf-sync.int.spec.ts
import { describe, it, expect, afterAll } from 'vitest'
import { getTestPayload } from './helpers'

const EM = () => `sync-${Date.now()}-${Math.floor(Math.random() * 1e6)}@shelftest.local`
async function mkShelf(p: any, n: string) { return p.create({ collection: 'shelves', overrideAccess: true, data: { name: `PLAN-SHELF-${n}-${Date.now()}` } }) }
async function mkMember(p: any) { return p.create({ collection: 'people', overrideAccess: true, data: { name: 'SyncM', email: EM(), status: 'active' } }) }
async function shelfOf(p: any, id: number) { return p.findByID({ collection: 'shelves', id, depth: 0, overrideAccess: true }) }
async function personOf(p: any, id: number) { return p.findByID({ collection: 'people', id, depth: 0, overrideAccess: true }) }

describe('syncShelfAssignment', () => {
  it('stamps assignedMember when a member is given a shelf', async () => {
    const p = await getTestPayload()
    const s = await mkShelf(p, 'a'); const m = await mkMember(p)
    await p.update({ collection: 'people', id: m.id, overrideAccess: true, data: { shelf: s.id } })
    expect((await shelfOf(p, s.id)).assignedMember).toBe(m.id)
  })

  it('frees the previous shelf on reassignment', async () => {
    const p = await getTestPayload()
    const s1 = await mkShelf(p, 'b1'); const s2 = await mkShelf(p, 'b2'); const m = await mkMember(p)
    await p.update({ collection: 'people', id: m.id, overrideAccess: true, data: { shelf: s1.id } })
    await p.update({ collection: 'people', id: m.id, overrideAccess: true, data: { shelf: s2.id } })
    expect((await shelfOf(p, s1.id)).assignedMember).toBeFalsy()
    expect((await shelfOf(p, s2.id)).assignedMember).toBe(m.id)
  })

  it('reassigning a held shelf clears the prior holder', async () => {
    const p = await getTestPayload()
    const s = await mkShelf(p, 'c'); const m1 = await mkMember(p); const m2 = await mkMember(p)
    await p.update({ collection: 'people', id: m1.id, overrideAccess: true, data: { shelf: s.id } })
    await p.update({ collection: 'people', id: m2.id, overrideAccess: true, data: { shelf: s.id } })
    expect((await personOf(p, m1.id)).shelf).toBeFalsy()
    expect((await shelfOf(p, s.id)).assignedMember).toBe(m2.id)
  })

  it('frees the shelf when Square reports the sub truly ended', async () => {
    const p = await getTestPayload()
    const s = await mkShelf(p, 'exp'); const m = await mkMember(p)
    await p.update({ collection: 'people', id: m.id, overrideAccess: true, data: { shelf: s.id, subscriptionStatus: 'ACTIVE' } })
    await p.update({ collection: 'people', id: m.id, overrideAccess: true, context: { fromSquareWebhook: true }, data: { subscriptionStatus: 'DEACTIVATED', status: 'cancelled' } })
    expect((await personOf(p, m.id)).shelf).toBeFalsy()
    expect((await shelfOf(p, s.id)).assignedMember).toBeFalsy()
  })

  it('keeps the shelf on a scheduled cancel (still ACTIVE in Square)', async () => {
    const p = await getTestPayload()
    const s = await mkShelf(p, 'sched'); const m = await mkMember(p)
    await p.update({ collection: 'people', id: m.id, overrideAccess: true, data: { shelf: s.id, subscriptionStatus: 'ACTIVE' } })
    await p.update({ collection: 'people', id: m.id, overrideAccess: true, context: { fromSquareWebhook: true }, data: { status: 'cancelled' } })
    expect((await personOf(p, m.id)).shelf).toBe(s.id)
  })

  it('keeps the shelf when only paused', async () => {
    const p = await getTestPayload()
    const s = await mkShelf(p, 'pause'); const m = await mkMember(p)
    await p.update({ collection: 'people', id: m.id, overrideAccess: true, data: { shelf: s.id, subscriptionStatus: 'ACTIVE' } })
    await p.update({ collection: 'people', id: m.id, overrideAccess: true, context: { fromSquareWebhook: true }, data: { subscriptionStatus: 'PAUSED', status: 'paused' } })
    expect((await personOf(p, m.id)).shelf).toBe(s.id)
  })
})

describe('shelf/tag deletion', () => {
  it('clears the member ref when an assigned shelf is deleted', async () => {
    const p = await getTestPayload()
    const s = await mkShelf(p, 'del'); const m = await mkMember(p)
    await p.update({ collection: 'people', id: m.id, overrideAccess: true, data: { shelf: s.id } })
    await p.delete({ collection: 'shelves', id: s.id, overrideAccess: true })
    expect((await personOf(p, m.id)).shelf).toBeFalsy()
  })

  it('nulls a shelf tag when the tag is deleted', async () => {
    const p = await getTestPayload()
    const tag = await p.create({ collection: 'shelf-tags', overrideAccess: true, data: { name: `Back room del ${Date.now()}` } })
    const s = await p.create({ collection: 'shelves', overrideAccess: true, data: { name: `PLAN-SHELF-tagdel-${Date.now()}`, tag: tag.id } })
    await p.delete({ collection: 'shelf-tags', id: tag.id, overrideAccess: true })
    expect((await shelfOf(p, s.id)).tag).toBeFalsy()
  })
})

afterAll(async () => {
  const p = await getTestPayload()
  await p.delete({ collection: 'people', where: { email: { contains: '@shelftest.local' } }, overrideAccess: true })
  await p.delete({ collection: 'shelves', where: { name: { contains: 'PLAN-SHELF' } }, overrideAccess: true })
  await p.delete({ collection: 'shelf-tags', where: { name: { contains: 'Back room' } }, overrideAccess: true })
})

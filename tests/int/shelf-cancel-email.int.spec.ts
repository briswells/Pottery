import { describe, it, expect, afterAll, vi } from 'vitest'
import { getTestPayload } from './helpers'
import { resolveShelfName } from '../../src/hooks/cancelSquareSubscription'

describe('cancellation shelf name', () => {
  it('resolves the assigned shelf name, else "none on file"', async () => {
    const p = await getTestPayload()
    const s = await p.create({ collection: 'shelves', overrideAccess: true, data: { name: `PLAN-SHELF-email-${Date.now()}` } })
    const withShelf = await resolveShelfName(p, s.id)
    expect(withShelf).toBe(s.name)
    const without = await resolveShelfName(p, null)
    expect(without).toBe('none on file')
  })
})

afterAll(async () => {
  const p = await getTestPayload()
  await p.delete({ collection: 'shelves', where: { name: { contains: 'PLAN-SHELF' } }, overrideAccess: true })
})

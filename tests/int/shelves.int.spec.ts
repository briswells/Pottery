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

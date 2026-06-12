import { describe, it, expect, afterAll } from 'vitest'
import { getTestPayload } from './helpers'

describe('member cancel-token fields', () => {
  it('stores and reads cancelTokenHash + cancelTokenExpiresAt', async () => {
    const payload = await getTestPayload()
    const m = await payload.create({
      collection: 'members',
      overrideAccess: true,
      data: { name: 'TokenFields', email: `tok-${Date.now()}@test.local`, status: 'paused' },
    })
    const exp = new Date(Date.now() + 60_000).toISOString()
    const updated = await payload.update({
      collection: 'members', id: m.id, overrideAccess: true,
      data: { cancelTokenHash: 'abc123', cancelTokenExpiresAt: exp },
    })
    expect(updated.cancelTokenHash).toBe('abc123')
    expect(updated.cancelTokenExpiresAt).toBeTruthy()
  })
})

afterAll(async () => {
  const payload = await getTestPayload()
  await payload.delete({ collection: 'members', where: { email: { contains: '@test.local' } }, overrideAccess: true })
})

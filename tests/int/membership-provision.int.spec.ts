import { describe, it, expect, afterAll } from 'vitest'
import { getTestPayload } from './helpers'

describe('members no-login auth', () => {
  it('creates a member with no password (local strategy disabled)', async () => {
    const payload = await getTestPayload()
    // status 'paused' so the (later) provisioning hook skips it — isolates the
    // auth change from any Square calls.
    const member = await payload.create({
      collection: 'members',
      overrideAccess: true,
      data: { name: 'No Password', email: `nopw-${Date.now()}@test.local`, status: 'paused' },
    })
    expect(member.id).toBeTruthy()
  })
})

afterAll(async () => {
  const { getTestPayload } = await import('./helpers')
  const payload = await getTestPayload()
  await payload.delete({ collection: 'members', where: { email: { contains: '@test.local' } }, overrideAccess: true })
})

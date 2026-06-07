import { describe, it, expect, afterAll, vi } from 'vitest'
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

describe('squareMembershipGateway.createSubscription cardless', () => {
  it('omits cardId from the Square call when no card is provided', async () => {
    const create = vi.fn(async () => ({ subscription: { id: 'sub_1', status: 'ACTIVE' } }))
    vi.doMock('../../src/lib/square', () => ({
      getSquareClient: () => ({ subscriptions: { create } }),
      SQUARE_LOCATION_ID: () => 'LOC1',
    }))
    process.env.SQUARE_MEMBERSHIP_PLAN_VARIATION_ID = 'PLAN1'
    const { squareMembershipGateway } = await import('../../src/lib/membership-gateway')

    await squareMembershipGateway.createSubscription({ customerId: 'cus_1' })
    expect(create).toHaveBeenCalledWith(expect.not.objectContaining({ cardId: expect.anything() }))

    await squareMembershipGateway.createSubscription({ customerId: 'cus_1', cardId: 'card_1' })
    expect(create).toHaveBeenLastCalledWith(expect.objectContaining({ cardId: 'card_1' }))
    vi.doUnmock('../../src/lib/square')
  })
})

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

import { provisionMemberSubscription } from '../../src/services/membership'
import type { MembershipGateway } from '../../src/lib/membership-gateway'

function fakeGateway(over: Partial<MembershipGateway> = {}): MembershipGateway {
  return {
    createCustomer: vi.fn(async () => ({ customerId: 'cus_x' })),
    saveCard: vi.fn(async () => ({ cardId: 'card_x' })),
    createSubscription: vi.fn(async () => ({ subscriptionId: 'sub_x', status: 'ACTIVE' })),
    ...over,
  }
}

describe('provisionMemberSubscription', () => {
  const member = { id: 7, name: 'Mae', email: 'mae@test.local', phone: null }

  it('creates a cardless subscription and writes Square ids back within the caller transaction', async () => {
    const req = { transactionID: 'tx1' } as any
    const update = vi.fn(async (a: any) => ({ id: a.id, ...a.data }))
    const payload = { update } as any
    const gateway = fakeGateway()

    await provisionMemberSubscription({ payload, gateway, req }, member)

    expect(gateway.createSubscription).toHaveBeenCalledWith({ customerId: 'cus_x' }) // no cardId
    expect(gateway.saveCard).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        req,
        collection: 'members',
        id: 7,
        data: expect.objectContaining({
          squareCustomerId: 'cus_x',
          squareSubscriptionId: 'sub_x',
          subscriptionStatus: 'ACTIVE',
        }),
      }),
    )
  })

  it('marks subscriptionStatus SETUP_FAILED (no sub id) when Square throws', async () => {
    const req = { transactionID: 'tx1' } as any
    const update = vi.fn(async (a: any) => ({ id: a.id, ...a.data }))
    const payload = { update } as any
    const gateway = fakeGateway({ createSubscription: vi.fn(async () => { throw new Error('square down') }) })

    await provisionMemberSubscription({ payload, gateway, req }, member)

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        req,
        data: expect.objectContaining({ subscriptionStatus: 'SETUP_FAILED' }),
      }),
    )
    const lastData = update.mock.calls.at(-1)![0].data
    expect(lastData.squareSubscriptionId ?? null).toBeNull()
  })
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

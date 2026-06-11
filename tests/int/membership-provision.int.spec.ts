import { describe, it, expect, afterAll, beforeEach, vi } from 'vitest'
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

  // The guard reads SQUARE_MEMBERSHIP_PLAN_VARIATION_ID; give the "configured"
  // tests a real-looking value so they reach the gateway.
  beforeEach(() => {
    process.env.SQUARE_MEMBERSHIP_PLAN_VARIATION_ID = 'PLAN_OK'
  })

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

  it('records SETUP_FAILED WITH the Square reason (no sub id) when Square throws', async () => {
    const req = { transactionID: 'tx1' } as any
    const update = vi.fn(async (a: any) => ({ id: a.id, ...a.data }))
    const payload = { update } as any
    const squareErr: any = new Error('Status code: 400')
    squareErr.errors = [{ code: 'BAD_REQUEST', detail: 'plan ID does not match any plan' }]
    const gateway = fakeGateway({ createSubscription: vi.fn(async () => { throw squareErr }) })

    await provisionMemberSubscription({ payload, gateway, req }, member)

    const lastData = update.mock.calls.at(-1)![0].data
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ req }))
    expect(lastData.subscriptionStatus).toMatch(/^SETUP_FAILED/)
    expect(lastData.subscriptionStatus).toContain('plan ID does not match')
    expect(lastData.squareSubscriptionId ?? null).toBeNull()
  })

  it('skips Square entirely and records NOT_CONFIGURED when the plan id is the placeholder', async () => {
    process.env.SQUARE_MEMBERSHIP_PLAN_VARIATION_ID = 'replace-with-plan-variation-id'
    const req = { transactionID: 'tx1' } as any
    const update = vi.fn(async (a: any) => ({ id: a.id, ...a.data }))
    const payload = { update } as any
    const gateway = fakeGateway()

    await provisionMemberSubscription({ payload, gateway, req }, member)

    expect(gateway.createCustomer).not.toHaveBeenCalled()
    expect(gateway.createSubscription).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        req,
        data: expect.objectContaining({ subscriptionStatus: 'NOT_CONFIGURED' }),
      }),
    )
  })

  it('skips Square entirely and records NOT_CONFIGURED when the plan id is unset', async () => {
    delete process.env.SQUARE_MEMBERSHIP_PLAN_VARIATION_ID
    const req = { transactionID: 'tx1' } as any
    const update = vi.fn(async (a: any) => ({ id: a.id, ...a.data }))
    const payload = { update } as any
    const gateway = fakeGateway()

    await provisionMemberSubscription({ payload, gateway, req }, member)

    expect(gateway.createCustomer).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ subscriptionStatus: 'NOT_CONFIGURED' }) }),
    )
  })
})
// NOTE: the gateway's cardless Square-call shape is tested in
// membership-gateway.int.spec.ts — it must hoist-mock ./square in its own file
// (booting Payload here caches the real Square module and defeats a late mock).

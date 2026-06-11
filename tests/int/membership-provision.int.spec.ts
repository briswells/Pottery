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

import { reconcileMemberPlan } from '../../src/services/membership'
import type { MembershipGateway } from '../../src/lib/membership-gateway'

function fakeGateway(over: Partial<MembershipGateway> = {}): MembershipGateway {
  return {
    createCustomer: vi.fn(async () => ({ customerId: 'cus_x' })),
    saveCard: vi.fn(async () => ({ cardId: 'card_x' })),
    createSubscription: vi.fn(async () => ({ subscriptionId: 'sub_x', status: 'ACTIVE' })),
    cancelSubscription: vi.fn(async () => undefined),
    listPlanVariations: vi.fn(async () => []),
    ...over,
  }
}

describe('reconcileMemberPlan', () => {
  const FREE = { id: 'p_free', kind: 'free', squarePlanVariationId: null }
  const SQ_A = { id: 'p_a', kind: 'square', squarePlanVariationId: 'PV_A' }
  const SQ_B = { id: 'p_b', kind: 'square', squarePlanVariationId: 'PV_B' }

  function setup(plansById: Record<string, any>) {
    const update = vi.fn(async (a: any) => ({ id: a.id, ...a.data }))
    const findByID = vi.fn(async ({ id }: any) => plansById[id])
    const payload = { update, findByID } as any
    return { payload, update }
  }
  const req = { transactionID: 'tx' } as any

  it('Free on create: no Square calls, status FREE', async () => {
    const { payload, update } = setup({ p_free: FREE })
    const gateway = fakeGateway()
    await reconcileMemberPlan({ payload, gateway, req }, {
      member: { id: 1, name: 'A', email: 'a@test.local', phone: null, plan: 'p_free', squareCustomerId: null, squareSubscriptionId: null },
      previousDoc: undefined,
    })
    expect(gateway.createSubscription).not.toHaveBeenCalled()
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ req, data: expect.objectContaining({ subscriptionStatus: 'FREE', squareSubscriptionId: null }) }))
  })

  it('Square on create: creates customer + subscription on the plan variation', async () => {
    const { payload, update } = setup({ p_a: SQ_A })
    const gateway = fakeGateway()
    await reconcileMemberPlan({ payload, gateway, req }, {
      member: { id: 2, name: 'B', email: 'b@test.local', phone: null, plan: 'p_a', squareCustomerId: null, squareSubscriptionId: null },
      previousDoc: undefined,
    })
    expect(gateway.createCustomer).toHaveBeenCalled()
    expect(gateway.createSubscription).toHaveBeenCalledWith({ customerId: 'cus_x', planVariationId: 'PV_A' })
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ req, data: expect.objectContaining({ squareSubscriptionId: 'sub_x', subscriptionStatus: 'ACTIVE' }) }))
  })

  it('Square→Square swap: cancels old, reuses customer, creates new', async () => {
    const { payload } = setup({ p_b: SQ_B })
    const gateway = fakeGateway()
    await reconcileMemberPlan({ payload, gateway, req }, {
      member: { id: 3, name: 'C', email: 'c@test.local', phone: null, plan: 'p_b', squareCustomerId: 'cus_old', squareSubscriptionId: 'sub_old' },
      previousDoc: { plan: 'p_a' },
    })
    expect(gateway.cancelSubscription).toHaveBeenCalledWith('sub_old')
    expect(gateway.createCustomer).not.toHaveBeenCalled()
    expect(gateway.createSubscription).toHaveBeenCalledWith({ customerId: 'cus_old', planVariationId: 'PV_B' })
  })

  it('Square→Free: cancels subscription, status FREE', async () => {
    const { payload, update } = setup({ p_free: FREE })
    const gateway = fakeGateway()
    await reconcileMemberPlan({ payload, gateway, req }, {
      member: { id: 4, name: 'D', email: 'd@test.local', phone: null, plan: 'p_free', squareCustomerId: 'cus_1', squareSubscriptionId: 'sub_1' },
      previousDoc: { plan: 'p_a' },
    })
    expect(gateway.cancelSubscription).toHaveBeenCalledWith('sub_1')
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ subscriptionStatus: 'FREE', squareSubscriptionId: null }) }))
  })

  it('unchanged Square plan: no Square calls', async () => {
    const { payload } = setup({ p_a: SQ_A })
    const gateway = fakeGateway()
    await reconcileMemberPlan({ payload, gateway, req }, {
      member: { id: 5, name: 'E', email: 'e@test.local', phone: null, plan: 'p_a', squareCustomerId: 'cus_1', squareSubscriptionId: 'sub_1' },
      previousDoc: { plan: 'p_a' },
    })
    expect(gateway.createSubscription).not.toHaveBeenCalled()
    expect(gateway.cancelSubscription).not.toHaveBeenCalled()
  })

  it('records SETUP_FAILED with the reason when Square throws', async () => {
    const { payload, update } = setup({ p_a: SQ_A })
    const err: any = new Error('Status code: 400'); err.errors = [{ detail: 'plan ID does not match' }]
    const gateway = fakeGateway({ createSubscription: vi.fn(async () => { throw err }) })
    await reconcileMemberPlan({ payload, gateway, req }, {
      member: { id: 6, name: 'F', email: 'f@test.local', phone: null, plan: 'p_a', squareCustomerId: null, squareSubscriptionId: null },
      previousDoc: undefined,
    })
    const last = update.mock.calls.at(-1)![0].data
    expect(last.subscriptionStatus).toMatch(/^SETUP_FAILED/)
    expect(last.subscriptionStatus).toContain('plan ID does not match')
  })
})
// NOTE: the gateway's cardless Square-call shape is tested in
// membership-gateway.int.spec.ts — it must hoist-mock ./square in its own file
// (booting Payload here caches the real Square module and defeats a late mock).

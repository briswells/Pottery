import { describe, it, expect, vi, beforeAll } from 'vitest'

// Hoisted so the mock factory can reference `create`, and so the mock is
// registered before the gateway's `import ... from './square'` resolves. This
// file deliberately never boots Payload — booting it would cache the REAL
// ./square (via the Members provisioning hook) and a late mock would no-op,
// letting the gateway hit the live Square API.
const { create, cancel, list } = vi.hoisted(() => ({
  create: vi.fn(async () => ({ subscription: { id: 'sub_1', status: 'ACTIVE' } })),
  cancel: vi.fn(async () => ({})),
  list: vi.fn(async () => [] as any[]),
}))
vi.mock('../../src/lib/square', () => ({
  getSquareClient: () => ({ subscriptions: { create, cancel }, catalog: { list } }),
  SQUARE_LOCATION_ID: () => 'LOC1',
}))

import { squareMembershipGateway } from '../../src/lib/membership-gateway'

beforeAll(() => {
  process.env.SQUARE_MEMBERSHIP_PLAN_VARIATION_ID = 'PLAN1'
})

describe('squareMembershipGateway.createSubscription cardless', () => {
  it('sends the given planVariationId and omits cardId when cardless', async () => {
    create.mockClear()
    await squareMembershipGateway.createSubscription({ customerId: 'cus_1', planVariationId: 'PV_1' })
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ customerId: 'cus_1', planVariationId: 'PV_1' }))
    expect(create).toHaveBeenCalledWith(expect.not.objectContaining({ cardId: expect.anything() }))
  })
})

describe('squareMembershipGateway.cancelSubscription', () => {
  it('cancels via the Square API', async () => {
    cancel.mockClear()
    await squareMembershipGateway.cancelSubscription('sub_9')
    expect(cancel).toHaveBeenCalledWith({ subscriptionId: 'sub_9' })
  })
})

describe('squareMembershipGateway.listPlanVariations', () => {
  it('flattens catalog plans + variations into {variationId, planName, priceCents, cadence}', async () => {
    list.mockImplementation(async () => [
      { id: 'PLAN_A', type: 'SUBSCRIPTION_PLAN', subscriptionPlanData: { name: 'Studio' } },
      {
        id: 'PV_A', type: 'SUBSCRIPTION_PLAN_VARIATION',
        subscriptionPlanVariationData: {
          name: 'Monthly', subscriptionPlanId: 'PLAN_A',
          phases: [{ cadence: 'MONTHLY', pricing: { priceMoney: { amount: 20000n, currency: 'USD' } } }],
        },
      },
    ])
    const out = await squareMembershipGateway.listPlanVariations()
    expect(out).toEqual([
      { variationId: 'PV_A', planName: 'Studio', variationName: 'Monthly', priceCents: 20000, cadence: 'MONTHLY' },
    ])
  })
})

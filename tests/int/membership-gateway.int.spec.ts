import { describe, it, expect, vi, beforeAll } from 'vitest'

// Hoisted so the mock factory can reference `create`, and so the mock is
// registered before the gateway's `import ... from './square'` resolves. This
// file deliberately never boots Payload — booting it would cache the REAL
// ./square (via the Members provisioning hook) and a late mock would no-op,
// letting the gateway hit the live Square API.
const { create, cancel, list, getSub, getCust } = vi.hoisted(() => ({
  create: vi.fn(async () => ({ subscription: { id: 'sub_1', status: 'ACTIVE' } })),
  cancel: vi.fn(async () => ({})),
  list: vi.fn(async () => [] as any[]),
  getSub: vi.fn(async () => ({ subscription: { id: 'sub_9', customerId: 'cus_9', planVariationId: 'PV_9', status: 'ACTIVE', startDate: '2026-01-01' } })),
  getCust: vi.fn(async () => ({ customer: { id: 'cus_9', emailAddress: 'c@x.com', givenName: 'Cee', familyName: 'Ess', phoneNumber: '555' } })),
}))
vi.mock('../../src/lib/square', () => ({
  getSquareClient: () => ({ subscriptions: { create, cancel, get: getSub }, customers: { get: getCust }, catalog: { list } }),
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
  // Real Square shape: variations are NESTED in the plan and price is under
  // `pricing.price` (not a top-level SUBSCRIPTION_PLAN_VARIATION / `priceMoney`).
  it('reads variations nested in the plan, with price under pricing.price', async () => {
    list.mockImplementation(async () => [
      {
        id: 'PLAN_A',
        type: 'SUBSCRIPTION_PLAN',
        subscriptionPlanData: {
          name: 'Studio',
          subscriptionPlanVariations: [
            {
              id: 'PV_A',
              type: 'SUBSCRIPTION_PLAN_VARIATION',
              subscriptionPlanVariationData: {
                name: 'Monthly',
                subscriptionPlanId: 'PLAN_A',
                phases: [{ cadence: 'MONTHLY', pricing: { type: 'STATIC', price: { amount: 20000n, currency: 'USD' } } }],
              },
            },
          ],
        },
      },
    ])
    const out = await squareMembershipGateway.listPlanVariations()
    expect(out).toEqual([
      { variationId: 'PV_A', planName: 'Studio', variationName: 'Monthly', priceCents: 20000, cadence: 'MONTHLY' },
    ])
  })

  it('also reads top-level variations with priceMoney (no duplicates)', async () => {
    list.mockImplementation(async () => [
      { id: 'PLAN_B', type: 'SUBSCRIPTION_PLAN', subscriptionPlanData: { name: 'Clay' } },
      {
        id: 'PV_B',
        type: 'SUBSCRIPTION_PLAN_VARIATION',
        subscriptionPlanVariationData: {
          name: 'Yearly', subscriptionPlanId: 'PLAN_B',
          phases: [{ cadence: 'ANNUAL', pricing: { priceMoney: { amount: 99900n, currency: 'USD' } } }],
        },
      },
    ])
    const out = await squareMembershipGateway.listPlanVariations()
    expect(out).toEqual([
      { variationId: 'PV_B', planName: 'Clay', variationName: 'Yearly', priceCents: 99900, cadence: 'ANNUAL' },
    ])
  })
})

describe('squareMembershipGateway.getSubscription', () => {
  it('returns a normalized subscription', async () => {
    const out = await squareMembershipGateway.getSubscription('sub_9')
    expect(out).toEqual({ id: 'sub_9', customerId: 'cus_9', planVariationId: 'PV_9', status: 'ACTIVE', startDate: '2026-01-01' })
  })
  it('returns null when Square has no such subscription', async () => {
    getSub.mockResolvedValueOnce({ subscription: undefined } as any)
    expect(await squareMembershipGateway.getSubscription('missing')).toBeNull()
  })
})

describe('squareMembershipGateway.getCustomer', () => {
  it('returns a normalized customer (emailAddress→email, phoneNumber→phone)', async () => {
    const out = await squareMembershipGateway.getCustomer('cus_9')
    expect(out).toEqual({ id: 'cus_9', email: 'c@x.com', givenName: 'Cee', familyName: 'Ess', phone: '555' })
  })
  it('returns null when Square has no such customer', async () => {
    getCust.mockResolvedValueOnce({ customer: undefined } as any)
    expect(await squareMembershipGateway.getCustomer('missing')).toBeNull()
  })
})

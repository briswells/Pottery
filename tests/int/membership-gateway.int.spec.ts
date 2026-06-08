import { describe, it, expect, vi, beforeAll } from 'vitest'

// Hoisted so the mock factory can reference `create`, and so the mock is
// registered before the gateway's `import ... from './square'` resolves. This
// file deliberately never boots Payload — booting it would cache the REAL
// ./square (via the Members provisioning hook) and a late mock would no-op,
// letting the gateway hit the live Square API.
const { create } = vi.hoisted(() => ({
  create: vi.fn(async () => ({ subscription: { id: 'sub_1', status: 'ACTIVE' } })),
}))
vi.mock('../../src/lib/square', () => ({
  getSquareClient: () => ({ subscriptions: { create } }),
  SQUARE_LOCATION_ID: () => 'LOC1',
}))

import { squareMembershipGateway } from '../../src/lib/membership-gateway'

beforeAll(() => {
  process.env.SQUARE_MEMBERSHIP_PLAN_VARIATION_ID = 'PLAN1'
})

describe('squareMembershipGateway.createSubscription cardless', () => {
  it('omits cardId from the Square call when no card is provided', async () => {
    create.mockClear()
    await squareMembershipGateway.createSubscription({ customerId: 'cus_1' })
    expect(create).toHaveBeenCalledWith(expect.not.objectContaining({ cardId: expect.anything() }))

    await squareMembershipGateway.createSubscription({ customerId: 'cus_1', cardId: 'card_1' })
    expect(create).toHaveBeenLastCalledWith(expect.objectContaining({ cardId: 'card_1' }))
  })
})

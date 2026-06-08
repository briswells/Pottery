import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoist-mock ./square in its own file (never boots Payload) so the hook's Square
// call is intercepted and no live API call can happen.
const { cancel } = vi.hoisted(() => ({ cancel: vi.fn(async () => ({})) }))
vi.mock('../../src/lib/square', () => ({
  getSquareClient: () => ({ subscriptions: { cancel } }),
  SQUARE_LOCATION_ID: () => 'LOC1',
}))

import { cancelSquareSubscriptionOnDelete } from '../../src/hooks/cancelSquareSubscriptionOnDelete'

function reqWith(member: any) {
  return { payload: { findByID: vi.fn(async () => member) } } as any
}

async function runDelete(id: number, member: any) {
  return cancelSquareSubscriptionOnDelete({ id, req: reqWith(member) } as any)
}

describe('cancelSquareSubscriptionOnDelete', () => {
  beforeEach(() => cancel.mockClear())

  it('cancels the subscription for an active member', async () => {
    await runDelete(1, { squareSubscriptionId: 'sub_1', status: 'active' })
    expect(cancel).toHaveBeenCalledWith({ subscriptionId: 'sub_1' })
  })

  it('cancels the subscription for a paused member', async () => {
    await runDelete(2, { squareSubscriptionId: 'sub_2', status: 'paused' })
    expect(cancel).toHaveBeenCalledWith({ subscriptionId: 'sub_2' })
  })

  it('skips when the member has no subscription', async () => {
    await runDelete(3, { squareSubscriptionId: null, status: 'active' })
    expect(cancel).not.toHaveBeenCalled()
  })

  it('skips when the subscription is already cancelled', async () => {
    await runDelete(4, { squareSubscriptionId: 'sub_4', status: 'cancelled' })
    expect(cancel).not.toHaveBeenCalled()
  })

  it('throws to block the delete when the Square cancel fails', async () => {
    cancel.mockRejectedValueOnce(new Error('square down'))
    await expect(runDelete(5, { squareSubscriptionId: 'sub_5', status: 'active' })).rejects.toThrow()
  })
})

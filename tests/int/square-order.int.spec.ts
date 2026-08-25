import { describe, it, expect, vi, beforeEach } from 'vitest'

const ordersCreate = vi.fn()
vi.mock('../../src/lib/square', () => ({
  getSquareClient: () => ({ orders: { create: ordersCreate } }),
  SQUARE_LOCATION_ID: () => 'LOC123',
}))

import { createItemizedOrder } from '../../src/lib/square-order'

function squareOrderResponse(totalCents: number, id = 'order_abc') {
  return { order: { id, totalMoney: { amount: BigInt(totalCents), currency: 'USD' } } }
}

const baseInput = {
  itemName: 'Class: Wheel Throwing',
  subtotalCents: 5000,
  discountCents: 0,
  taxRatePercent: 8.9,
  expectedTotalCents: 5445,
  referenceId: 'booking-42',
}

describe('createItemizedOrder', () => {
  beforeEach(() => { ordersCreate.mockReset() })

  it('builds a line item + order-scope tax and returns the id on an exact total match', async () => {
    ordersCreate.mockResolvedValue(squareOrderResponse(5445))
    const id = await createItemizedOrder(baseInput)
    expect(id).toBe('order_abc')
    const body = ordersCreate.mock.calls[0][0]
    expect(body.order.locationId).toBe('LOC123')
    expect(body.order.referenceId).toBe('booking-42')
    expect(body.order.lineItems).toEqual([
      { name: 'Class: Wheel Throwing', quantity: '1', basePriceMoney: { amount: 5000n, currency: 'USD' } },
    ])
    expect(body.order.taxes).toEqual([
      { name: 'WA sales tax', type: 'ADDITIVE', percentage: '8.9', scope: 'ORDER' },
    ])
    expect(body.order.discounts).toBeUndefined()
    expect(body.idempotencyKey).toEqual(expect.any(String))
  })

  it('adds a fixed-amount order-scope discount when a coupon applied', async () => {
    ordersCreate.mockResolvedValue(squareOrderResponse(4356))
    const id = await createItemizedOrder({
      ...baseInput, discountCents: 1000, discountName: 'Coupon SUMMER10', expectedTotalCents: 4356,
    })
    expect(id).toBe('order_abc')
    expect(ordersCreate.mock.calls[0][0].order.discounts).toEqual([
      { name: 'Coupon SUMMER10', type: 'FIXED_AMOUNT', amountMoney: { amount: 1000n, currency: 'USD' }, scope: 'ORDER' },
    ])
  })

  it('omits the tax line when the rate is 0', async () => {
    ordersCreate.mockResolvedValue(squareOrderResponse(5000))
    const id = await createItemizedOrder({ ...baseInput, taxRatePercent: 0, expectedTotalCents: 5000 })
    expect(id).toBe('order_abc')
    expect(ordersCreate.mock.calls[0][0].order.taxes).toBeUndefined()
  })

  it('omits the tax line when the discount consumes the whole subtotal-adjacent taxable', async () => {
    // taxable 0 (100%-ish coupon but a positive total can't happen; this guards the boundary)
    ordersCreate.mockResolvedValue(squareOrderResponse(0))
    const id = await createItemizedOrder({ ...baseInput, discountCents: 5000, discountName: 'Coupon ALL', expectedTotalCents: 0 })
    expect(id).toBe('order_abc')
    expect(ordersCreate.mock.calls[0][0].order.taxes).toBeUndefined()
  })

  it('returns null and logs when Square total mismatches ours', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    ordersCreate.mockResolvedValue(squareOrderResponse(5446))
    const id = await createItemizedOrder(baseInput)
    expect(id).toBeNull()
    expect(err).toHaveBeenCalledWith(expect.stringContaining('SQUARE ORDER TOTAL MISMATCH'))
    err.mockRestore()
  })

  it('returns null and logs when the Orders API throws', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    ordersCreate.mockRejectedValue(new Error('boom'))
    const id = await createItemizedOrder(baseInput)
    expect(id).toBeNull()
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })

  it('returns null when the response carries no order id', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    ordersCreate.mockResolvedValue({ order: undefined })
    expect(await createItemizedOrder(baseInput)).toBeNull()
    err.mockRestore()
  })
})

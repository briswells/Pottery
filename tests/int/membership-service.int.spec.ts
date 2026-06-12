import { describe, it, expect, vi, afterAll } from 'vitest'
import { getTestPayload } from './helpers'
import { createMembership } from '../../src/services/membership'
import type { MembershipGateway } from '../../src/lib/membership-gateway'

function fakeGateway(overrides: Partial<MembershipGateway> = {}) {
  return {
    createCustomer: vi.fn(async () => ({ customerId: 'cus_1' })),
    saveCard: vi.fn(async () => ({ cardId: 'card_1' })),
    createSubscription: vi.fn(async () => ({ subscriptionId: 'sub_1', status: 'ACTIVE' })),
    cancelSubscription: vi.fn(async () => undefined),
    listPlanVariations: vi.fn(async () => []),
    ...overrides,
  }
}

describe('createMembership', () => {
  it('creates a customer, card, subscription, and an active Member', async () => {
    const payload = await getTestPayload()
    const gw = fakeGateway()
    const sendEmail = vi.fn(async () => {})
    const member = await createMembership({ payload, gateway: gw, sendEmail }, {
      name: 'Pat', email: `pat-${Date.now()}@test.local`, phone: '555', sourceId: 'cnon:fake', planVariationId: 'PV_TEST',
    })
    expect(gw.createCustomer).toHaveBeenCalledOnce()
    expect(gw.saveCard).toHaveBeenCalledWith(expect.objectContaining({ customerId: 'cus_1', sourceId: 'cnon:fake' }))
    expect(gw.createSubscription).toHaveBeenCalledWith(expect.objectContaining({ customerId: 'cus_1', cardId: 'card_1' }))
    expect(member.status).toBe('active')
    expect(member.squareSubscriptionId).toBe('sub_1')
    expect(member.subscriptionStatus).toBe('ACTIVE')
    expect(sendEmail).toHaveBeenCalledOnce()
  })

  it('does not create a Member if the subscription call fails', async () => {
    const payload = await getTestPayload()
    const email = `fail-${Date.now()}@test.local`
    const gw = fakeGateway({ createSubscription: vi.fn(async () => { throw new Error('subscription failed') }) })
    await expect(
      createMembership({ payload, gateway: gw, sendEmail: vi.fn(async () => {}) }, { name: 'No', email, sourceId: 'cnon:x', planVariationId: 'PV_TEST' }),
    ).rejects.toThrow(/subscription failed/i)
    const found = await payload.find({ collection: 'people', where: { email: { equals: email } } })
    expect(found.totalDocs).toBe(0)
  })
})

// Keep the shared test DB clean for sibling suites (members is an auth collection;
// payments may reference members). Delete in FK-safe order.
afterAll(async () => {
  const payload = await getTestPayload()
  await payload.delete({ collection: 'payments', where: { type: { equals: 'membership' } }, overrideAccess: true })
  await payload.delete({ collection: 'people', where: { email: { contains: '@test.local' } }, overrideAccess: true })
})

import { describe, it, expect, vi, afterEach } from 'vitest'
import { getTestPayload } from './helpers'
import { handleSubscriptionCreated, ensureMemberForSubscriptionId } from '../../src/app/api/webhooks/square/route'

const sub = vi.hoisted(() => ({ create: vi.fn(), cancel: vi.fn(), pause: vi.fn() }))
vi.mock('../../src/lib/square', async (orig) => {
  const actual = await (orig() as Promise<any>)
  return { ...actual, getSquareClient: () => ({ subscriptions: sub }) }
})

function makeGateway(over: Partial<any> = {}) {
  return {
    getCustomer: vi.fn(async (id: string) => ({ id, email: `${id}@wh.local`, givenName: 'Web', familyName: 'Hook' })),
    listPlanVariations: vi.fn(async () => [] as any[]),
    getSubscription: vi.fn(async (id: string) => ({ id, customerId: 'cus_wh', planVariationId: 'PV_WH', status: 'ACTIVE' })),
    ...over,
  } as any
}
async function makeSquarePlan(payload: any, variationId: string) {
  return payload.create({ collection: 'membership-plans', overrideAccess: true, context: { fromPlanSync: true },
    data: { name: `Plan ${variationId}`, kind: 'square', squarePlanVariationId: variationId, active: true } })
}

describe('square webhook auto-create', () => {
  afterEach(async () => {
    const payload = await getTestPayload()
    await payload.delete({ collection: 'people', where: { email: { like: '@wh.local' } } })
    await payload.delete({ collection: 'membership-plans', where: { name: { like: 'Plan ' } } })
  })

  it('subscription.created creates a member from the event subscription object', async () => {
    const payload = await getTestPayload()
    await makeSquarePlan(payload, 'PV_WH')
    const gateway = makeGateway()
    const subscription = { id: 'sub_created', customer_id: 'cus_wh', plan_variation_id: 'PV_WH', status: 'ACTIVE', start_date: '2026-03-03' }
    const person = await handleSubscriptionCreated({ payload, gateway }, subscription)
    expect(person).toBeTruthy()
    expect(person!.squareSubscriptionId).toBe('sub_created')
    expect(person!.plan).toBeTruthy()
  })

  it('safety net: resolves an unknown subscription id via gateway.getSubscription and creates the member', async () => {
    const payload = await getTestPayload()
    await makeSquarePlan(payload, 'PV_WH')
    const gateway = makeGateway()
    const person = await ensureMemberForSubscriptionId({ payload, gateway }, 'sub_invoice')
    expect(gateway.getSubscription).toHaveBeenCalledWith('sub_invoice')
    expect(person).toBeTruthy()
    expect(person!.squareSubscriptionId).toBe('sub_invoice')
  })

  it('ensureMemberForSubscriptionId returns null when the id resolves to nothing', async () => {
    const payload = await getTestPayload()
    const gateway = makeGateway({ getSubscription: vi.fn(async () => null) })
    expect(await ensureMemberForSubscriptionId({ payload, gateway }, 'gone')).toBeNull()
  })
})

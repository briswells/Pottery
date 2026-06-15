import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { getTestPayload } from './helpers'
import { ensureMemberFromSubscription, mapSubscriptionStatus } from '../../src/services/square-member-sync'
import { upsertPersonByEmail } from '../../src/services/people'

// Block any real Square call from the reconcile hook so we can assert auto-create
// never provisions a NEW subscription (the subscription already exists in Square).
const sub = vi.hoisted(() => ({ create: vi.fn(), cancel: vi.fn(), pause: vi.fn() }))
vi.mock('../../src/lib/square', async (orig) => {
  const actual = await (orig() as Promise<any>)
  return { ...actual, getSquareClient: () => ({ subscriptions: sub }) }
})

// A fake gateway: only the methods the service uses (getCustomer + listPlanVariations for sync-on-miss).
function makeGateway(over: Partial<any> = {}) {
  return {
    getCustomer: vi.fn(async (id: string) => ({ id, email: `${id}@sq.local`, givenName: 'Sq', familyName: 'Person', phone: '555' })),
    listPlanVariations: vi.fn(async () => [] as any[]),
    ...over,
  } as any
}

async function makeSquarePlan(payload: any, variationId: string) {
  return payload.create({ collection: 'membership-plans', overrideAccess: true, context: { fromPlanSync: true },
    data: { name: `Plan ${variationId}`, kind: 'square', squarePlanVariationId: variationId, active: true } })
}

describe('mapSubscriptionStatus', () => {
  it('maps recognized Square statuses', () => {
    expect(mapSubscriptionStatus('ACTIVE')).toBe('active')
    expect(mapSubscriptionStatus('PAUSED')).toBe('paused')
    expect(mapSubscriptionStatus('CANCELED')).toBe('cancelled')
    expect(mapSubscriptionStatus('DEACTIVATED')).toBe('cancelled')
  })

  it('treats a scheduled cancellation (canceled_date set) as cancelled even while ACTIVE', () => {
    // This is the regression: Square reports ACTIVE until period end, but a member
    // who cancelled should not read as active.
    expect(mapSubscriptionStatus('ACTIVE', '2026-07-15')).toBe('cancelled')
  })

  it('returns undefined for an unknown status so callers keep the existing value', () => {
    expect(mapSubscriptionStatus('SOMETHING_NEW')).toBeUndefined()
    expect(mapSubscriptionStatus(undefined)).toBeUndefined()
  })
})

describe('ensureMemberFromSubscription', () => {
  beforeEach(() => { sub.create.mockClear() })
  afterEach(async () => {
    const payload = await getTestPayload()
    await payload.delete({ collection: 'people', where: { email: { like: '@sq.local' } } })
    await payload.delete({ collection: 'membership-plans', where: { name: { like: 'Plan ' } } })
  })

  it('creates a member from a subscription on a known plan and makes no Square subscription call', async () => {
    const payload = await getTestPayload()
    const plan = await makeSquarePlan(payload, 'PV_KNOWN')
    const gateway = makeGateway()
    const person = await ensureMemberFromSubscription({ payload, gateway }, {
      id: 'sub_known', customerId: 'cus_known', planVariationId: 'PV_KNOWN', status: 'ACTIVE', startDate: '2026-02-02',
    })
    expect(person).toBeTruthy()
    expect(person!.email).toBe('cus_known@sq.local')
    expect(person!.plan).toBe(plan.id)
    expect(person!.status).toBe('active')
    expect(person!.squareSubscriptionId).toBe('sub_known')
    expect(person!.subscriptionStatus).toBe('ACTIVE')
    expect(sub.create).not.toHaveBeenCalled()
  })

  it('is idempotent — a second call with the same subscription id creates no duplicate', async () => {
    const payload = await getTestPayload()
    await makeSquarePlan(payload, 'PV_IDEM')
    const gateway = makeGateway()
    const args = { id: 'sub_idem', customerId: 'cus_idem', planVariationId: 'PV_IDEM', status: 'ACTIVE' as const }
    const first = await ensureMemberFromSubscription({ payload, gateway }, args)
    const second = await ensureMemberFromSubscription({ payload, gateway }, args)
    expect(second!.id).toBe(first!.id)
    const count = await payload.count({ collection: 'people', where: { squareSubscriptionId: { equals: 'sub_idem' } } })
    expect(count.totalDocs).toBe(1)
  })

  it('promotes an existing non-member person (same email) in place — no duplicate', async () => {
    const payload = await getTestPayload()
    await makeSquarePlan(payload, 'PV_PROMO')
    const gateway = makeGateway()
    const existing = await upsertPersonByEmail({ payload }, { name: 'Walk In', email: 'cus_promo@sq.local' })
    expect(existing.status).toBe('none')
    const person = await ensureMemberFromSubscription({ payload, gateway }, {
      id: 'sub_promo', customerId: 'cus_promo', planVariationId: 'PV_PROMO', status: 'ACTIVE',
    })
    expect(person!.id).toBe(existing.id)
    expect(person!.status).toBe('active')
    expect(person!.squareSubscriptionId).toBe('sub_promo')
    const count = await payload.count({ collection: 'people', where: { email: { equals: 'cus_promo@sq.local' } } })
    expect(count.totalDocs).toBe(1)
  })

  it('syncs plans on a miss, then creates the member', async () => {
    const payload = await getTestPayload()
    const gateway = makeGateway({
      listPlanVariations: vi.fn(async () => [{ variationId: 'PV_SYNC', planName: 'Synced', variationName: 'Monthly', priceCents: 20000, cadence: 'MONTHLY' }]),
    })
    const person = await ensureMemberFromSubscription({ payload, gateway }, {
      id: 'sub_sync', customerId: 'cus_sync', planVariationId: 'PV_SYNC', status: 'ACTIVE',
    })
    expect(gateway.listPlanVariations).toHaveBeenCalled()
    expect(person).toBeTruthy()
    expect(person!.squareSubscriptionId).toBe('sub_sync')
    await payload.delete({ collection: 'membership-plans', where: { squarePlanVariationId: { equals: 'PV_SYNC' } }, overrideAccess: true })
  })

  it('returns null for an unknown plan variation (after attempting a sync)', async () => {
    const payload = await getTestPayload()
    const gateway = makeGateway()
    const person = await ensureMemberFromSubscription({ payload, gateway }, {
      id: 'sub_unknown', customerId: 'cus_unknown', planVariationId: 'PV_NOPE', status: 'ACTIVE',
    })
    expect(person).toBeNull()
  })

  it('does not sync plans when syncPlansOnMiss is false (caller synced upfront)', async () => {
    const payload = await getTestPayload()
    const gateway = makeGateway({ listPlanVariations: vi.fn(async () => [{ variationId: 'PV_NOSYNC', planName: 'X', variationName: 'M', priceCents: 1, cadence: 'MONTHLY' }]) })
    // Plan is NOT pre-created and we forbid sync-on-miss → must return null without calling listPlanVariations.
    const person = await ensureMemberFromSubscription({ payload, gateway, syncPlansOnMiss: false }, {
      id: 'sub_nosync', customerId: 'cus_nosync', planVariationId: 'PV_NOSYNC', status: 'ACTIVE',
    })
    expect(person).toBeNull()
    expect(gateway.listPlanVariations).not.toHaveBeenCalled()
  })

  it('returns null when customerId or planVariationId is missing', async () => {
    const payload = await getTestPayload()
    const gateway = makeGateway()
    expect(await ensureMemberFromSubscription({ payload, gateway }, { id: 'x', planVariationId: 'PV', status: 'ACTIVE' })).toBeNull()
    expect(await ensureMemberFromSubscription({ payload, gateway }, { id: 'y', customerId: 'cus', status: 'ACTIVE' })).toBeNull()
  })

  it('does not overwrite a different existing subscription on an email match', async () => {
    const payload = await getTestPayload()
    await makeSquarePlan(payload, 'PV_CONFLICT')
    const gateway = makeGateway()
    // A member who already has a DIFFERENT live subscription, same email as the incoming sub's customer.
    const existing = await payload.create({
      collection: 'people', overrideAccess: true, context: { fromSquareWebhook: true },
      data: { name: 'Resub', email: 'cus_conflict@sq.local', status: 'active', squareSubscriptionId: 'sub_OLD' },
    })
    const result = await ensureMemberFromSubscription({ payload, gateway }, {
      id: 'sub_NEW', customerId: 'cus_conflict', planVariationId: 'PV_CONFLICT', status: 'ACTIVE',
    })
    expect(result).toBeNull()
    const reloaded = await payload.findByID({ collection: 'people', id: existing.id, depth: 0 })
    expect(reloaded.squareSubscriptionId).toBe('sub_OLD') // unchanged, not overwritten
  })
})

import { describe, it, expect, vi } from 'vitest'
import { syncSquarePlans, ensureFreePlan } from '../../src/services/sync-square-plans'

function fakePayload(existing: any[] = []) {
  const calls: any[] = []
  return {
    calls,
    find: vi.fn(async ({ where }: any) => {
      const eqId = where?.squarePlanVariationId?.equals
      if (eqId) return { docs: existing.filter((d) => d.squarePlanVariationId === eqId) }
      const eqKind = where?.kind?.equals
      if (eqKind) return { docs: existing.filter((d) => d.kind === eqKind) }
      return { docs: [] }
    }),
    create: vi.fn(async ({ data }: any) => { calls.push(['create', data]); return { id: 'new', ...data } }),
    update: vi.fn(async ({ id, data }: any) => { calls.push(['update', id, data]); return { id, ...data } }),
  } as any
}

const gateway = (variations: any[]) => ({ listPlanVariations: vi.fn(async () => variations) }) as any

describe('syncSquarePlans', () => {
  it('creates a square plan record for a new variation', async () => {
    const payload = fakePayload([])
    await syncSquarePlans({ payload, gateway: gateway([
      { variationId: 'PV_1', planName: 'Studio', variationName: 'Monthly', priceCents: 20000, cadence: 'MONTHLY' },
    ]) })
    expect(payload.create).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'membership-plans',
        data: expect.objectContaining({ kind: 'square', squarePlanVariationId: 'PV_1', priceCents: 20000, cadence: 'MONTHLY', active: true }),
      }),
    )
  })

  it('updates an existing square plan record', async () => {
    const payload = fakePayload([{ id: 7, kind: 'square', squarePlanVariationId: 'PV_1' }])
    await syncSquarePlans({ payload, gateway: gateway([
      { variationId: 'PV_1', planName: 'Studio', variationName: 'Monthly', priceCents: 25000, cadence: 'MONTHLY' },
    ]) })
    expect(payload.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7, data: expect.objectContaining({ priceCents: 25000, active: true }) }),
    )
  })

  it('marks square plans missing from Square as inactive, never touches free plans', async () => {
    const payload = fakePayload([
      { id: 1, kind: 'square', squarePlanVariationId: 'PV_GONE', active: true },
      { id: 2, kind: 'free' },
    ])
    await syncSquarePlans({ payload, gateway: gateway([]) })
    expect(payload.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, data: expect.objectContaining({ active: false }) }),
    )
    expect(payload.update.mock.calls.find((c: any) => c[0].id === 2)).toBeUndefined()
  })
})

describe('ensureFreePlan', () => {
  it('creates a Free plan when none exists', async () => {
    const payload = fakePayload([])
    await ensureFreePlan(payload)
    expect(payload.create).toHaveBeenCalledWith(
      expect.objectContaining({ collection: 'membership-plans', data: expect.objectContaining({ kind: 'free', name: 'Free', active: true }) }),
    )
  })

  it('does nothing when a Free plan already exists', async () => {
    const payload = fakePayload([{ id: 9, kind: 'free' }])
    await ensureFreePlan(payload)
    expect(payload.create).not.toHaveBeenCalled()
  })
})

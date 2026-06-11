import { describe, it, expect, vi, beforeEach } from 'vitest'

const reconcileMock = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('../../src/services/membership', () => ({ reconcileMemberPlan: reconcileMock }))

import { reconcileMemberSubscription } from '../../src/hooks/reconcileMemberSubscription'

const baseReq: any = { payload: {}, context: {} }
const baseDoc: any = { id: 1, name: 'A', email: 'a@test.local', phone: null, plan: 'p_a', squareSubscriptionId: null }

async function ran(args: any) {
  reconcileMock.mockClear()
  await reconcileMemberSubscription({ operation: 'create', req: baseReq, doc: baseDoc, previousDoc: undefined, ...args } as any)
  return reconcileMock.mock.calls.length > 0
}

describe('reconcileMemberSubscription hook guards', () => {
  beforeEach(() => reconcileMock.mockClear())

  it('runs on create', async () => {
    expect(await ran({})).toBe(true)
  })
  it('runs on update when the plan changed', async () => {
    expect(await ran({ operation: 'update', doc: { ...baseDoc, plan: 'p_b' }, previousDoc: { plan: 'p_a' } })).toBe(true)
  })
  it('skips on update when the plan is unchanged', async () => {
    expect(await ran({ operation: 'update', doc: { ...baseDoc, plan: 'p_a' }, previousDoc: { plan: 'p_a' } })).toBe(false)
  })
  it('skips our own write-back', async () => {
    expect(await ran({ req: { ...baseReq, context: { fromMemberHook: true } } })).toBe(false)
  })
  it('skips the Square webhook', async () => {
    expect(await ran({ req: { ...baseReq, context: { fromSquareWebhook: true } } })).toBe(false)
  })
})

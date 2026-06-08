import { describe, it, expect, vi, beforeEach } from 'vitest'

// Replace the service so the hook never reaches Square. Must be a separate file
// from the tests that exercise the REAL service (vi.mock is per-file).
// vi.hoisted so the mock fn exists when the hoisted vi.mock factory runs.
const provisionMock = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('../../src/services/membership', () => ({ provisionMemberSubscription: provisionMock }))

import { provisionSquareSubscription } from '../../src/hooks/provisionSquareSubscription'

const baseReq: any = { payload: {}, context: {} }
const baseDoc: any = { id: 1, name: 'A', email: 'a@test.local', phone: null, status: 'active', squareSubscriptionId: null }

async function didProvision(args: any) {
  provisionMock.mockClear()
  await provisionSquareSubscription({ operation: 'create', req: baseReq, doc: baseDoc, ...args } as any)
  return provisionMock.mock.calls.length > 0
}

describe('provisionSquareSubscription hook guards', () => {
  beforeEach(() => provisionMock.mockClear())

  it('provisions on create of an active, unlinked member', async () => {
    expect(await didProvision({})).toBe(true)
  })
  it('skips on update', async () => {
    expect(await didProvision({ operation: 'update' })).toBe(false)
  })
  it('skips when not active', async () => {
    expect(await didProvision({ doc: { ...baseDoc, status: 'paused' } })).toBe(false)
  })
  it('skips when already linked to Square', async () => {
    expect(await didProvision({ doc: { ...baseDoc, squareSubscriptionId: 'sub_existing' } })).toBe(false)
  })
  it('skips when triggered by our own hook write-back', async () => {
    expect(await didProvision({ req: { ...baseReq, context: { fromMemberHook: true } } })).toBe(false)
  })
  it('skips when triggered by the Square webhook', async () => {
    expect(await didProvision({ req: { ...baseReq, context: { fromSquareWebhook: true } } })).toBe(false)
  })
})

import { describe, it, expect, vi, afterAll, beforeEach } from 'vitest'
import { getTestPayload } from './helpers'

// Spy on the Square client so we can assert it is never constructed/called for a
// planless person. getSquareClient is the single entry point the hooks use.
const sub = vi.hoisted(() => ({ create: vi.fn(), cancel: vi.fn(), pause: vi.fn() }))
vi.mock('../../src/lib/square', async (orig) => {
  const actual = await (orig() as Promise<any>)
  return {
    ...actual,
    getSquareClient: () => ({ subscriptions: sub }),
  }
})

describe('planless person', () => {
  beforeEach(() => { sub.create.mockClear(); sub.cancel.mockClear(); sub.pause.mockClear() })
  afterAll(async () => {
    const payload = await getTestPayload()
    await payload.delete({ collection: 'people', where: { email: { like: '@nosq.local' } } })
  })

  it('creating and updating a person with no plan makes no Square subscription', async () => {
    const payload = await getTestPayload()
    const p = await payload.create({ collection: 'people', overrideAccess: true, data: { name: 'No Plan', email: 'np@nosq.local' } })
    await payload.update({ collection: 'people', id: p.id, overrideAccess: true, data: { phone: '555', notes: 'walk-in' } })
    expect(sub.create).not.toHaveBeenCalled()
    expect(sub.cancel).not.toHaveBeenCalled()
    expect(sub.pause).not.toHaveBeenCalled()
  })
})

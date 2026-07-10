import { describe, it, expect, afterAll } from 'vitest'
import { getTestPayload } from './helpers'
import { ensureInvoicedPlan, INVOICED_PLAN_NAME } from '../../src/services/sync-square-plans'

describe('ensureInvoicedPlan', () => {
  it('creates the invoiced plan once and returns its id on repeat calls', async () => {
    const p = await getTestPayload()
    const id1 = await ensureInvoicedPlan(p)
    const id2 = await ensureInvoicedPlan(p)
    expect(id1).toBe(id2)
    const plan = await p.findByID({ collection: 'membership-plans', id: id1, overrideAccess: true })
    expect(plan.name).toBe(INVOICED_PLAN_NAME)
    expect(plan.kind).toBe('free')
    expect(plan.active).toBe(true)
  })
})

afterAll(async () => {
  const p = await getTestPayload()
  await p.delete({ collection: 'membership-plans', where: { name: { equals: INVOICED_PLAN_NAME } }, overrideAccess: true })
})

import { describe, it, expect, vi, afterAll } from 'vitest'
import { getTestPayload } from './helpers'
import { handleMembershipInvoiceEvent } from '../../src/app/api/webhooks/square/route'

const EM = () => `wh-${Date.now()}-${Math.floor(Math.random() * 1e5)}@invwhtest.local`
function fakeGateway(invoices: any[]) {
  return {
    listInvoices: vi.fn(async (args?: { customerId?: string }) =>
      invoices.filter((i) => !args?.customerId || i.customerId === args.customerId)),
    getCustomer: vi.fn(), listPlanVariations: vi.fn(async () => []), getSubscription: vi.fn(),
  } as any
}

describe('handleMembershipInvoiceEvent', () => {
  it('updates the person for a membership invoice without subscription_id', async () => {
    const p = await getTestPayload()
    const email = EM()
    const g = fakeGateway([{ customerId: 'C-WH', email, title: 'Membership', status: 'SCHEDULED', createdAt: '2026-01-01T00:00:00Z' }])
    await handleMembershipInvoiceEvent({ payload: p, gateway: g }, {
      title: 'Membership', primary_recipient: { customer_id: 'C-WH' },
    })
    const { docs } = await p.find({ collection: 'people', where: { email: { equals: email } }, overrideAccess: true })
    expect(docs[0]?.status).toBe('active')
  })

  it('ignores subscription-backed and non-membership invoices', async () => {
    const p = await getTestPayload()
    const g = fakeGateway([])
    await handleMembershipInvoiceEvent({ payload: p, gateway: g }, {
      title: 'Membership', subscription_id: 'sub_1', primary_recipient: { customer_id: 'C-1' },
    })
    await handleMembershipInvoiceEvent({ payload: p, gateway: g }, {
      title: 'Kiln repair', primary_recipient: { customer_id: 'C-2' },
    })
    expect(g.listInvoices).not.toHaveBeenCalled()
  })
})

afterAll(async () => {
  const p = await getTestPayload()
  await p.delete({ collection: 'people', where: { email: { contains: '@invwhtest.local' } }, overrideAccess: true })
})

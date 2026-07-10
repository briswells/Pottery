import { describe, it, expect, vi, afterAll } from 'vitest'
import { getTestPayload } from './helpers'
import {
  deriveInvoiceMemberStatus,
  reconcileInvoiceMembers,
  reconcileOneInvoiceMember,
} from '../../src/services/reconcile-invoice-members'
import { INVOICED_PLAN_NAME } from '../../src/services/sync-square-plans'
import type { MemberInvoice } from '../../src/lib/membership-gateway'

const NOW = new Date('2026-07-10T12:00:00Z')
const EM = (t: string) => `${t}-${Date.now()}-${Math.floor(Math.random() * 1e5)}@invtest.local`
const inv = (over: Partial<MemberInvoice> = {}): MemberInvoice => ({
  customerId: 'CUST1', email: 'x@invtest.local', givenName: 'Inv', familyName: 'Member',
  title: 'Membership', status: 'SCHEDULED', createdAt: '2026-01-01T00:00:00Z', ...over,
})
function fakeGateway(invoices: MemberInvoice[]) {
  return {
    listInvoices: vi.fn(async (args?: { customerId?: string }) =>
      args?.customerId ? invoices.filter((i) => i.customerId === args.customerId) : invoices),
    // unused MembershipGateway members for these tests:
    getCustomer: vi.fn(), listPlanVariations: vi.fn(async () => []), getSubscription: vi.fn(),
  } as any
}

describe('deriveInvoiceMemberStatus', () => {
  it('scheduled only → active', () => {
    expect(deriveInvoiceMemberStatus([inv()], 3, NOW)).toBe('active')
  })
  it('scheduled + unpaid overdue past grace → past_due', () => {
    expect(deriveInvoiceMemberStatus([inv(), inv({ status: 'UNPAID', dueDate: '2026-07-01' })], 3, NOW)).toBe('past_due')
  })
  it('scheduled + unpaid due yesterday (within grace) → active', () => {
    expect(deriveInvoiceMemberStatus([inv(), inv({ status: 'UNPAID', dueDate: '2026-07-09' })], 3, NOW)).toBe('active')
  })
  it('no scheduled → cancelled, even with unpaid leftovers', () => {
    expect(deriveInvoiceMemberStatus([inv({ status: 'PAID' }), inv({ status: 'UNPAID', dueDate: '2026-06-01' })], 3, NOW)).toBe('cancelled')
  })
})

describe('reconcileInvoiceMembers', () => {
  it('creates a member with the invoiced plan, active status, joinedDate from earliest invoice', async () => {
    const p = await getTestPayload()
    const email = EM('create')
    const g = fakeGateway([
      inv({ customerId: 'C-A', email, createdAt: '2026-03-05T00:00:00Z' }),
      inv({ customerId: 'C-A', email, status: 'PAID', createdAt: '2026-02-01T00:00:00Z' }),
    ])
    const r = await reconcileInvoiceMembers({ payload: p, gateway: g })
    expect(r.processed).toBe(1)
    expect(r.active).toBe(1)
    const { docs } = await p.find({ collection: 'people', where: { email: { equals: email } }, depth: 1, overrideAccess: true })
    const person: any = docs[0]
    expect(person.status).toBe('active')
    expect(person.squareCustomerId).toBe('C-A')
    expect(person.plan?.name).toBe(INVOICED_PLAN_NAME)
    expect(person.joinedDate?.slice(0, 10)).toBe('2026-02-01')
  })

  it('flips to past_due and back to active idempotently, and cancels when the series ends', async () => {
    const p = await getTestPayload()
    const email = EM('flip')
    const base = { customerId: 'C-B', email }
    let r = await reconcileInvoiceMembers({ payload: p, gateway: fakeGateway([inv(base)]) })
    expect(r.active).toBe(1)
    r = await reconcileInvoiceMembers({ payload: p, gateway: fakeGateway([inv(base), inv({ ...base, status: 'UNPAID', dueDate: '2026-07-01' })]) })
    expect(r.pastDue).toBe(1)
    // series cancelled → no scheduled left
    r = await reconcileInvoiceMembers({ payload: p, gateway: fakeGateway([inv({ ...base, status: 'PAID' })]) })
    expect(r.cancelled).toBe(1)
    // new series later → active again
    r = await reconcileInvoiceMembers({ payload: p, gateway: fakeGateway([inv(base)]) })
    expect(r.active).toBe(1)
    const { docs } = await p.find({ collection: 'people', where: { email: { equals: email } }, overrideAccess: true })
    expect(docs).toHaveLength(1) // same person throughout, no duplicates
    expect(docs[0].status).toBe('active')
  })

  it('skips subscription members and never overwrites a different plan', async () => {
    const p = await getTestPayload()
    const subEmail = EM('sub')
    await p.create({ collection: 'people', overrideAccess: true, data: {
      name: 'Sub Member', email: subEmail, status: 'active', squareSubscriptionId: 'sub_123',
    } })
    const freePlan = (await p.find({ collection: 'membership-plans', where: { kind: { equals: 'free' }, name: { not_equals: INVOICED_PLAN_NAME } }, overrideAccess: true })).docs[0]
      ?? await p.create({ collection: 'membership-plans', overrideAccess: true, context: { fromPlanSync: true }, data: { name: 'Free', kind: 'free', active: true } })
    const manualEmail = EM('manual')
    await p.create({ collection: 'people', overrideAccess: true, data: {
      name: 'Manual Member', email: manualEmail, status: 'active', plan: freePlan.id,
    } })
    const r = await reconcileInvoiceMembers({ payload: p, gateway: fakeGateway([
      inv({ customerId: 'C-SUB', email: subEmail }),
      inv({ customerId: 'C-MAN', email: manualEmail }),
    ]) })
    expect(r.skipped).toBe(1) // the subscription member
    const sub = (await p.find({ collection: 'people', where: { email: { equals: subEmail } }, overrideAccess: true })).docs[0]
    expect(sub.squareCustomerId ?? null).toBeNull() // untouched
    const man: any = (await p.find({ collection: 'people', where: { email: { equals: manualEmail } }, depth: 1, overrideAccess: true })).docs[0]
    expect(man.plan?.name).toBe('Free') // different plan NOT overwritten
    expect(man.squareCustomerId).toBe('C-MAN') // but customer link + status still synced
  })

  it('ignores non-membership invoices and counts customer-less ones as skipped', async () => {
    const p = await getTestPayload()
    const r = await reconcileInvoiceMembers({ payload: p, gateway: fakeGateway([
      inv({ customerId: 'C-X', email: EM('other'), title: 'Kiln repair' }),
      inv({ customerId: undefined, email: undefined }),
    ]) })
    expect(r.processed).toBe(0)
    expect(r.skipped).toBe(1)
  })

  it('sends no email ever (module has no email import) and one-customer variant works', async () => {
    const p = await getTestPayload()
    const email = EM('one')
    const g = fakeGateway([inv({ customerId: 'C-ONE', email })])
    await reconcileOneInvoiceMember({ payload: p, gateway: g }, 'C-ONE')
    expect(g.listInvoices).toHaveBeenCalledWith({ customerId: 'C-ONE' })
    const { docs } = await p.find({ collection: 'people', where: { email: { equals: email } }, overrideAccess: true })
    expect(docs[0].status).toBe('active')
    // static no-email guarantee:
    const fs = await import('fs')
    const src = fs.readFileSync('src/services/reconcile-invoice-members.ts', 'utf8')
    expect(src).not.toMatch(/sendEmail|getNotifyEmail/)
  })
})

afterAll(async () => {
  const p = await getTestPayload()
  await p.delete({ collection: 'people', where: { email: { contains: '@invtest.local' } }, overrideAccess: true })
})

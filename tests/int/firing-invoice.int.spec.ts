import { describe, it, expect, vi, afterAll } from 'vitest'
import { getTestPayload } from './helpers'
import { createAndSendFiringInvoice } from '../../src/services/firing-invoice'
import type { FiringInvoiceGateway } from '../../src/lib/firing-invoice-gateway'

function fakeGateway(overrides: Partial<FiringInvoiceGateway> = {}): FiringInvoiceGateway {
  return {
    createAndSendInvoice: vi.fn(async () => ({
      invoiceId: 'inv_1',
      invoiceUrl: 'https://squareup.com/pay/inv_1',
      status: 'UNPAID',
      customerId: 'cus_1',
    })),
    ...overrides,
  }
}

async function makeRequest(payload: any, quotedPriceCents: number | undefined) {
  return payload.create({
    collection: 'firing-requests',
    overrideAccess: true,
    data: {
      name: `Firer ${Date.now()}`,
      email: `firer-${Date.now()}@test.local`,
      description: 'A tall vase',
      quantity: 1,
      status: 'approved',
      quotedPriceCents,
    },
  })
}

describe('createAndSendFiringInvoice', () => {
  it('invoices using the DB price and marks the request invoiced', async () => {
    const payload = await getTestPayload()
    const req = await makeRequest(payload, 4500)
    const gw = fakeGateway()
    const updated = await createAndSendFiringInvoice({ payload, gateway: gw }, req)

    expect(gw.createAndSendInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ amountCents: 4500, email: req.email }),
    )
    expect(updated.status).toBe('invoiced')
    expect(updated.squareInvoiceId).toBe('inv_1')
    expect(updated.squareInvoiceUrl).toBe('https://squareup.com/pay/inv_1')
    expect(updated.invoicedAt).toBeTruthy()
  })

  it('marks the request invoice_failed (no invoice id) when the gateway throws', async () => {
    const payload = await getTestPayload()
    const req = await makeRequest(payload, 4500)
    const gw = fakeGateway({ createAndSendInvoice: vi.fn(async () => { throw new Error('square exploded') }) })
    const updated = await createAndSendFiringInvoice({ payload, gateway: gw }, req)

    expect(updated.status).toBe('invoice_failed')
    expect(updated.lastInvoiceError).toMatch(/square exploded/i)
    expect(updated.squareInvoiceId ?? null).toBeNull()
  })

  it('threads the caller transaction (req) into its DB writes so it cannot deadlock the parent save', async () => {
    // Regression: the afterChange hook runs inside the admin save's transaction,
    // which holds a row lock on the firing-request. If these writes run in a
    // SEPARATE transaction (no req), they block on that lock forever — the save
    // hangs and rolls back. Passing req makes them join the parent transaction.
    //
    // The service now also calls upsertPersonByEmail, which calls payload.find
    // then conditionally payload.update/create. We stub find to return a fully-
    // enriched existing person (phone + squareCustomerId already set) so the
    // upsert takes the "found, nothing to enrich" early-return path and doesn't
    // need a create stub. We then assert find itself also received req, proving
    // the threading extends through the person-upsert path as well.
    const req = { transactionID: 'tx_test' } as any
    const update = vi.fn(async (args: any) => ({ id: args.id, ...args.data }))
    const find = vi.fn(async () => ({
      docs: [{ id: 999, phone: 'x', squareCustomerId: 'cus_existing' }],
    }))
    const payload = { update, find } as any
    const request = {
      id: 'r1',
      name: 'X',
      email: 'x@test.local',
      phone: null,
      description: 'd',
      quotedPriceCents: 4500,
    } as any

    await createAndSendFiringInvoice({ payload, gateway: fakeGateway(), req }, request)

    expect(find).toHaveBeenCalledWith(expect.objectContaining({ req }))
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ req }))
  })

  it('fails without charging when no price is set', async () => {
    const payload = await getTestPayload()
    const req = await makeRequest(payload, undefined)
    const gw = fakeGateway()
    const updated = await createAndSendFiringInvoice({ payload, gateway: gw }, req)

    expect(gw.createAndSendInvoice).not.toHaveBeenCalled()
    expect(updated.status).toBe('invoice_failed')
    expect(updated.lastInvoiceError).toMatch(/price/i)
  })
})

afterAll(async () => {
  const payload = await getTestPayload()
  await payload.delete({ collection: 'payments', where: { type: { equals: 'firing' } }, overrideAccess: true })
  await payload.delete({ collection: 'firing-requests', where: { email: { contains: '@test.local' } }, overrideAccess: true })
})

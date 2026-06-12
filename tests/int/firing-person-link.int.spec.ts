import { describe, it, expect, afterAll } from 'vitest'
import { getTestPayload } from './helpers'
import { createAndSendFiringInvoice } from '../../src/services/firing-invoice'

// A fake gateway so the test never calls Square; it returns a customer id we then
// assert lands on the linked Person.
const fakeGateway = {
  createAndSendInvoice: async () => ({ customerId: 'cus_firing_1', invoiceId: 'inv_1', invoiceUrl: 'https://x/inv_1' }),
}

describe('createAndSendFiringInvoice person link', () => {
  afterAll(async () => {
    const payload = await getTestPayload()
    await payload.delete({ collection: 'firing-requests', where: { email: { like: '@firing.local' } } })
    await payload.delete({ collection: 'people', where: { email: { like: '@firing.local' } } })
  })

  it('links the firing to a person carrying the Square customer id', async () => {
    const payload = await getTestPayload()
    const req = await payload.create({
      collection: 'firing-requests', overrideAccess: true,
      data: { name: 'Fire Person', email: 'fp@firing.local', description: 'a pot', quotedPriceCents: 4500, status: 'submitted' },
    })
    await createAndSendFiringInvoice({ payload, gateway: fakeGateway as any }, req as any)

    const updated = await payload.findByID({ collection: 'firing-requests', id: req.id, depth: 0 })
    expect(updated.person).toBeTruthy()
    const person = await payload.findByID({ collection: 'people', id: updated.person as number })
    expect(person.squareCustomerId).toBe('cus_firing_1')
    expect(person.status).toBe('none')
  })
})

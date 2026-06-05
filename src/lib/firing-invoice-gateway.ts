import { randomUUID } from 'crypto'
import { getSquareClient, SQUARE_LOCATION_ID } from './square'

export interface FiringInvoiceInput {
  name: string
  email: string
  phone?: string
  description: string
  amountCents: number
  referenceId: string
}

export interface FiringInvoiceResult {
  invoiceId: string
  invoiceUrl: string
  status: string
}

export interface FiringInvoiceGateway {
  createAndSendInvoice(input: FiringInvoiceInput): Promise<FiringInvoiceResult>
}

function dueDateString(now: Date): string {
  const d = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
  return d.toISOString().slice(0, 10)
}

export const squareFiringInvoiceGateway: FiringInvoiceGateway = {
  async createAndSendInvoice(input) {
    const client = getSquareClient()
    const locationId = SQUARE_LOCATION_ID()

    const customerRes = await client.customers.create({
      idempotencyKey: randomUUID(),
      givenName: input.name,
      emailAddress: input.email,
      phoneNumber: input.phone,
    })
    const customerId = customerRes.customer?.id
    if (!customerId) throw new Error('Square customer was not created')

    const orderRes = await client.orders.create({
      idempotencyKey: randomUUID(),
      order: {
        locationId,
        lineItems: [
          {
            name: `Cone 10 firing — ${input.description}`.slice(0, 500),
            quantity: '1',
            basePriceMoney: { amount: BigInt(input.amountCents), currency: 'USD' },
          },
        ],
      },
    })
    const orderId = orderRes.order?.id
    if (!orderId) throw new Error('Square order was not created')

    const invoiceRes = await client.invoices.create({
      idempotencyKey: randomUUID(),
      invoice: {
        locationId,
        orderId,
        primaryRecipient: { customerId },
        deliveryMethod: 'EMAIL',
        acceptedPaymentMethods: { card: true },
        paymentRequests: [
          { requestType: 'BALANCE', dueDate: dueDateString(new Date()), automaticPaymentSource: 'NONE' },
        ],
      },
    })
    const invoice = invoiceRes.invoice
    if (!invoice?.id) throw new Error('Square invoice was not created')

    const publishedRes = await client.invoices.publish({
      invoiceId: invoice.id,
      version: invoice.version ?? 0,
      idempotencyKey: randomUUID(),
    })
    const published = publishedRes.invoice
    return {
      invoiceId: published?.id ?? invoice.id,
      invoiceUrl: published?.publicUrl ?? '',
      status: published?.status ?? 'UNPAID',
    }
  },
}

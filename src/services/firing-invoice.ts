import type { Payload } from 'payload'
import type { FiringInvoiceGateway } from '../lib/firing-invoice-gateway'
import type { FiringRequest } from '../payload-types'

export interface FiringInvoiceDeps {
  payload: Payload
  gateway: FiringInvoiceGateway
}

export async function createAndSendFiringInvoice(
  deps: FiringInvoiceDeps,
  request: FiringRequest,
): Promise<FiringRequest> {
  const { payload, gateway } = deps

  const amountCents = request.quotedPriceCents ?? 0
  if (!amountCents || amountCents <= 0) {
    return payload.update({
      collection: 'firing-requests',
      id: request.id,
      overrideAccess: true,
      context: { fromFiringHook: true },
      data: { status: 'invoice_failed', lastInvoiceError: 'Set a quoted price before approving.' },
    })
  }

  try {
    const result = await gateway.createAndSendInvoice({
      name: request.name,
      email: request.email,
      phone: request.phone ?? undefined,
      description: request.description,
      amountCents,
      referenceId: `firing-${request.id}`,
    })
    return await payload.update({
      collection: 'firing-requests',
      id: request.id,
      overrideAccess: true,
      context: { fromFiringHook: true },
      data: {
        status: 'invoiced',
        squareCustomerId: result.customerId,
        squareInvoiceId: result.invoiceId,
        squareInvoiceUrl: result.invoiceUrl,
        invoicedAt: new Date().toISOString(),
        lastInvoiceError: null,
      },
    })
  } catch (e) {
    return payload.update({
      collection: 'firing-requests',
      id: request.id,
      overrideAccess: true,
      context: { fromFiringHook: true },
      data: { status: 'invoice_failed', lastInvoiceError: e instanceof Error ? e.message : String(e) },
    })
  }
}

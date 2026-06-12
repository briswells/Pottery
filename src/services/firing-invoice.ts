import type { Payload, PayloadRequest } from 'payload'
import type { FiringInvoiceGateway } from '../lib/firing-invoice-gateway'
import type { FiringRequest } from '../payload-types'
import { upsertPersonByEmail } from './people'

export interface FiringInvoiceDeps {
  payload: Payload
  gateway: FiringInvoiceGateway
  // The request from the triggering hook. Threaded into every payload.update so
  // those writes JOIN the caller's open transaction instead of opening a separate
  // one — a separate transaction blocks forever on the row lock the parent save
  // already holds (self-deadlock → the admin save hangs and rolls back).
  req?: PayloadRequest
}

export async function createAndSendFiringInvoice(
  deps: FiringInvoiceDeps,
  request: FiringRequest,
): Promise<FiringRequest> {
  const { payload, gateway, req } = deps

  const amountCents = request.quotedPriceCents ?? 0
  if (!amountCents || amountCents <= 0) {
    return payload.update({
      collection: 'firing-requests',
      id: request.id,
      overrideAccess: true,
      req,
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
    let personId: number | undefined
    try {
      const person = await upsertPersonByEmail(
        { payload, req },
        { name: request.name, email: request.email, phone: request.phone, squareCustomerId: result.customerId },
      )
      personId = person.id
    } catch (e) {
      // The invoice was already sent — the person link is enrichment and must not
      // turn a successful send into invoice_failed. Log and proceed; backfill can link later.
      console.error(`Firing ${request.id} person link failed:`, e)
    }
    return await payload.update({
      collection: 'firing-requests',
      id: request.id,
      overrideAccess: true,
      req,
      context: { fromFiringHook: true },
      data: {
        status: 'invoiced',
        ...(personId ? { person: personId } : {}),
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
      req,
      context: { fromFiringHook: true },
      data: { status: 'invoice_failed', lastInvoiceError: e instanceof Error ? e.message : String(e) },
    })
  }
}

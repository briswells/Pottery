import type { CollectionAfterChangeHook } from 'payload'
import { squareFiringInvoiceGateway } from '../lib/firing-invoice-gateway'
import { createAndSendFiringInvoice } from '../services/firing-invoice'
import type { FiringRequest } from '../payload-types'

export const sendFiringInvoice: CollectionAfterChangeHook<FiringRequest> = async ({ doc, operation, req }) => {
  if (operation !== 'update') return doc
  if (req?.context?.fromFiringHook) return doc
  if (doc.status !== 'approved') return doc
  if (doc.squareInvoiceId) return doc

  try {
    await createAndSendFiringInvoice(
      { payload: req.payload, gateway: squareFiringInvoiceGateway, req },
      doc,
    )
  } catch (e) {
    console.error(`Firing invoice send failed for request ${doc.id}:`, e)
  }
  return doc
}

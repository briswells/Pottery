import { randomUUID } from 'crypto'
import { getSquareClient, SQUARE_LOCATION_ID } from './square'

export interface ChargeInput {
  sourceId: string
  amountCents: number
  referenceId?: string
  note?: string
}

export interface ChargeResult {
  paymentId: string
  status: string
}

/** Charges a tokenized card once. Amount is provided by the server, never the client. */
export async function chargeCard(input: ChargeInput): Promise<ChargeResult> {
  const client = getSquareClient()
  const res = await client.payments.create({
    sourceId: input.sourceId,
    idempotencyKey: randomUUID(),
    amountMoney: { amount: BigInt(input.amountCents), currency: 'USD' },
    locationId: SQUARE_LOCATION_ID(),
    autocomplete: true,
    referenceId: input.referenceId,
    note: input.note,
  })
  const payment = res.payment
  if (!payment?.id) throw new Error('Square payment did not return an id')
  return { paymentId: payment.id, status: payment.status ?? 'UNKNOWN' }
}

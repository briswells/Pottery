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

// Human messages for Square decline codes. The SDK's own error message is the
// raw HTTP dump ("Status code: 400 Body: {...}") and must never reach a customer.
const DECLINE_MESSAGES: Record<string, string> = {
  ADDRESS_VERIFICATION_FAILURE:
    'Your card was declined because the postal code did not match. Please check it and try again.',
  CVV_FAILURE: 'Your card was declined because the security code (CVV) did not match.',
  CARD_EXPIRED: 'That card has expired — please use a different card.',
  INVALID_EXPIRATION: 'The card expiration date is invalid.',
  INSUFFICIENT_FUNDS: 'Your card was declined due to insufficient funds.',
  CARD_DECLINED: 'Your card was declined. Please try a different card.',
  GENERIC_DECLINE: 'Your card was declined. Please try a different card.',
  CARD_DECLINED_CALL_ISSUER: 'Your card was declined — please contact your card issuer or try a different card.',
  TRANSACTION_LIMIT: 'This charge exceeds a limit on your card. Please try a different card.',
}

const GENERIC_MESSAGE = 'Your payment could not be processed. Please check your card details and try again.'

/** Translate a thrown Square error into a customer-safe message (never the raw dump). */
export function friendlyChargeError(e: unknown): string {
  const err = e as { errors?: { code?: string }[]; body?: unknown }
  let errors = err?.errors
  if (!errors && err?.body) {
    try {
      const body = typeof err.body === 'string' ? JSON.parse(err.body) : err.body
      errors = (body as { errors?: { code?: string }[] })?.errors
    } catch {
      /* fall through to generic */
    }
  }
  const code = errors?.[0]?.code
  return (code && DECLINE_MESSAGES[code]) || GENERIC_MESSAGE
}

/** Charges a tokenized card once. Amount is provided by the server, never the client. */
export async function chargeCard(input: ChargeInput): Promise<ChargeResult> {
  const client = getSquareClient()
  let res
  try {
    res = await client.payments.create({
      sourceId: input.sourceId,
      idempotencyKey: randomUUID(),
      amountMoney: { amount: BigInt(input.amountCents), currency: 'USD' },
      locationId: SQUARE_LOCATION_ID(),
      autocomplete: true,
      referenceId: input.referenceId,
      note: input.note,
    })
  } catch (e) {
    // Full detail server-side for diagnostics; customer gets the safe message.
    console.error(`Square charge failed (${input.referenceId ?? 'no ref'}):`, e)
    throw new Error(friendlyChargeError(e))
  }
  const payment = res.payment
  if (!payment?.id) throw new Error('Square payment did not return an id')
  return { paymentId: payment.id, status: payment.status ?? 'UNKNOWN' }
}

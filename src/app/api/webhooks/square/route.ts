import { getPayload } from 'payload'
import config from '@payload-config'
import { WebhooksHelper } from 'square'

export async function POST(req: Request) {
  const requestBody = await req.text() // raw body required for signature verification
  const signature = req.headers.get('x-square-hmacsha256-signature') ?? ''
  const notificationUrl = `${process.env.PUBLIC_BASE_URL}/api/webhooks/square`

  const isValid = await WebhooksHelper.verifySignature({
    requestBody,
    signatureHeader: signature,
    signatureKey: process.env.SQUARE_WEBHOOK_SIGNATURE_KEY!,
    notificationUrl,
  })
  if (!isValid) return new Response('Invalid signature', { status: 401 })

  const event = JSON.parse(requestBody)
  const payload = await getPayload({ config: await config })

  // Reconcile a booking's status from a Square event, keyed on the Square
  // payment id we stored at booking time. Idempotent: only writes on change.
  async function reconcileBooking(squarePaymentId: string | undefined, nextStatus: string | undefined) {
    if (!squarePaymentId || !nextStatus) return
    const { docs } = await payload.find({
      collection: 'bookings',
      where: { squarePaymentId: { equals: squarePaymentId } },
      limit: 1,
    })
    const booking = docs[0]
    if (!booking || booking.status === nextStatus) return
    await payload.update({
      collection: 'bookings',
      id: booking.id,
      overrideAccess: true,
      data: { status: nextStatus as typeof booking.status },
    })
  }

  if (event.type === 'payment.updated') {
    // A captured payment that gets voided lands in CANCELED; a failed capture in FAILED.
    const payment = event.data?.object?.payment
    const status: string | undefined = payment?.status // COMPLETED | FAILED | CANCELED | ...
    const map: Record<string, string> = { CANCELED: 'refunded', FAILED: 'cancelled' }
    await reconcileBooking(payment?.id, status ? map[status] : undefined)
  } else if (event.type === 'refund.updated' || event.type === 'refund.created') {
    // A dashboard/API refund leaves the payment COMPLETED and emits a refund.*
    // event instead, so mark the booking refunded once the refund completes.
    const refund = event.data?.object?.refund
    const status: string | undefined = refund?.status // PENDING | COMPLETED | REJECTED | FAILED
    await reconcileBooking(refund?.payment_id, status === 'COMPLETED' ? 'refunded' : undefined)
  }

  // Membership events (invoice.*, subscription.updated) are handled in Plan 3.
  return new Response('ok', { status: 200 })
}

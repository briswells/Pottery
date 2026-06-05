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

  if (event.type === 'payment.updated') {
    const payment = event.data?.object?.payment
    const squarePaymentId = payment?.id
    const status: string | undefined = payment?.status // COMPLETED | FAILED | CANCELED | ...
    if (squarePaymentId) {
      const { docs } = await payload.find({
        collection: 'bookings',
        where: { squarePaymentId: { equals: squarePaymentId } },
        limit: 1,
      })
      const booking = docs[0]
      if (booking) {
        const map: Record<string, string> = { CANCELED: 'refunded', FAILED: 'cancelled' }
        const newStatus = (status ? map[status] : undefined) ?? booking.status
        if (newStatus !== booking.status) {
          await payload.update({
            collection: 'bookings',
            id: booking.id,
            overrideAccess: true,
            data: { status: newStatus as typeof booking.status },
          })
        }
      }
    }
  }

  // Membership events (invoice.*, subscription.updated) are handled in Plan 3.
  return new Response('ok', { status: 200 })
}

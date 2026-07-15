import { getPayload } from 'payload'
import config from '@payload-config'
import { createPaidBooking } from '../../../services/booking'
import { chargeCard } from '../../../lib/payments'
import { sendEmail } from '../../../lib/email'
import { kitEnabled, createKitSubscriber } from '../../../lib/kit'

export async function POST(req: Request) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { classInstanceId, sourceId, couponCode, customerName, customerEmail, customerPhone } = body ?? {}
  if (!classInstanceId || !customerName || !customerEmail) {
    return Response.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const payload = await getPayload({ config: await config })
  try {
    const booking = await createPaidBooking(
      { payload, charge: chargeCard, sendEmail },
      { classInstanceId, sourceId, couponCode, customerName, customerEmail, customerPhone },
    )
    // Newsletter opt-in is best-effort: the booking is already paid, so a Kit
    // failure is logged and swallowed — it must never turn a success into an error.
    if (body?.subscribe === true && kitEnabled()) {
      try {
        await createKitSubscriber({ email: customerEmail, firstName: customerName })
      } catch (err) {
        payload.logger.error(`Booking newsletter opt-in failed for ${customerEmail}: ${err instanceof Error ? err.message : err}`)
      }
    }
    return Response.json({ ok: true, bookingId: booking.id })
  } catch (e: any) {
    const full = /this class is full/i.test(e?.message ?? '')
    return Response.json({ error: e?.message ?? 'Booking failed' }, { status: full ? 409 : 402 })
  }
}

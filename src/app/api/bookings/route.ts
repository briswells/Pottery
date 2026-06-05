import { getPayload } from 'payload'
import config from '@payload-config'
import { createPaidBooking } from '../../../services/booking'
import { chargeCard } from '../../../lib/payments'
import { sendEmail } from '../../../lib/email'

export async function POST(req: Request) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { classId, sourceId, customerName, customerEmail, customerPhone } = body ?? {}
  if (!classId || !sourceId || !customerName || !customerEmail) {
    return Response.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const payload = await getPayload({ config: await config })
  try {
    const booking = await createPaidBooking(
      { payload, charge: chargeCard, sendEmail },
      { classId, sourceId, customerName, customerEmail, customerPhone },
    )
    return Response.json({ ok: true, bookingId: booking.id })
  } catch (e: any) {
    const full = /full/i.test(e?.message ?? '')
    return Response.json({ error: e?.message ?? 'Booking failed' }, { status: full ? 409 : 402 })
  }
}

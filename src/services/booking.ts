import type { Payload } from 'payload'
import { seatsRemaining } from '../lib/occupancy'
import type { ChargeInput, ChargeResult } from '../lib/payments'
import type { EmailInput } from '../lib/email'

export interface BookingDeps {
  payload: Payload
  charge: (input: ChargeInput) => Promise<ChargeResult>
  sendEmail: (input: EmailInput) => Promise<void>
}

export interface BookingInput {
  classId: number | string
  sourceId: string
  customerName: string
  customerEmail: string
  customerPhone?: string
}

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`

export async function createPaidBooking(deps: BookingDeps, input: BookingInput) {
  const { payload } = deps
  const cls = await payload.findByID({ collection: 'classes', id: input.classId })
  if (!cls || cls.status !== 'active') throw new Error('Class is not available for booking')

  // Reserve a seat by creating a pending booking, then re-check occupancy.
  const remaining = await seatsRemaining(payload, input.classId)
  if (remaining <= 0) throw new Error('This class is full')

  const pending = await payload.create({
    collection: 'bookings',
    overrideAccess: true,
    data: {
      class: cls.id, customerName: input.customerName, customerEmail: input.customerEmail,
      customerPhone: input.customerPhone, amountCents: cls.priceCents, status: 'pending',
    },
  })

  // Re-check AFTER reserving to catch a race; if we oversold, roll back.
  if (await seatsRemaining(payload, input.classId) < 0) {
    await payload.update({ collection: 'bookings', id: pending.id, overrideAccess: true, data: { status: 'cancelled' } })
    throw new Error('This class is full')
  }

  let charge: ChargeResult
  try {
    charge = await deps.charge({
      sourceId: input.sourceId, amountCents: cls.priceCents,
      referenceId: `booking-${pending.id}`, note: `Class: ${cls.title}`,
    })
  } catch (e) {
    await payload.update({ collection: 'bookings', id: pending.id, overrideAccess: true, data: { status: 'cancelled' } })
    throw e
  }

  const booking = await payload.update({
    collection: 'bookings', id: pending.id, overrideAccess: true,
    data: { status: 'paid', squarePaymentId: charge.paymentId },
  })

  await payload.create({
    collection: 'payments', overrideAccess: true,
    data: { type: 'booking', booking: pending.id, amountCents: cls.priceCents, squareId: charge.paymentId, status: charge.status, paidAt: new Date().toISOString() },
  })

  // The booking is already paid and recorded at this point. A failed
  // confirmation email must NOT fail the request (and re-charge anxiety),
  // so swallow+log email errors rather than letting them propagate.
  try {
    await deps.sendEmail({
      to: input.customerEmail,
      subject: `You're booked: ${cls.title}`,
      html: `<p>Thanks, ${input.customerName}! You're registered for <strong>${cls.title}</strong> (${cls.scheduleText}).</p><p>Amount paid: ${usd(cls.priceCents)}.</p>`,
    })
  } catch (e) {
    console.error(`Booking ${pending.id} confirmation email failed:`, e)
  }

  return booking
}

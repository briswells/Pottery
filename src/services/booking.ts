import type { Payload } from 'payload'
import { seatsRemaining, occupiedSeats } from '../lib/occupancy'
import type { ChargeInput, ChargeResult } from '../lib/payments'
import type { EmailInput } from '../lib/email'
import { usd } from '../lib/format'
import { upsertPersonByEmail } from './people'

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

  // Re-check AFTER reserving to catch a concurrent reservation; if reserving
  // pushed us over capacity, roll this booking back rather than oversell.
  if (await occupiedSeats(payload, cls.id) > (cls.capacity ?? 0)) {
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

  // Link the booking to a Person (find-or-create by email). A failure here must
  // not fail the already-paid booking — log and move on; the backfill can link later.
  try {
    const person = await upsertPersonByEmail(
      { payload },
      { name: input.customerName, email: input.customerEmail, phone: input.customerPhone },
    )
    await payload.update({ collection: 'bookings', id: booking.id, overrideAccess: true, data: { person: person.id } })
  } catch (e) {
    console.error(`Booking ${booking.id} person link failed:`, e)
  }

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

  return await payload.findByID({ collection: 'bookings', id: booking.id, overrideAccess: true })
}

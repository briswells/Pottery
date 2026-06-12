import type { Payload } from 'payload'
import { seatsRemaining, occupiedSeats } from '../lib/occupancy'
import type { ChargeInput, ChargeResult } from '../lib/payments'
import type { EmailInput } from '../lib/email'
import { usd } from '../lib/format'
import { scheduleSummary } from '../lib/schedule'
import { buildClassIcs } from '../lib/ics'
import { upsertPersonByEmail } from './people'

export interface BookingDeps {
  payload: Payload
  charge: (input: ChargeInput) => Promise<ChargeResult>
  sendEmail: (input: EmailInput) => Promise<void>
}

export interface BookingInput {
  classInstanceId: number | string
  sourceId: string
  customerName: string
  customerEmail: string
  customerPhone?: string
}

export async function createPaidBooking(deps: BookingDeps, input: BookingInput) {
  const { payload } = deps
  const inst = await payload.findByID({ collection: 'class-instances', id: input.classInstanceId, depth: 1 })
  if (!inst || inst.status !== 'published') throw new Error('This class is not available for booking')
  const cls = typeof inst.class === 'object' && inst.class
    ? inst.class
    : await payload.findByID({ collection: 'classes', id: inst.class as number | string })

  if (inst.priceCents == null || inst.capacity == null) {
    throw new Error('This class instance is misconfigured (missing price or capacity)')
  }
  const priceCents = inst.priceCents
  const capacity = inst.capacity

  // Reserve a seat by creating a pending booking, then re-check occupancy.
  const remaining = await seatsRemaining(payload, inst.id)
  if (remaining <= 0) throw new Error('This class is full')

  const pending = await payload.create({
    collection: 'bookings',
    overrideAccess: true,
    data: {
      classInstance: inst.id, customerName: input.customerName, customerEmail: input.customerEmail,
      customerPhone: input.customerPhone, amountCents: priceCents, status: 'pending',
    },
  })

  // Re-check AFTER reserving to catch a concurrent reservation; if reserving
  // pushed us over capacity, roll this booking back rather than oversell.
  if (await occupiedSeats(payload, inst.id) > capacity) {
    await payload.update({ collection: 'bookings', id: pending.id, overrideAccess: true, data: { status: 'cancelled' } })
    throw new Error('This class is full')
  }

  let charge: ChargeResult
  try {
    charge = await deps.charge({
      sourceId: input.sourceId, amountCents: priceCents,
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
    data: { type: 'booking', booking: pending.id, amountCents: priceCents, squareId: charge.paymentId, status: charge.status, paidAt: new Date().toISOString() },
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

  // The booking is already paid and recorded at this point. A failed confirmation
  // email (or ICS generation) must NOT fail the request, so swallow+log errors.
  try {
    const summary = scheduleSummary(inst)
    const ics = buildClassIcs(inst, cls.title)
    await deps.sendEmail({
      to: input.customerEmail,
      subject: `You're booked: ${cls.title}`,
      html: `<p>Thanks, ${input.customerName}! You're registered for <strong>${cls.title}</strong> (${summary}).</p><p>Amount paid: ${usd(priceCents)}.</p><p>A calendar invite is attached.</p>`,
      attachments: [{ filename: 'class.ics', content: Buffer.from(ics) }],
    })
  } catch (e) {
    console.error(`Booking ${pending.id} confirmation email failed:`, e)
  }

  return await payload.findByID({ collection: 'bookings', id: booking.id, overrideAccess: true })
}

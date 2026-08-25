import type { Payload } from 'payload'
import { seatsRemaining, occupiedSeats } from '../lib/occupancy'
import type { ChargeInput, ChargeResult } from '../lib/payments'
import type { EmailInput } from '../lib/email'
import { usd } from '../lib/format'
import { scheduleSummary } from '../lib/schedule'
import { buildClassIcs } from '../lib/ics'
import { upsertPersonByEmail } from './people'
import { validateCoupon } from './coupons'
import { computeTotals, getSalesTaxPercent } from '../lib/tax'
import type { ItemizedOrderInput } from '../lib/square-order'

export interface BookingDeps {
  payload: Payload
  charge: (input: ChargeInput) => Promise<ChargeResult>
  sendEmail: (input: EmailInput) => Promise<void>
  createOrder: (input: ItemizedOrderInput) => Promise<string | null>
}

export interface BookingInput {
  classInstanceId: number | string
  /** Square card/wallet token. Optional ONLY when a coupon brings the total to $0. */
  sourceId?: string
  couponCode?: string
  customerName: string
  customerEmail: string
  customerPhone?: string
  /** Total the client displayed when the customer submitted, in cents. When
   * present and it disagrees with the server's own total, the charge is
   * refused — a stale tab (open across a deploy or a rate edit) must never
   * charge a total the customer never saw. */
  expectedTotalCents?: number
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

  // Authoritative coupon check — the form's preview is cosmetic. The pending
  // booking created below carries the coupon, so it holds a redemption slot.
  let couponId: number | null = null
  let discountCents = 0
  if (input.couponCode) {
    const classId = typeof cls === 'object' ? (cls.id as number) : (cls as number)
    const check = await validateCoupon({ payload }, {
      code: input.couponCode, priceCents, customerEmail: input.customerEmail, target: { kind: 'class', classId },
    })
    if (!check.ok) throw new Error(check.reason)
    couponId = check.coupon.id as number
    discountCents = check.discountCents
  }

  // Tax is applied AFTER the coupon (WA: seller discounts reduce the taxable
  // price). totalCents is what the card is charged.
  const taxRatePercent = await getSalesTaxPercent(payload)
  const totals = computeTotals({ subtotalCents: priceCents, discountCents, taxRatePercent })
  if (totals.totalCents > 0 && !input.sourceId) throw new Error('Payment information is required')

  if (
    typeof input.expectedTotalCents === 'number' &&
    Number.isFinite(input.expectedTotalCents) &&
    input.expectedTotalCents !== totals.totalCents
  ) {
    throw new Error('The price has been updated since you loaded this page — please refresh and try again.')
  }

  // Reserve a seat by creating a pending booking, then re-check occupancy.
  const remaining = await seatsRemaining(payload, inst.id)
  if (remaining <= 0) throw new Error('This class is full')

  const pending = await payload.create({
    collection: 'bookings',
    overrideAccess: true,
    data: {
      classInstance: inst.id, customerName: input.customerName, customerEmail: input.customerEmail,
      customerPhone: input.customerPhone, amountCents: totals.totalCents, taxCents: totals.taxCents, status: 'pending',
      ...(couponId != null ? { coupon: couponId, discountCents } : {}),
    },
  })

  // Re-check AFTER reserving to catch a concurrent reservation; if reserving
  // pushed us over capacity, roll this booking back rather than oversell.
  if (await occupiedSeats(payload, inst.id) > capacity) {
    await payload.update({ collection: 'bookings', id: pending.id, overrideAccess: true, data: { status: 'cancelled' } })
    throw new Error('This class is full')
  }

  let charge: ChargeResult | null = null
  if (totals.totalCents > 0) {
    // Best-effort itemization: a null orderId (API error or Square total
    // mismatch) falls back to today's unitemized charge — the customer is
    // always charged exactly totals.totalCents.
    const orderId = await deps.createOrder({
      itemName: `Class: ${cls.title}`,
      subtotalCents: priceCents,
      discountCents,
      discountName: couponId != null ? `Coupon ${input.couponCode!.trim().toUpperCase()}` : undefined,
      taxRatePercent,
      expectedTotalCents: totals.totalCents,
      referenceId: `booking-${pending.id}`,
    })
    try {
      charge = await deps.charge({
        sourceId: input.sourceId!, amountCents: totals.totalCents,
        referenceId: `booking-${pending.id}`, note: `Class: ${cls.title}`,
        ...(orderId ? { orderId } : {}),
      })
    } catch (e) {
      await payload.update({ collection: 'bookings', id: pending.id, overrideAccess: true, data: { status: 'cancelled' } })
      throw e
    }
  }

  const booking = await payload.update({
    collection: 'bookings', id: pending.id, overrideAccess: true,
    data: { status: 'paid', ...(charge ? { squarePaymentId: charge.paymentId } : {}) },
  })

  await payload.create({
    collection: 'payments', overrideAccess: true,
    data: {
      type: 'booking', booking: pending.id, amountCents: totals.totalCents, taxCents: totals.taxCents,
      ...(charge ? { squareId: charge.paymentId } : {}),
      status: charge?.status ?? 'COMPLETED', paidAt: new Date().toISOString(),
    },
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
    const code = input.couponCode?.trim().toUpperCase()
    const amountLine =
      couponId != null && totals.totalCents === 0
        ? `Free with code ${code}.`
        : totals.taxCents > 0
          ? `Amount paid: ${usd(totals.totalCents)} (${usd(totals.taxableCents)}${discountCents > 0 ? ` after ${code}` : ''} + ${usd(totals.taxCents)} sales tax).`
          : discountCents > 0
            ? `Amount paid: ${usd(totals.totalCents)} (${code} applied).`
            : `Amount paid: ${usd(totals.totalCents)}.`
    await deps.sendEmail({
      to: input.customerEmail,
      subject: `You're booked: ${cls.title}`,
      html: `<p>Thanks, ${input.customerName}! You're registered for <strong>${cls.title}</strong> (${summary}).</p><p>${amountLine}</p><p>A calendar invite is attached.</p>`,
      attachments: [{ filename: 'class.ics', content: Buffer.from(ics) }],
    })
  } catch (e) {
    console.error(`Booking ${pending.id} confirmation email failed:`, e)
  }

  return await payload.findByID({ collection: 'bookings', id: booking.id, overrideAccess: true })
}

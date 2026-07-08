import type { Payload } from 'payload'
import type { ChargeInput, ChargeResult } from '../lib/payments'
import type { EmailInput } from '../lib/email'
import { usd } from '../lib/format'
import { getNotifyEmail } from '../lib/notify-email'
import { upsertPersonByEmail } from './people'
import { validateCoupon } from './coupons'
import { FIRING_HALF_SHELF_CENTS, MAX_HALF_SHELVES, MAX_FIRING_PHOTOS } from '../lib/firing-pricing'

export interface FiringDeps {
  payload: Payload
  charge: (input: ChargeInput) => Promise<ChargeResult>
  sendEmail: (input: EmailInput) => Promise<void>
}

export interface FiringInput {
  halfShelves: number
  photoIds: number[]
  /** Square card/wallet token. Optional ONLY when a coupon brings the total to $0. */
  sourceId?: string
  couponCode?: string
  customerName: string
  customerEmail: string
  customerPhone?: string
  description: string
  notes?: string
  stonewareConfirmed: boolean
}

const SIZE_COPY = 'half shelf (11″×22″×6″)'

export async function createPaidFiring(deps: FiringDeps, input: FiringInput) {
  const { payload } = deps

  if (!Number.isFinite(input.halfShelves) || input.halfShelves < 1 || input.halfShelves > MAX_HALF_SHELVES) {
    throw new Error('Choose between 1 and 8 half shelves')
  }
  if (input.stonewareConfirmed !== true) {
    throw new Error('Please confirm your pieces are stoneware')
  }
  if (!Array.isArray(input.photoIds) || input.photoIds.length < 1 || input.photoIds.length > MAX_FIRING_PHOTOS) {
    throw new Error('Please attach between 1 and 5 photos')
  }

  const priceCents = FIRING_HALF_SHELF_CENTS * input.halfShelves

  // Authoritative coupon check — the form's preview is cosmetic. The pending
  // firing request created below carries the coupon, so it holds a redemption slot.
  let couponId: number | null = null
  let discountCents = 0
  let finalCents = priceCents
  if (input.couponCode) {
    const check = await validateCoupon({ payload }, {
      code: input.couponCode, priceCents, customerEmail: input.customerEmail, target: { kind: 'firing' },
    })
    if (!check.ok) throw new Error(check.reason)
    couponId = check.coupon.id as number
    discountCents = check.discountCents
    finalCents = check.finalCents
  }
  if (finalCents > 0 && !input.sourceId) throw new Error('Payment information is required')

  const pending = await payload.create({
    collection: 'firing-requests',
    overrideAccess: true,
    data: {
      name: input.customerName, email: input.customerEmail, phone: input.customerPhone,
      description: input.description, notes: input.notes,
      halfShelves: input.halfShelves, photos: input.photoIds, stonewareConfirmed: input.stonewareConfirmed,
      amountCents: finalCents, status: 'pending',
      ...(couponId != null ? { coupon: couponId, discountCents } : {}),
    },
  })

  let charge: ChargeResult | null = null
  if (finalCents > 0) {
    try {
      charge = await deps.charge({
        sourceId: input.sourceId!, amountCents: finalCents,
        referenceId: `firing-${pending.id}`, note: `Firing: ${input.halfShelves} half shelf(s)`,
      })
    } catch (e) {
      await payload.update({ collection: 'firing-requests', id: pending.id, overrideAccess: true, data: { status: 'cancelled' } })
      throw e
    }
  }

  // The charge has succeeded (or was legitimately skipped for a $0 total) — from
  // this point on the service must NEVER throw. A transient DB error here would
  // otherwise propagate to the route, which treats failure as "never happened"
  // and deletes the uploaded photos, even though the customer WAS charged.
  let firing = pending
  try {
    firing = await payload.update({
      collection: 'firing-requests', id: pending.id, overrideAccess: true,
      data: { status: 'paid', paidAt: new Date().toISOString(), ...(charge ? { squarePaymentId: charge.paymentId } : {}) },
    })
  } catch (e) {
    // The customer HAS been charged — never propagate past this point, or the
    // caller would treat a paid firing as failed (and delete its photos).
    console.error(
      `CRITICAL: firing request ${pending.id} charged (payment ${charge?.paymentId ?? 'free'}) but post-charge bookkeeping failed — reconcile manually:`, e)
  }

  try {
    await payload.create({
      collection: 'payments', overrideAccess: true,
      data: {
        type: 'firing', firingRequest: pending.id, amountCents: finalCents,
        ...(charge ? { squareId: charge.paymentId } : {}),
        status: charge?.status ?? 'COMPLETED', paidAt: new Date().toISOString(),
      },
    })
  } catch (e) {
    // The customer HAS been charged — never propagate past this point, or the
    // caller would treat a paid firing as failed (and delete its photos).
    console.error(
      `CRITICAL: firing request ${pending.id} charged (payment ${charge?.paymentId ?? 'free'}) but post-charge bookkeeping failed — reconcile manually:`, e)
  }

  // Link the firing request to a Person (find-or-create by email). A failure here
  // must not fail the already-paid request — log and move on.
  try {
    const person = await upsertPersonByEmail(
      { payload },
      { name: input.customerName, email: input.customerEmail, phone: input.customerPhone },
    )
    await payload.update({ collection: 'firing-requests', id: firing.id, overrideAccess: true, data: { person: person.id } })
  } catch (e) {
    console.error(`Firing request ${firing.id} person link failed:`, e)
  }

  const unit = input.halfShelves === 1 ? 'half shelf' : 'half shelves'
  const amountLine =
    couponId != null && finalCents === 0
      ? `Free with code ${input.couponCode!.trim().toUpperCase()}.`
      : discountCents > 0
        ? `Amount paid: ${usd(finalCents)} (${input.couponCode!.trim().toUpperCase()} applied).`
        : `Amount paid: ${usd(finalCents)}.`

  // The request is already paid and recorded at this point. A failed
  // confirmation/notify email must NOT fail the request — swallow+log errors.
  try {
    await deps.sendEmail({
      to: input.customerEmail,
      subject: `We've received your firing request`,
      html: `<p>Thanks, ${input.customerName}! We've received your firing request for <strong>${input.halfShelves} ${unit}</strong> (${SIZE_COPY} each).</p><p>We'll fire your pieces at the next monthly firing.</p><p>${amountLine}</p>`,
    })
  } catch (e) {
    console.error(`Firing request ${pending.id} confirmation email failed:`, e)
  }

  try {
    const notifyTo = await getNotifyEmail(payload)
    if (notifyTo) {
      await deps.sendEmail({
        to: notifyTo,
        subject: `New paid firing request: ${input.customerName}`,
        html: `<p>${input.customerName} (${input.customerEmail}) paid for ${input.halfShelves} ${unit}. ${amountLine}</p>`,
      })
    }
  } catch (e) {
    console.error(`Firing request ${pending.id} staff notify failed:`, e)
  }

  try {
    return await payload.findByID({ collection: 'firing-requests', id: firing.id, overrideAccess: true })
  } catch (e) {
    // Still must not throw post-charge — fall back to the in-memory doc.
    console.error(
      `CRITICAL: firing request ${firing.id} charged (payment ${charge?.paymentId ?? 'free'}) but final findByID failed — reconcile manually:`, e)
    return firing
  }
}

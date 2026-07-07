import type { Payload } from 'payload'
import type { Coupon } from '../payload-types'

/** Pure discount math. Percent rounds to whole cents; fixed clamps at the price. */
export function computeDiscount(
  coupon: Pick<Coupon, 'discountType' | 'percentOff' | 'amountOffCents'>,
  priceCents: number,
): { discountCents: number; finalCents: number } {
  const raw =
    coupon.discountType === 'percent'
      ? Math.round((priceCents * (coupon.percentOff ?? 0)) / 100)
      : coupon.amountOffCents ?? 0
  const discountCents = Math.max(0, Math.min(raw, priceCents))
  return { discountCents, finalCents: priceCents - discountCents }
}

export type CouponCheck =
  | { ok: true; coupon: Coupon; discountCents: number; finalCents: number }
  | { ok: false; reason: string }

const REASONS = {
  notFound: "That code isn't valid.",
  inactive: 'That code is no longer active.',
  expired: 'That code has expired.',
  wrongClass: "That code isn't valid for this class.",
  fullyRedeemed: 'That code has been fully redeemed.',
  alreadyUsed: 'That code has already been used with this email.',
} as const

function relId(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === 'object') return (v as { id?: number }).id ?? null
  return typeof v === 'number' ? v : Number(v) || null
}

/**
 * Validate a coupon code for a class at a price. Used cosmetically by the
 * preview endpoint and AUTHORITATIVELY by createPaidBooking at charge time.
 * Redemption usage counts paid AND pending bookings (a pending checkout holds
 * its slot; a cancelled one releases it).
 */
export async function validateCoupon(
  deps: { payload: Payload },
  args: { code: string; classId: number; priceCents: number; customerEmail?: string },
): Promise<CouponCheck> {
  const { payload } = deps
  const code = (args.code ?? '').trim().toUpperCase()
  if (!code) return { ok: false, reason: REASONS.notFound }

  const { docs } = await payload.find({
    collection: 'coupons', where: { code: { equals: code } }, limit: 1, depth: 0, overrideAccess: true,
  })
  const coupon = docs[0] as Coupon | undefined
  if (!coupon) return { ok: false, reason: REASONS.notFound }
  if (!coupon.active) return { ok: false, reason: REASONS.inactive }
  if (coupon.expiresAt && Date.now() > new Date(coupon.expiresAt).getTime()) return { ok: false, reason: REASONS.expired }
  if (coupon.appliesTo === 'class' && relId(coupon.class) !== args.classId) return { ok: false, reason: REASONS.wrongClass }

  // Usage checks hit bookings only when a limit is configured.
  if (coupon.maxRedemptions != null) {
    const { totalDocs: uses } = await payload.count({
      collection: 'bookings',
      where: { and: [{ coupon: { equals: coupon.id } }, { status: { in: ['paid', 'pending'] } }] },
      overrideAccess: true,
    })
    if (uses >= coupon.maxRedemptions) return { ok: false, reason: REASONS.fullyRedeemed }
  }

  if (coupon.onePerCustomer && args.customerEmail) {
    const email = args.customerEmail.trim().toLowerCase()
    // `like` is case-insensitive-contains in Payload/Postgres — it can over-match
    // substrings, so confirm exact (case-insensitive) equality in JS on the small
    // candidate set. No cap: a true duplicate always contains itself.
    const { docs: candidates } = await payload.find({
      collection: 'bookings',
      where: { and: [{ coupon: { equals: coupon.id } }, { status: { in: ['paid', 'pending'] } }, { customerEmail: { like: email } }] },
      limit: 100,
      depth: 0,
      overrideAccess: true,
    })
    if (candidates.some((b) => (b.customerEmail ?? '').toLowerCase() === email)) {
      return { ok: false, reason: REASONS.alreadyUsed }
    }
  }

  return { ok: true, coupon, ...computeDiscount(coupon, args.priceCents) }
}

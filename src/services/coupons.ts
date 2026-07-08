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

/** What a coupon is being redeemed against. */
export type CouponTarget = { kind: 'class'; classId: number } | { kind: 'firing' }

const REASONS = {
  notFound: "That code isn't valid.",
  inactive: 'That code is no longer active.',
  expired: 'That code has expired.',
  wrongClass: "That code isn't valid for this class.",
  wrongFiring: "That code isn't valid for firings.",
  fullyRedeemed: 'That code has been fully redeemed.',
  alreadyUsed: 'That code has already been used with this email.',
} as const

function relId(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === 'object') return (v as { id?: number }).id ?? null
  return typeof v === 'number' ? v : Number(v) || null
}

/**
 * Sum paid/pending redemptions of a coupon across bookings AND firing
 * requests. `firing-requests.coupon` doesn't exist until a later task, so
 * that half is guarded — until it lands, only bookings are counted.
 */
async function countUsage(payload: Payload, couponId: number): Promise<number> {
  const { totalDocs: bookingUses } = await payload.count({
    collection: 'bookings',
    where: { and: [{ coupon: { equals: couponId } }, { status: { in: ['paid', 'pending'] } }] },
    overrideAccess: true,
  })
  let firingUses = 0
  try {
    const { totalDocs } = await payload.count({
      collection: 'firing-requests',
      where: { and: [{ coupon: { equals: couponId } }, { status: { in: ['paid', 'pending'] } }] },
      overrideAccess: true,
    })
    firingUses = totalDocs
  } catch {
    // `firing-requests.coupon` field lands in Task 2 — until then, no firing usage to count.
  }
  return bookingUses + firingUses
}

/**
 * Whether `email` has already redeemed this coupon on a paid/pending booking
 * or firing request. `like` is case-insensitive-contains in Payload/Postgres —
 * it can over-match substrings, so confirm exact (case-insensitive) equality
 * in JS on the small candidate set.
 */
async function emailUsed(payload: Payload, couponId: number, email: string): Promise<boolean> {
  const { docs: bookingCandidates } = await payload.find({
    collection: 'bookings',
    where: { and: [{ coupon: { equals: couponId } }, { status: { in: ['paid', 'pending'] } }, { customerEmail: { like: email } }] },
    limit: 100,
    depth: 0,
    overrideAccess: true,
  })
  if (bookingCandidates.some((b) => (b.customerEmail ?? '').toLowerCase() === email)) return true

  try {
    const { docs: firingCandidates } = await payload.find({
      collection: 'firing-requests',
      where: { and: [{ coupon: { equals: couponId } }, { status: { in: ['paid', 'pending'] } }, { email: { like: email } }] },
      limit: 100,
      depth: 0,
      overrideAccess: true,
    })
    if (firingCandidates.some((f) => (f.email ?? '').toLowerCase() === email)) return true
  } catch {
    // `firing-requests.coupon` field lands in Task 2 — until then, no firing usage to check.
  }
  return false
}

/**
 * Validate a coupon code for a target (class or firing) at a price. Used
 * cosmetically by the preview endpoint and AUTHORITATIVELY by
 * createPaidBooking (and, later, firing checkout) at charge time.
 * Redemption usage counts paid AND pending bookings/firing requests (a
 * pending checkout holds its slot; a cancelled one releases it).
 */
export async function validateCoupon(
  deps: { payload: Payload },
  args: { code: string; priceCents: number; customerEmail?: string; target: CouponTarget },
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

  const { target } = args
  if (coupon.appliesTo === 'class') {
    if (target.kind === 'firing') return { ok: false, reason: REASONS.wrongFiring }
    if (relId(coupon.class) !== target.classId) return { ok: false, reason: REASONS.wrongClass }
  } else if (coupon.appliesTo === 'firing') {
    if (target.kind === 'class') return { ok: false, reason: REASONS.wrongClass }
  }

  // Usage checks hit bookings/firing-requests only when a limit is configured.
  if (coupon.maxRedemptions != null) {
    const uses = await countUsage(payload, coupon.id)
    if (uses >= coupon.maxRedemptions) return { ok: false, reason: REASONS.fullyRedeemed }
  }

  if (coupon.onePerCustomer && args.customerEmail) {
    const email = args.customerEmail.trim().toLowerCase()
    if (await emailUsed(payload, coupon.id, email)) return { ok: false, reason: REASONS.alreadyUsed }
  }

  return { ok: true, coupon, ...computeDiscount(coupon, args.priceCents) }
}

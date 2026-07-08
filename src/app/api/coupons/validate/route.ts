import { getPayload } from 'payload'
import config from '@payload-config'
import { validateCoupon } from '../../../../services/coupons'
import { FIRING_HALF_SHELF_CENTS, MAX_HALF_SHELVES } from '../../../../lib/firing-pricing'

// Cosmetic price preview for the booking/firing forms. The charge path
// re-validates authoritatively — nothing here is trusted.
export async function POST(req: Request) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, reason: 'Invalid request' })
  }
  const { code, classInstanceId, firing, halfShelves, email } = body ?? {}
  if (!code) return Response.json({ ok: false, reason: "That code isn't valid." })

  const payload = await getPayload({ config: await config })

  if (firing === true) {
    if (typeof halfShelves !== 'number' || !Number.isInteger(halfShelves) || halfShelves < 1 || halfShelves > MAX_HALF_SHELVES) {
      return Response.json({ ok: false, reason: "That code isn't valid." })
    }
    const priceCents = FIRING_HALF_SHELF_CENTS * halfShelves
    const check = await validateCoupon({ payload }, {
      code: String(code),
      priceCents,
      customerEmail: typeof email === 'string' ? email : undefined,
      target: { kind: 'firing' },
    })
    if (!check.ok) return Response.json({ ok: false, reason: check.reason })
    return Response.json({ ok: true, code: check.coupon.code, discountCents: check.discountCents, finalCents: check.finalCents })
  }

  if (!classInstanceId) return Response.json({ ok: false, reason: "That code isn't valid." })
  let inst
  try {
    inst = await payload.findByID({ collection: 'class-instances', id: classInstanceId, depth: 0 })
  } catch {
    return Response.json({ ok: false, reason: "That code isn't valid." })
  }
  if (!inst || inst.status !== 'published' || inst.priceCents == null) {
    return Response.json({ ok: false, reason: "That code isn't valid." })
  }

  const check = await validateCoupon({ payload }, {
    code: String(code),
    priceCents: inst.priceCents,
    customerEmail: typeof email === 'string' ? email : undefined,
    target: { kind: 'class', classId: typeof inst.class === 'object' && inst.class ? (inst.class.id as number) : (inst.class as number) },
  })
  if (!check.ok) return Response.json({ ok: false, reason: check.reason })
  return Response.json({ ok: true, code: check.coupon.code, discountCents: check.discountCents, finalCents: check.finalCents })
}

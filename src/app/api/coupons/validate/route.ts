import { getPayload } from 'payload'
import config from '@payload-config'
import { validateCoupon } from '../../../../services/coupons'

// Cosmetic price preview for the booking form. The charge path re-validates
// authoritatively — nothing here is trusted.
export async function POST(req: Request) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, reason: 'Invalid request' })
  }
  const { code, classInstanceId, email } = body ?? {}
  if (!code || !classInstanceId) return Response.json({ ok: false, reason: "That code isn't valid." })

  const payload = await getPayload({ config: await config })
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
    classId: typeof inst.class === 'object' && inst.class ? (inst.class.id as number) : (inst.class as number),
    priceCents: inst.priceCents,
    customerEmail: typeof email === 'string' ? email : undefined,
  })
  if (!check.ok) return Response.json({ ok: false, reason: check.reason })
  return Response.json({ ok: true, code: check.coupon.code, discountCents: check.discountCents, finalCents: check.finalCents })
}

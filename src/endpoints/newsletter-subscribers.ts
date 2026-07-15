import type { Endpoint, PayloadRequest } from 'payload'
import { createKitSubscriber, kitEnabled, unsubscribeKitSubscriber } from '../lib/kit'

function isStaff(req: PayloadRequest): boolean {
  const user = req.user
  return Boolean(
    user && user.collection === 'users' && user.roles?.some((r: string) => r === 'admin' || r === 'editor'),
  )
}

/** Root-level endpoints (mounted at /api/…) for managing Kit subscribers from
 *  the admin Subscribers view. Staff-only; Kit remains the source of truth. */
export const newsletterSubscriberEndpoints: Endpoint[] = [
  {
    path: '/newsletter-subscribers',
    method: 'post',
    handler: async (req) => {
      if (!isStaff(req)) return Response.json({ error: 'Forbidden' }, { status: 403 })
      if (!kitEnabled()) return Response.json({ error: 'Kit is not configured (KIT_API_KEY).' }, { status: 503 })
      const body = req.json ? await req.json().catch(() => null) : null
      const email = String(body?.email ?? '').trim()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return Response.json({ error: 'Please enter a valid email address.' }, { status: 400 })
      }
      try {
        const sub = await createKitSubscriber({
          email,
          ...(body?.firstName ? { firstName: String(body.firstName).slice(0, 100) } : {}),
        })
        return Response.json({ ok: true, id: sub.id })
      } catch (e) {
        req.payload.logger.error(`Admin subscriber add failed: ${e instanceof Error ? e.message : e}`)
        return Response.json({ error: "Couldn't add the subscriber — Kit API error." }, { status: 502 })
      }
    },
  },
  {
    path: '/newsletter-subscribers/unsubscribe',
    method: 'post',
    handler: async (req) => {
      if (!isStaff(req)) return Response.json({ error: 'Forbidden' }, { status: 403 })
      if (!kitEnabled()) return Response.json({ error: 'Kit is not configured (KIT_API_KEY).' }, { status: 503 })
      const body = req.json ? await req.json().catch(() => null) : null
      const id = Number(body?.id)
      if (!Number.isInteger(id) || id <= 0) return Response.json({ error: 'Invalid subscriber id.' }, { status: 400 })
      try {
        await unsubscribeKitSubscriber(id)
        return Response.json({ ok: true })
      } catch (e) {
        req.payload.logger.error(`Admin unsubscribe failed for ${id}: ${e instanceof Error ? e.message : e}`)
        return Response.json({ error: "Couldn't unsubscribe — Kit API error." }, { status: 502 })
      }
    },
  },
]

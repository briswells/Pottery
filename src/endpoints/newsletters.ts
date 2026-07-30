import type { Endpoint } from 'payload'
import { countKitSubscribers, createKitBroadcast, kitEnabled } from '../lib/kit'
import { sendEmail } from '../lib/email'
import { sendNewsletter, sendNewsletterTest } from '../services/newsletter'
import { isStaffRequest } from '../lib/staff-request'

/**
 * Custom REST endpoints mounted under /api/newsletters by Payload, so req.user
 * arrives authenticated for free. All are staff-only.
 */
export const newsletterEndpoints: Endpoint[] = [
  {
    path: '/subscriber-count',
    method: 'get',
    handler: async (req) => {
      if (!isStaffRequest(req)) return Response.json({ error: 'Forbidden' }, { status: 403 })
      if (!kitEnabled()) return Response.json({ error: 'Kit is not configured (KIT_API_KEY).' }, { status: 503 })
      try {
        return Response.json({ total: await countKitSubscribers() })
      } catch {
        return Response.json({ error: "Couldn't reach Kit." }, { status: 502 })
      }
    },
  },
  {
    path: '/:id/send',
    method: 'post',
    handler: async (req) => {
      if (!isStaffRequest(req)) return Response.json({ error: 'Forbidden' }, { status: 403 })
      if (!kitEnabled()) return Response.json({ error: 'Kit is not configured (KIT_API_KEY).' }, { status: 503 })
      const result = await sendNewsletter(
        { payload: req.payload, countSubscribers: countKitSubscribers, createBroadcast: createKitBroadcast },
        { id: String(req.routeParams?.id ?? '') },
      )
      if (result.ok) return Response.json(result)
      return Response.json({ error: result.error }, { status: result.status })
    },
  },
  {
    path: '/:id/test',
    method: 'post',
    handler: async (req) => {
      if (!isStaffRequest(req) || !req.user?.email) return Response.json({ error: 'Forbidden' }, { status: 403 })
      const result = await sendNewsletterTest(
        { payload: req.payload, sendEmail },
        { id: String(req.routeParams?.id ?? ''), to: req.user.email },
      )
      if (result.ok) return Response.json(result)
      return Response.json({ error: result.error }, { status: result.status })
    },
  },
]

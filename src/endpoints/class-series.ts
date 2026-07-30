import type { Endpoint } from 'payload'
import { isStaffRequest } from '../lib/staff-request'
import { previewSeries, createSeries } from '../services/class-series'
import type { RecurrenceRule } from '../lib/recurrence'

/** Staff-only generator endpoints, mounted under /api/class-instances. */
export const classSeriesEndpoints: Endpoint[] = [
  {
    path: '/series-preview',
    method: 'post',
    handler: async (req) => {
      if (!isStaffRequest(req)) return Response.json({ error: 'Forbidden' }, { status: 403 })
      const body = req.json ? await req.json().catch(() => null) : null
      if (!body) return Response.json({ error: 'Invalid JSON' }, { status: 400 })
      const result = await previewSeries(req.payload, {
        classId: Number(body.classId),
        rule: body.rule as RecurrenceRule,
        from: String(body.from ?? ''),
        until: String(body.until ?? ''),
      })
      if (result.ok) return Response.json(result)
      return Response.json({ error: result.error }, { status: result.status })
    },
  },
  {
    path: '/series-create',
    method: 'post',
    handler: async (req) => {
      if (!isStaffRequest(req)) return Response.json({ error: 'Forbidden' }, { status: 403 })
      const body = req.json ? await req.json().catch(() => null) : null
      if (!body) return Response.json({ error: 'Invalid JSON' }, { status: 400 })
      const result = await createSeries(req.payload, {
        classId: Number(body.classId),
        instructorId: Number(body.instructorId),
        dates: Array.isArray(body.dates) ? body.dates.map(String) : [],
        startTime: String(body.startTime ?? ''),
        endTime: String(body.endTime ?? ''),
        label: body.label ? String(body.label) : undefined,
        capacity: body.capacity != null ? Number(body.capacity) : undefined,
        priceCents: body.priceCents != null ? Number(body.priceCents) : undefined,
        location: body.location ? String(body.location) : undefined,
      })
      if (result.ok) return Response.json(result)
      return Response.json({ error: result.error }, { status: result.status })
    },
  },
]

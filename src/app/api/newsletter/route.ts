import { kitEnabled, createKitSubscriber } from '../../../lib/kit'
import { subscribeToNewsletter } from '../../../services/newsletter'

export async function POST(req: Request) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!kitEnabled()) {
    return Response.json({ error: 'Newsletter signup is unavailable right now.' }, { status: 503 })
  }

  const result = await subscribeToNewsletter(
    { createSubscriber: createKitSubscriber },
    {
      email: String(body?.email ?? ''),
      firstName: body?.firstName ? String(body.firstName) : undefined,
      website: body?.website ? String(body.website) : undefined,
      startedAt: typeof body?.startedAt === 'number' ? body.startedAt : undefined,
    },
  )
  if (result.ok) return Response.json({ ok: true })
  return Response.json({ error: result.error }, { status: result.status })
}

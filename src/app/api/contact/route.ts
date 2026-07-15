import { getPayload } from 'payload'
import config from '@payload-config'
import { sendEmail } from '../../../lib/email'
import { submitContactMessage } from '../../../services/contact'
import { kitEnabled, createKitSubscriber } from '../../../lib/kit'

export async function POST(req: Request) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const payload = await getPayload({ config: await config })
  const result = await submitContactMessage(
    {
      payload,
      sendEmail,
      ...(kitEnabled()
        ? { subscribe: ({ email, name }: { email: string; name: string }) => createKitSubscriber({ email, firstName: name }) }
        : {}),
    },
    {
      name: String(body?.name ?? ''),
      email: String(body?.email ?? ''),
      message: String(body?.message ?? ''),
      website: body?.website ? String(body.website) : undefined,
      startedAt: typeof body?.startedAt === 'number' ? body.startedAt : undefined,
      subscribe: body?.subscribe === true,
    },
  )
  if (result.ok) return Response.json({ ok: true })
  return Response.json({ error: result.error }, { status: result.status })
}

import { getPayload } from 'payload'
import config from '@payload-config'
import { createMembership } from '../../../services/membership'
import { squareMembershipGateway } from '../../../lib/membership-gateway'
import { sendEmail } from '../../../lib/email'

export async function POST(req: Request) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { name, email, phone, sourceId } = body ?? {}
  if (!name || !email || !sourceId) return Response.json({ error: 'Missing required fields' }, { status: 400 })

  const payload = await getPayload({ config: await config })

  // Block duplicate active memberships for the same email.
  const existing = await payload.find({ collection: 'members', where: { email: { equals: email } }, limit: 1 })
  if (existing.totalDocs > 0) return Response.json({ error: 'A membership already exists for this email' }, { status: 409 })

  try {
    const member = await createMembership(
      { payload, gateway: squareMembershipGateway, sendEmail },
      { name, email, phone, sourceId },
    )
    return Response.json({ ok: true, memberId: member.id })
  } catch (e: any) {
    return Response.json({ error: e?.message ?? 'Membership signup failed' }, { status: 402 })
  }
}

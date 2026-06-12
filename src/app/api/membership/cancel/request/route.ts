import { getPayload } from 'payload'
import config from '@payload-config'
import { sendEmail } from '../../../../../lib/email'
import { requestMembershipCancel } from '../../../../../services/membership-cancel'

const GENERIC = { ok: true, message: 'If a membership matches that email, we’ve sent a cancellation link.' }

export async function POST(req: Request) {
  let email = ''
  try {
    email = String((await req.json())?.email ?? '').trim()
  } catch {
    // ignore — still return the generic response below
  }
  const payload = await getPayload({ config: await config })
  const baseUrl = process.env.PUBLIC_BASE_URL ?? new URL(req.url).origin
  try {
    if (email) await requestMembershipCancel({ payload, sendEmail, baseUrl }, email)
  } catch (e) {
    console.error('cancel request failed:', e)
  }
  return Response.json(GENERIC)
}

import { getPayload } from 'payload'
import config from '@payload-config'
import { confirmMembershipCancel } from '../../../../../services/membership-cancel'

export async function POST(req: Request) {
  let token = ''
  try {
    token = String((await req.json())?.token ?? '')
  } catch {
    return Response.json({ ok: false, reason: 'invalid' }, { status: 400 })
  }
  const payload = await getPayload({ config: await config })
  const result = await confirmMembershipCancel({ payload }, token)
  return Response.json(result)
}

import { createHash, randomBytes } from 'crypto'
import type { Payload } from 'payload'
import type { EmailInput } from '../lib/email'

const TOKEN_TTL_MS = 30 * 60_000

export const hashToken = (raw: string): string => createHash('sha256').update(raw).digest('hex')

export interface CancelRequestDeps {
  payload: Payload
  sendEmail: (input: EmailInput) => Promise<void>
  baseUrl: string
}
export interface CancelConfirmDeps {
  payload: Payload
}

type CancelResult = { ok: boolean; reason?: 'invalid' | 'expired' }

/**
 * Issue a single-use cancellation link to a member with a cancelable Square
 * subscription. Always resolves quietly (no throw, no signal) so the caller can
 * return an identical response regardless of whether the email matched.
 */
export async function requestMembershipCancel(deps: CancelRequestDeps, email: string): Promise<void> {
  const { payload, sendEmail, baseUrl } = deps
  if (!email) return
  const { docs } = await payload.find({
    collection: 'people',
    where: { email: { equals: email } },
    limit: 1,
    overrideAccess: true,
  })
  const member: any = docs[0]
  if (!member || !member.squareSubscriptionId || member.status === 'cancelled') return

  const raw = randomBytes(32).toString('base64url')
  await payload.update({
    collection: 'people',
    id: member.id,
    overrideAccess: true,
    data: { cancelTokenHash: hashToken(raw), cancelTokenExpiresAt: new Date(Date.now() + TOKEN_TTL_MS).toISOString() },
  })

  const link = `${baseUrl.replace(/\/$/, '')}/membership/cancel/confirm?token=${raw}`
  try {
    await sendEmail({
      to: member.email,
      subject: 'Cancel your Portside Pottery membership',
      html: `<p>Click the link below to cancel your membership. It expires in 30 minutes and can be used once.</p>
<p><a href="${link}">${link}</a></p>
<p>If you didn't request this, you can ignore this email — nothing will change.</p>`,
    })
  } catch (e) {
    console.error(`Cancel link email failed for member ${member.id}:`, e)
  }
}

async function findByToken(payload: Payload, token: string): Promise<any | null> {
  if (!token) return null
  const { docs } = await payload.find({
    collection: 'people',
    where: { cancelTokenHash: { equals: hashToken(token) } },
    limit: 1,
    overrideAccess: true,
  })
  return docs[0] ?? null
}

function tokenState(member: any | null): CancelResult {
  if (!member) return { ok: false, reason: 'invalid' }
  const exp = member.cancelTokenExpiresAt ? new Date(member.cancelTokenExpiresAt).getTime() : 0
  if (!exp || exp < Date.now()) return { ok: false, reason: 'expired' }
  return { ok: true }
}

/** Read-only: validate a token for rendering the confirm page. Never mutates. */
export async function validateCancelToken(
  deps: CancelConfirmDeps,
  token: string,
): Promise<CancelResult & { member?: { id: string | number; name: string } }> {
  const member = await findByToken(deps.payload, token)
  const state = tokenState(member)
  if (!state.ok) return state
  return { ok: true, member: { id: member.id, name: member.name } }
}

/** Mutating: cancel the membership and consume the token. */
export async function confirmMembershipCancel(deps: CancelConfirmDeps, token: string): Promise<CancelResult> {
  const member = await findByToken(deps.payload, token)
  const state = tokenState(member)
  if (!state.ok) return state
  await deps.payload.update({
    collection: 'people',
    id: member.id,
    overrideAccess: true,
    data: { status: 'cancelled', cancelTokenHash: null, cancelTokenExpiresAt: null },
  })
  return { ok: true }
}

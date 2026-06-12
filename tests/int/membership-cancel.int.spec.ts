import { describe, it, expect, vi } from 'vitest'
import {
  hashToken,
  requestMembershipCancel,
  validateCancelToken,
  confirmMembershipCancel,
} from '../../src/services/membership-cancel'

const future = () => new Date(Date.now() + 30 * 60_000).toISOString()
const past = () => new Date(Date.now() - 60_000).toISOString()

function fakePayload(members: any[]) {
  const update = vi.fn(async ({ id, data }: any) => {
    const m = members.find((x) => x.id === id)
    if (m) Object.assign(m, data)
    return { id, ...data }
  })
  const find = vi.fn(async ({ where }: any) => {
    if (where?.email?.equals) return { docs: members.filter((m) => m.email === where.email.equals) }
    if (where?.cancelTokenHash?.equals) return { docs: members.filter((m) => m.cancelTokenHash === where.cancelTokenHash.equals) }
    return { docs: [] }
  })
  return { update, find } as any
}

describe('requestMembershipCancel', () => {
  it('emails a single-use link and stores a hash for a cancelable member', async () => {
    const member: any = { id: 1, email: 'm@test.local', status: 'active', squareSubscriptionId: 'sub_1' }
    const payload = fakePayload([member])
    const sendEmail = vi.fn(async (_input: any) => {})
    await requestMembershipCancel({ payload, sendEmail, baseUrl: 'https://x.test' }, 'm@test.local')

    expect(sendEmail).toHaveBeenCalledTimes(1)
    const html: string = sendEmail.mock.calls[0][0].html
    const m = html.match(/cancel\/confirm\?token=([A-Za-z0-9_-]+)/)
    expect(m).toBeTruthy()
    const rawToken = m![1]
    expect(member.cancelTokenHash).toBe(hashToken(rawToken))
    expect(new Date(member.cancelTokenExpiresAt).getTime()).toBeGreaterThan(Date.now())
  })

  it('does nothing (no email, no throw) for an unknown email', async () => {
    const payload = fakePayload([])
    const sendEmail = vi.fn(async () => {})
    await expect(requestMembershipCancel({ payload, sendEmail, baseUrl: 'https://x.test' }, 'nobody@test.local')).resolves.toBeUndefined()
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('does nothing for a member with no Square subscription (Free)', async () => {
    const payload = fakePayload([{ id: 2, email: 'free@test.local', status: 'active', squareSubscriptionId: null }])
    const sendEmail = vi.fn(async () => {})
    await requestMembershipCancel({ payload, sendEmail, baseUrl: 'https://x.test' }, 'free@test.local')
    expect(sendEmail).not.toHaveBeenCalled()
  })
})

describe('validateCancelToken (read-only)', () => {
  it('returns ok + member for a valid token and does NOT mutate', async () => {
    const member = { id: 1, name: 'Mae', email: 'm@test.local', status: 'active', squareSubscriptionId: 'sub_1', cancelTokenHash: hashToken('raw'), cancelTokenExpiresAt: future() }
    const payload = fakePayload([member])
    const res = await validateCancelToken({ payload }, 'raw')
    expect(res.ok).toBe(true)
    expect(res.member?.name).toBe('Mae')
    expect(payload.update).not.toHaveBeenCalled()
    expect(member.status).toBe('active')
  })

  it('returns expired for an expired token', async () => {
    const payload = fakePayload([{ id: 1, cancelTokenHash: hashToken('raw'), cancelTokenExpiresAt: past() }])
    expect(await validateCancelToken({ payload }, 'raw')).toEqual({ ok: false, reason: 'expired' })
  })

  it('returns invalid for an unknown token', async () => {
    const payload = fakePayload([])
    expect(await validateCancelToken({ payload }, 'nope')).toEqual({ ok: false, reason: 'invalid' })
  })
})

describe('confirmMembershipCancel (mutating)', () => {
  it('cancels and clears the token for a valid token', async () => {
    const member = { id: 1, status: 'active', squareSubscriptionId: 'sub_1', cancelTokenHash: hashToken('raw'), cancelTokenExpiresAt: future() }
    const payload = fakePayload([member])
    const res = await confirmMembershipCancel({ payload }, 'raw')
    expect(res).toEqual({ ok: true })
    expect(payload.update).toHaveBeenCalledWith(
      expect.objectContaining({ collection: 'members', id: 1, data: expect.objectContaining({ status: 'cancelled', cancelTokenHash: null, cancelTokenExpiresAt: null }) }),
    )
  })

  it('does not cancel an expired token', async () => {
    const member = { id: 1, status: 'active', cancelTokenHash: hashToken('raw'), cancelTokenExpiresAt: past() }
    const payload = fakePayload([member])
    expect(await confirmMembershipCancel({ payload }, 'raw')).toEqual({ ok: false, reason: 'expired' })
    expect(payload.update).not.toHaveBeenCalled()
  })

  it('does not cancel an unknown token', async () => {
    const payload = fakePayload([])
    expect(await confirmMembershipCancel({ payload }, 'nope')).toEqual({ ok: false, reason: 'invalid' })
    expect(payload.update).not.toHaveBeenCalled()
  })
})

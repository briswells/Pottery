import { describe, it, expect, vi } from 'vitest'

const requestMock = vi.hoisted(() => vi.fn(async () => undefined))
const confirmMock = vi.hoisted(() =>
  vi.fn(async (): Promise<{ ok: boolean; reason?: 'invalid' | 'expired' }> => ({ ok: true })),
)
vi.mock('../../src/services/membership-cancel', () => ({
  requestMembershipCancel: requestMock,
  confirmMembershipCancel: confirmMock,
}))
// Avoid booting Payload in the routes under test.
vi.mock('payload', () => ({ getPayload: vi.fn(async () => ({})) }))
vi.mock('@payload-config', () => ({ default: {} }))

import { POST as requestPOST } from '../../src/app/api/membership/cancel/request/route'
import { POST as confirmPOST } from '../../src/app/api/membership/cancel/confirm/route'

const jsonReq = (body: any) =>
  new Request('https://x.test/api/membership/cancel/x', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })

describe('cancel request route', () => {
  it('returns a generic ok regardless of input (no enumeration)', async () => {
    const res = await requestPOST(jsonReq({ email: 'a@test.local' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(data.message).toMatch(/if a membership/i)
    expect(requestMock).toHaveBeenCalled()
  })

  it('still returns generic ok when no email is given', async () => {
    requestMock.mockClear()
    const res = await requestPOST(jsonReq({}))
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
  })
})

describe('cancel confirm route', () => {
  it('returns the service result', async () => {
    confirmMock.mockResolvedValueOnce({ ok: false, reason: 'expired' })
    const res = await confirmPOST(jsonReq({ token: 'x' }))
    expect(await res.json()).toEqual({ ok: false, reason: 'expired' })
  })
})

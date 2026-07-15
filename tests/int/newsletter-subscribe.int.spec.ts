import { describe, it, expect, vi } from 'vitest'
import { subscribeToNewsletter } from '../../src/services/newsletter'

const VALID = { email: 'jo@example.com', startedAt: Date.now() - 10_000 }

function deps(createSubscriber = vi.fn(async () => ({}))) {
  return { createSubscriber }
}

describe('subscribeToNewsletter', () => {
  it('subscribes a valid email', async () => {
    const d = deps()
    const res = await subscribeToNewsletter(d, VALID)
    expect(res).toEqual({ ok: true })
    expect(d.createSubscriber).toHaveBeenCalledWith({ email: 'jo@example.com' })
  })

  it('passes a trimmed first name through', async () => {
    const d = deps()
    await subscribeToNewsletter(d, { ...VALID, firstName: '  Jo\r\nPotter  ' })
    expect(d.createSubscriber).toHaveBeenCalledWith({ email: 'jo@example.com', firstName: 'Jo Potter' })
  })

  it('silently succeeds without subscribing when the honeypot is filled', async () => {
    const d = deps()
    const res = await subscribeToNewsletter(d, { ...VALID, website: 'http://spam.example' })
    expect(res).toEqual({ ok: true })
    expect(d.createSubscriber).not.toHaveBeenCalled()
  })

  it('silently succeeds without subscribing when submitted too fast', async () => {
    const d = deps()
    const res = await subscribeToNewsletter(d, { ...VALID, startedAt: Date.now() - 500 })
    expect(res).toEqual({ ok: true })
    expect(d.createSubscriber).not.toHaveBeenCalled()
  })

  it('rejects a malformed email with 400', async () => {
    const d = deps()
    const res = await subscribeToNewsletter(d, { ...VALID, email: 'not-an-email' })
    expect(res).toMatchObject({ ok: false, status: 400 })
    expect(d.createSubscriber).not.toHaveBeenCalled()
  })

  it('returns a friendly 500 when Kit fails', async () => {
    const d = deps(vi.fn(async () => { throw new Error('kit down') }))
    const res = await subscribeToNewsletter(d, VALID)
    expect(res).toMatchObject({ ok: false, status: 500 })
    expect((res as any).error).toMatch(/try again/i)
  })
})

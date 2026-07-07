import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getTestPayload } from './helpers'
import { submitContactMessage } from '../../src/services/contact'

const OLD_ENV = process.env.STAFF_NOTIFY_EMAIL

function deps(sendEmail = vi.fn(async () => {})) {
  return { sendEmail }
}
const VALID = { name: 'Jo Potter', email: 'jo@example.com', message: 'Hi there!\n<b>Do you fire?</b>', startedAt: Date.now() - 10_000 }

describe('submitContactMessage', () => {
  beforeEach(() => {
    process.env.STAFF_NOTIFY_EMAIL = OLD_ENV || 'staff@test.local'
  })

  it('sends to the notify address with visitor replyTo and escaped body', async () => {
    const payload = await getTestPayload()
    const d = deps()
    const res = await submitContactMessage({ payload, ...d }, VALID)
    expect(res).toEqual({ ok: true })
    expect(d.sendEmail).toHaveBeenCalledTimes(1)
    const arg: any = (d.sendEmail.mock.calls as any[])[0][0]
    expect(arg.to).toBeTruthy() // site-settings email or STAFF_NOTIFY_EMAIL fallback
    expect(arg.replyTo).toBe('jo@example.com')
    expect(arg.subject).toBe('New message from Jo Potter — website contact form')
    expect(arg.html).toContain('&lt;b&gt;Do you fire?&lt;/b&gt;') // escaped
    expect(arg.html).not.toContain('<b>Do you fire?</b>')
    expect(arg.html).toContain('<br') // newline preserved as line break
  })

  it('silently succeeds without sending when the honeypot is filled', async () => {
    const payload = await getTestPayload()
    const d = deps()
    const res = await submitContactMessage({ payload, ...d }, { ...VALID, website: 'http://spam.example' })
    expect(res).toEqual({ ok: true })
    expect(d.sendEmail).not.toHaveBeenCalled()
  })

  it('silently succeeds without sending when submitted too fast', async () => {
    const payload = await getTestPayload()
    const d = deps()
    const res = await submitContactMessage({ payload, ...d }, { ...VALID, startedAt: Date.now() - 500 })
    expect(res).toEqual({ ok: true })
    expect(d.sendEmail).not.toHaveBeenCalled()
  })

  it('rejects missing fields and a bad email with 400', async () => {
    const payload = await getTestPayload()
    const d = deps()
    expect(await submitContactMessage({ payload, ...d }, { ...VALID, name: '  ' })).toMatchObject({ ok: false, status: 400 })
    expect(await submitContactMessage({ payload, ...d }, { ...VALID, message: '' })).toMatchObject({ ok: false, status: 400 })
    expect(await submitContactMessage({ payload, ...d }, { ...VALID, email: 'not-an-email' })).toMatchObject({ ok: false, status: 400 })
    expect(d.sendEmail).not.toHaveBeenCalled()
  })

  it('caps message length with 400', async () => {
    const payload = await getTestPayload()
    const d = deps()
    const res = await submitContactMessage({ payload, ...d }, { ...VALID, message: 'x'.repeat(5001) })
    expect(res).toMatchObject({ ok: false, status: 400 })
  })

  it('returns 500 with a friendly message when send fails', async () => {
    const payload = await getTestPayload()
    const d = deps(vi.fn(async () => { throw new Error('resend down') }))
    const res = await submitContactMessage({ payload, ...d }, VALID)
    expect(res).toMatchObject({ ok: false, status: 500 })
    expect((res as any).error).toMatch(/email us directly/i)
  })

  it('strips CR/LF from the name before it reaches the subject', async () => {
    const payload = await getTestPayload()
    const d = deps()
    const res = await submitContactMessage({ payload, ...d }, { ...VALID, name: 'Bob\r\nBcc: evil@x.com' })
    expect(res).toEqual({ ok: true })
    const arg: any = (d.sendEmail.mock.calls as any[])[0][0]
    expect(arg.subject).not.toMatch(/[\r\n]/)
    expect(arg.subject).toContain('Bob Bcc: evil@x.com')
  })
})

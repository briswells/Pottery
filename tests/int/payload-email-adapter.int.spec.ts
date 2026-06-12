import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the shared Resend client so we assert the message mapping without sending.
const send = vi.hoisted(() => vi.fn(async () => ({ data: { id: 'e_1' }, error: null }) as any))
vi.mock('../../src/lib/email', () => ({ getResend: () => ({ emails: { send } }) }))

import { resendEmailAdapter, parseFromAddress } from '../../src/lib/payload-email-adapter'

function adapter() {
  return resendEmailAdapter({ defaultFromName: 'Portside Pottery', defaultFromAddress: 'noreply@portside.test' })({
    payload: {} as any,
  })
}

describe('resendEmailAdapter.sendEmail', () => {
  beforeEach(() => send.mockClear())

  it('maps to/subject/html and falls back to the default from', async () => {
    await adapter().sendEmail({ to: 'staff@x.com', subject: 'Reset your password', html: '<p>link</p>' } as any)
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'Portside Pottery <noreply@portside.test>',
        to: ['staff@x.com'],
        subject: 'Reset your password',
        html: '<p>link</p>',
      }),
    )
  })

  it('honors an explicit from Address and a text body', async () => {
    await adapter().sendEmail({ from: { name: 'Studio', address: 'hi@x.com' }, to: 'a@x.com', subject: 's', text: 't' } as any)
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ from: 'Studio <hi@x.com>', text: 't' }))
  })

  it('normalizes an array of recipients (strings + Address objects)', async () => {
    await adapter().sendEmail({ to: ['a@x.com', { name: 'B', address: 'b@x.com' }], subject: 's', html: 'h' } as any)
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: ['a@x.com', 'B <b@x.com>'] }))
  })

  it('throws when Resend returns an error', async () => {
    send.mockResolvedValueOnce({ data: null, error: { message: 'boom' } } as any)
    await expect(adapter().sendEmail({ to: 'a@x.com', subject: 's', html: 'h' } as any)).rejects.toThrow(/boom/)
  })

  it('passes attachments through to Resend', async () => {
    await adapter().sendEmail({
      to: 'a@x.com',
      subject: 's',
      html: 'h',
      attachments: [{ filename: 'class.ics', content: 'BEGIN:VCALENDAR' }],
    } as any)
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [{ filename: 'class.ics', content: 'BEGIN:VCALENDAR' }],
      }),
    )
  })
})

describe('parseFromAddress', () => {
  it('parses "Name <addr>"', () => {
    expect(parseFromAddress('Portside Pottery <no@x.com>')).toEqual({
      defaultFromName: 'Portside Pottery',
      defaultFromAddress: 'no@x.com',
    })
  })
  it('treats a bare address as the address with the default name', () => {
    expect(parseFromAddress('no@x.com')).toEqual({ defaultFromName: 'Portside Pottery', defaultFromAddress: 'no@x.com' })
  })
  it('falls back to a default name on empty/undefined input', () => {
    expect(parseFromAddress(undefined)).toEqual({ defaultFromName: 'Portside Pottery', defaultFromAddress: '' })
  })
})

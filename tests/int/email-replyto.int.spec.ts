import { describe, it, expect, vi } from 'vitest'

const send = vi.hoisted(() => vi.fn(async () => ({ data: { id: 'em_1' }, error: null })))
vi.mock('resend', () => ({
  Resend: class {
    emails = { send }
  },
}))

import { sendEmail } from '../../src/lib/email'

describe('sendEmail replyTo', () => {
  it('forwards replyTo to Resend when provided', async () => {
    await sendEmail({ to: 'a@b.co', subject: 's', html: '<p>x</p>', replyTo: 'visitor@x.co' })
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ replyTo: 'visitor@x.co' }))
  })

  it('omits replyTo when not provided', async () => {
    send.mockClear()
    await sendEmail({ to: 'a@b.co', subject: 's', html: '<p>x</p>' })
    expect(send.mock.calls[0][0]).not.toHaveProperty('replyTo')
  })
})

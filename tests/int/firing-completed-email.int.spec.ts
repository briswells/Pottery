// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'

const send = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('../../src/lib/email', () => ({
  sendEmail: send,
  getResend: () => ({}),
}))

import { getTestPayload } from './helpers'

async function mkRequest(p: any) {
  return p.create({
    collection: 'firing-requests',
    overrideAccess: true,
    data: {
      name: 'Done Test',
      email: `done-${Date.now()}-${Math.floor(Math.random() * 1e5)}@fctest.local`,
      description: 'mugs',
      halfShelves: 1,
      amountCents: 2500,
      stonewareConfirmed: true,
      status: 'paid',
    },
  })
}

describe('sendFiringCompletedEmail', () => {
  beforeEach(() => send.mockClear())

  it('emails the customer once on the transition to completed, with the studio hours', async () => {
    const p = await getTestPayload()
    await p.updateGlobal({
      slug: 'site-settings',
      overrideAccess: true,
      data: {
        studioName: 'Portside Pottery',
        hours: [
          { days: 'Mon–Fri', time: '10am–3:30pm' },
          { days: 'Sat', time: '11am–7pm' },
        ],
      },
    })
    const fr = await mkRequest(p)
    // dropped_off does NOT email
    await p.update({ collection: 'firing-requests', id: fr.id, overrideAccess: true, data: { status: 'dropped_off' } })
    expect(send).not.toHaveBeenCalled()
    // completed emails once
    await p.update({ collection: 'firing-requests', id: fr.id, overrideAccess: true, data: { status: 'completed' } })
    expect(send).toHaveBeenCalledTimes(1)
    const arg: any = (send.mock.calls as unknown[][])[0][0]
    expect(arg.to).toBe(fr.email)
    expect(arg.subject).toMatch(/ready for pickup/i)
    expect(arg.html).toContain('normal business hours')
    expect(arg.html).toContain('Mon–Fri: 10am–3:30pm')
    expect(arg.html).toContain('Sat: 11am–7pm')
    // a later unrelated save while completed does NOT re-email
    await p.update({ collection: 'firing-requests', id: fr.id, overrideAccess: true, data: { notes: 'picked up' } })
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('supports the dropped_off status value', async () => {
    const p = await getTestPayload()
    const fr = await mkRequest(p)
    const updated = await p.update({ collection: 'firing-requests', id: fr.id, overrideAccess: true, data: { status: 'dropped_off' } })
    expect(updated.status).toBe('dropped_off')
  })
})

afterAll(async () => {
  const p = await getTestPayload()
  await p.delete({ collection: 'firing-requests', where: { email: { contains: '@fctest.local' } }, overrideAccess: true })
})

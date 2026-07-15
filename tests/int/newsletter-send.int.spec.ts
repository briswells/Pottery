import { describe, it, expect, vi } from 'vitest'
import { getTestPayload } from './helpers'
import { sendNewsletter, sendNewsletterTest } from '../../src/services/newsletter'

const BODY = {
  root: {
    type: 'root', format: '' as const, indent: 0, version: 1, direction: 'ltr' as const,
    children: [{
      type: 'paragraph', version: 1, format: '', indent: 0, direction: 'ltr' as const, textFormat: 0,
      children: [{ type: 'text', text: 'Fresh glazes are in.', version: 1, detail: 0, format: 0, mode: 'normal', style: '' }],
    }],
  },
}

async function makeDraft(subject = 'Glaze day') {
  const payload = await getTestPayload()
  return payload.create({ collection: 'newsletters', overrideAccess: true, data: { subject, body: BODY } })
}

function kitDeps(overrides: Partial<{ count: any; broadcast: any }> = {}) {
  return {
    countSubscribers: overrides.count ?? vi.fn(async () => 42),
    createBroadcast: overrides.broadcast ?? vi.fn(async () => ({ id: 900 })),
  }
}

describe('sendNewsletter', () => {
  it('renders, creates the broadcast, and stamps the doc sent in one update', async () => {
    const payload = await getTestPayload()
    const doc = await makeDraft()
    const deps = { payload, ...kitDeps() }
    const now = new Date('2026-07-16T18:00:00.000Z')

    const res = await sendNewsletter(deps, { id: doc.id, now })
    expect(res).toEqual({ ok: true, recipientCount: 42 })

    const call: any = (deps.createBroadcast as any).mock.calls[0][0]
    expect(call.subject).toBe('Glaze day')
    expect(call.contentHtml).toContain('Fresh glazes are in.')
    expect(call.sendAt).toEqual(now)

    const after = await payload.findByID({ collection: 'newsletters', id: doc.id, overrideAccess: true })
    expect(after.status).toBe('sent')
    expect(after.kitBroadcastId).toBe('900')
    expect(after.recipientCount).toBe(42)
    expect(after.sentAt).toBeTruthy()
  })

  it('refuses to send twice with 409', async () => {
    const payload = await getTestPayload()
    const doc = await makeDraft('Once only')
    const deps = { payload, ...kitDeps() }
    await sendNewsletter(deps, { id: doc.id })
    const again = await sendNewsletter(deps, { id: doc.id })
    expect(again).toMatchObject({ ok: false, status: 409 })
    expect(deps.createBroadcast).toHaveBeenCalledTimes(1)
  })

  it('returns 404 for a missing newsletter', async () => {
    const payload = await getTestPayload()
    const res = await sendNewsletter({ payload, ...kitDeps() }, { id: 999999 })
    expect(res).toMatchObject({ ok: false, status: 404 })
  })

  it('leaves the doc a draft when the broadcast fails', async () => {
    const payload = await getTestPayload()
    const doc = await makeDraft('Fails')
    const deps = { payload, ...kitDeps({ broadcast: vi.fn(async () => { throw new Error('kit 500') }) }) }
    const res = await sendNewsletter(deps, { id: doc.id })
    expect(res).toMatchObject({ ok: false, status: 500 })
    const after = await payload.findByID({ collection: 'newsletters', id: doc.id, overrideAccess: true })
    expect(after.status).toBe('draft')
    expect(after.kitBroadcastId ?? null).toBeNull()
  })

  it('still sends when the subscriber count is unavailable', async () => {
    const payload = await getTestPayload()
    const doc = await makeDraft('No count')
    const deps = { payload, ...kitDeps({ count: vi.fn(async () => { throw new Error('kit list down') }) }) }
    const res = await sendNewsletter(deps, { id: doc.id })
    expect(res).toEqual({ ok: true, recipientCount: null })
  })

  it('a concurrent double-send only creates one broadcast (in-process lock)', async () => {
    const payload = await getTestPayload()
    const doc = await makeDraft('Double click')

    // Deferred pattern: createBroadcast blocks until we release it, so both
    // sendNewsletter calls are guaranteed to be in flight simultaneously.
    let release: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const createBroadcast = vi.fn(async () => {
      await gate
      return { id: 901 }
    })
    const deps = { payload, ...kitDeps({ broadcast: createBroadcast }) }

    const p1 = sendNewsletter(deps, { id: doc.id })
    const p2 = sendNewsletter(deps, { id: doc.id })
    release!()
    const [r1, r2] = await Promise.all([p1, p2])

    expect(createBroadcast).toHaveBeenCalledTimes(1)
    const results = [r1, r2]
    const okResults = results.filter((r) => r.ok)
    const conflictResults = results.filter((r) => !r.ok)
    expect(okResults).toHaveLength(1)
    expect(conflictResults).toHaveLength(1)
    expect(conflictResults[0]).toMatchObject({ ok: false, status: 409 })
  })
})

describe('sendNewsletterTest', () => {
  it('emails the rendered newsletter to the given address with a [Test] subject', async () => {
    const payload = await getTestPayload()
    const doc = await makeDraft('Proof me')
    const sendEmail = vi.fn(async () => {})
    const res = await sendNewsletterTest({ payload, sendEmail }, { id: doc.id, to: 'admin@studio.test' })
    expect(res).toEqual({ ok: true })
    const arg: any = (sendEmail as any).mock.calls[0][0]
    expect(arg.to).toBe('admin@studio.test')
    expect(arg.subject).toBe('[Test] Proof me')
    expect(arg.html).toContain('Fresh glazes are in.')
  })
})

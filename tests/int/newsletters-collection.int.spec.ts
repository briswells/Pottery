import { describe, it, expect } from 'vitest'
import { getTestPayload } from './helpers'

const BODY = {
  root: {
    type: 'root', format: '', indent: 0, version: 1, direction: 'ltr' as const,
    children: [{
      type: 'paragraph', version: 1, format: '', indent: 0, direction: 'ltr' as const, textFormat: 0,
      children: [{ type: 'text', text: 'Hello potters!', version: 1, detail: 0, format: 0, mode: 'normal', style: '' }],
    }],
  },
}

describe('newsletters collection', () => {
  it('creates a draft and allows editing drafts', async () => {
    const payload = await getTestPayload()
    const doc = await payload.create({
      collection: 'newsletters',
      overrideAccess: true,
      data: { subject: 'July at the studio', body: BODY },
    })
    expect(doc.status).toBe('draft')
    const updated = await payload.update({
      collection: 'newsletters', id: doc.id, overrideAccess: true,
      data: { subject: 'July at Portside' },
    })
    expect(updated.subject).toBe('July at Portside')
  })

  it('locks a newsletter once sent', async () => {
    const payload = await getTestPayload()
    const doc = await payload.create({
      collection: 'newsletters', overrideAccess: true,
      data: { subject: 'Lockme', body: BODY },
    })
    // The draft→sent transition (what the send endpoint does) is allowed…
    await payload.update({
      collection: 'newsletters', id: doc.id, overrideAccess: true,
      data: { status: 'sent', sentAt: new Date().toISOString(), kitBroadcastId: '123', recipientCount: 5 },
    })
    // …but any edit after that is rejected.
    await expect(
      payload.update({ collection: 'newsletters', id: doc.id, overrideAccess: true, data: { subject: 'Changed' } }),
    ).rejects.toThrow(/already been sent/i)
  })
})

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Payload } from 'payload'
import { getTestPayload } from './helpers'
import { getLatestSentNewsletter } from '../../src/services/newsletter'

let payload: Payload
const madeIds: number[] = []

const BODY = {
  root: {
    type: 'root', format: '' as const, indent: 0, version: 1, direction: 'ltr' as const,
    children: [{
      type: 'paragraph', version: 1, format: '', indent: 0, direction: 'ltr' as const, textFormat: 0,
      children: [{ type: 'text', text: 'Web issue body', version: 1, detail: 0, format: 0, mode: 'normal', style: '' }],
    }],
  },
}

async function makeNewsletter(subject: string, sent: string | null) {
  const doc = await payload.create({
    collection: 'newsletters', overrideAccess: true,
    data: { subject, body: BODY },
  })
  madeIds.push(doc.id as number)
  if (sent) {
    await payload.update({
      collection: 'newsletters', id: doc.id, overrideAccess: true,
      data: { status: 'sent', sentAt: sent, kitBroadcastId: `test-${doc.id}`, recipientCount: 1 },
    })
  }
  return doc
}

beforeAll(async () => {
  payload = await getTestPayload()
})

afterAll(async () => {
  // Sent newsletters are edit-locked but deletable; remove everything we made
  // so this file can't pollute the rest of the int suite.
  try {
    for (const id of madeIds) {
      await payload.delete({ collection: 'newsletters', id, overrideAccess: true })
    }
  } catch (e) {
    payload.logger.error(`newsletter-page test cleanup failed: ${e instanceof Error ? e.message : e}`)
  }
})

describe('getLatestSentNewsletter', () => {
  // Other int files (newsletter-send) create sent newsletters with sentAt=now
  // in the same shared DB, so these tests are written interference-proof:
  // drafts are proven excluded by subject, and this file's sent fixtures use
  // far-future dates so they're strictly newest no matter what else ran.
  it('never returns a draft', async () => {
    await makeNewsletter('Draft only', null)
    const latest = await getLatestSentNewsletter(payload)
    expect(latest?.subject ?? null).not.toBe('Draft only')
    if (latest) expect(latest.status).toBe('sent')
  })

  it('returns the most recently sent issue', async () => {
    await makeNewsletter('Older issue', '2031-07-01T18:00:00.000Z')
    await makeNewsletter('Newest issue', '2031-08-01T18:00:00.000Z')
    await makeNewsletter('Middle issue', '2031-07-15T18:00:00.000Z')
    const latest = await getLatestSentNewsletter(payload)
    expect(latest?.subject).toBe('Newest issue')
  })
})

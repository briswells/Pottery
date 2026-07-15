import 'dotenv/config'
import { getPayload } from 'payload'
import config from '@payload-config'
import { renderNewsletterHtml } from '../src/lib/newsletter-render'
import type { SerializedEditorState } from '@payloadcms/richtext-lexical/lexical'

/**
 * Seeds a starter "duplicate me" newsletter draft with the studio's usual
 * structure already formatted, so staff duplicate it (⋯ → Duplicate on the
 * doc) instead of starting from a blank editor. Idempotent by subject.
 * Run in the app container: npx tsx scripts/seed-newsletter-template.ts
 */

const SUBJECT = '📋 Newsletter template — duplicate me, don’t send'

const text = (t: string, format = 0) => ({
  type: 'text', text: t, version: 1, detail: 0, format, mode: 'normal', style: '',
})
const paragraph = (children: unknown[]) => ({
  type: 'paragraph', version: 1, format: '', indent: 0, direction: 'ltr', textFormat: 0, children,
})
const heading = (tag: 'h2' | 'h3', t: string) => ({
  type: 'heading', tag, version: 1, format: '', indent: 0, direction: 'ltr', children: [text(t)],
})
const bullets = (items: string[]) => ({
  type: 'list', listType: 'bullet', tag: 'ul', start: 1, version: 1, format: '', indent: 0, direction: 'ltr',
  children: items.map((t, i) => ({
    type: 'listitem', value: i + 1, version: 1, format: '', indent: 0, direction: 'ltr',
    children: [text(t)],
  })),
})

const BOLD = 1

const BODY = {
  root: {
    type: 'root', format: '' as const, indent: 0, version: 1, direction: 'ltr' as const,
    children: [
      paragraph([text('Hi friends of the studio,')]),
      paragraph([text('One or two warm opening sentences go here — what the month feels like at the studio, what just came out of the kiln, what you’re excited about.')]),
      heading('h2', 'What’s new'),
      paragraph([text('A short update. Replace this with your news — new glazes, schedule changes, member work you want to show off. Drop a photo in right here with the image button in the toolbar.')]),
      heading('h2', 'Upcoming classes'),
      paragraph([text('A sentence pointing people at what’s open. Edit this list:')]),
      bullets([
        'Class name — day & time — a few words on it',
        'Class name — day & time — a few words on it',
        'Class name — day & time — a few words on it',
      ]),
      paragraph([text('Book at portsidepottery.com/classes — spots go fast!', 0)]),
      heading('h2', 'Studio notes'),
      bullets([
        'Housekeeping item (holiday hours, shelf clean-out dates, firing schedule)',
        'Another quick note',
      ]),
      paragraph([text('See you at the wheel!', BOLD)]),
      paragraph([text('— The Portside Pottery crew')]),
    ],
  },
}

async function run() {
  const payload = await getPayload({ config: await config })

  const existing = await payload.find({
    collection: 'newsletters',
    where: { subject: { equals: SUBJECT } },
    limit: 1,
    overrideAccess: true,
  })
  if (existing.docs[0]) {
    console.log(`Template already exists (id ${existing.docs[0].id}) — nothing to do.`)
    process.exit(0)
  }

  const doc = await payload.create({
    collection: 'newsletters',
    overrideAccess: true,
    data: { subject: SUBJECT, body: BODY },
  })

  // Sanity: the stored body must render through the real email pipeline.
  const html = renderNewsletterHtml({
    body: doc.body as unknown as SerializedEditorState,
    baseUrl: process.env.PUBLIC_BASE_URL ?? 'https://example.com',
    studioName: 'Portside Pottery',
  })
  for (const marker of ['What’s new', 'Upcoming classes', 'Studio notes', 'See you at the wheel!']) {
    if (!html.includes(marker)) throw new Error(`Rendered template is missing "${marker}"`)
  }

  console.log(`Template created (id ${doc.id}); rendered HTML OK (${html.length} chars).`)
  process.exit(0)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})

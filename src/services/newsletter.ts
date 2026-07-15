/**
 * Newsletter signups. Kit (ConvertKit) is the source of truth for the list —
 * this service only validates + bot-filters and forwards to the injected Kit
 * client. Bot defense mirrors services/contact.ts: honeypot + min fill time,
 * both returning silent success so bots get no signal.
 */

import type { Payload } from 'payload'
import type { SerializedEditorState } from '@payloadcms/richtext-lexical/lexical'
import type { EmailInput } from '../lib/email'
import type { Newsletter } from '../payload-types'
import { renderNewsletterHtml } from '../lib/newsletter-render'

export interface NewsletterSubscribeDeps {
  createSubscriber: (input: { email: string; firstName?: string }) => Promise<unknown>
}

export interface NewsletterSignupInput {
  email: string
  firstName?: string
  /** Honeypot — real users never fill this; any value means a bot. */
  website?: string
  /** Client render timestamp (ms). Submits < MIN_FILL_MS later are bots. */
  startedAt?: number
}

export type NewsletterResult = { ok: true } | { ok: false; status: 400 | 500; error: string }

const MIN_FILL_MS = 3000
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function subscribeToNewsletter(
  deps: NewsletterSubscribeDeps,
  input: NewsletterSignupInput,
): Promise<NewsletterResult> {
  const email = (input.email ?? '').trim()
  const firstName = (input.firstName ?? '').replace(/[\r\n\t\v\f  ]+/g, ' ').trim().slice(0, 100)

  // Silent bot drops FIRST (before validation, so bots can't probe the rules).
  if (input.website) return { ok: true }
  if (typeof input.startedAt === 'number' && Date.now() - input.startedAt < MIN_FILL_MS) return { ok: true }

  if (!EMAIL_SHAPE.test(email)) return { ok: false, status: 400, error: 'Please enter a valid email address.' }

  try {
    await deps.createSubscriber({ email, ...(firstName ? { firstName } : {}) })
    return { ok: true }
  } catch (e) {
    console.error('Newsletter signup failed:', e)
    return { ok: false, status: 500, error: "We couldn't add you right now — please try again later." }
  }
}

export interface NewsletterSendDeps {
  payload: Payload
  countSubscribers: () => Promise<number | null>
  createBroadcast: (input: { subject: string; contentHtml: string; sendAt: Date }) => Promise<{ id: number }>
}

export type SendNewsletterResult =
  | { ok: true; recipientCount: number | null }
  | { ok: false; status: 404 | 409 | 500; error: string }

// Guards against a TOCTOU double-send: two near-simultaneous send calls
// (double-click, retry) can both pass the 409 status/kitBroadcastId check
// before either write lands, each creating a Kit broadcast and mailing the
// whole list twice. The app deploys as a single Node container, so an
// in-process lock (keyed by newsletter id) fully closes the window — no
// cross-process coordination (Redis, DB row lock) is needed.
const sendsInFlight = new Set<string>()

/** Load the doc (depth 2 so richText upload nodes are populated) and render
 *  it in the branded shell with site-settings branding. */
async function renderForSend(payload: Payload, id: string | number): Promise<{ doc: Newsletter; html: string } | null> {
  const doc = (await payload
    .findByID({ collection: 'newsletters', id, depth: 2, overrideAccess: true })
    .catch(() => null)) as Newsletter | null
  if (!doc) return null
  const settings = await payload.findGlobal({ slug: 'site-settings', depth: 1 })
  const logoUrl = settings.logo && typeof settings.logo === 'object' ? (settings.logo.url ?? null) : null
  const html = renderNewsletterHtml({
    body: doc.body as unknown as SerializedEditorState,
    baseUrl: process.env.PUBLIC_BASE_URL ?? '',
    studioName: settings.studioName ?? 'Portside Pottery',
    logoUrl,
  })
  return { doc, html }
}

/** Send a draft newsletter to the whole Kit list as a broadcast, then stamp it
 *  sent (status/sentAt/kitBroadcastId/recipientCount in a single update). */
export async function sendNewsletter(
  deps: NewsletterSendDeps,
  args: { id: string | number; now?: Date },
): Promise<SendNewsletterResult> {
  const now = args.now ?? new Date()
  const key = String(args.id)
  if (sendsInFlight.has(key)) {
    return { ok: false, status: 409, error: 'This newsletter is already being sent.' }
  }
  sendsInFlight.add(key)
  try {
    const rendered = await renderForSend(deps.payload, args.id)
    if (!rendered) return { ok: false, status: 404, error: 'Newsletter not found.' }
    const { doc, html } = rendered
    if (doc.status === 'sent' || doc.kitBroadcastId) {
      return { ok: false, status: 409, error: 'This newsletter has already been sent.' }
    }

    // Count is informational (confirm dialog / history) — never blocks a send.
    let recipientCount: number | null = null
    try {
      recipientCount = await deps.countSubscribers()
    } catch {
      recipientCount = null
    }

    let broadcastId: number
    try {
      const b = await deps.createBroadcast({ subject: doc.subject, contentHtml: html, sendAt: now })
      broadcastId = b.id
    } catch (e) {
      deps.payload.logger.error(`Newsletter ${doc.id} broadcast failed: ${e instanceof Error ? e.message : e}`)
      return { ok: false, status: 500, error: 'Kit rejected the broadcast — nothing was sent. Try again in a minute.' }
    }

    try {
      await deps.payload.update({
        collection: 'newsletters',
        id: doc.id,
        overrideAccess: true,
        data: { status: 'sent', sentAt: now.toISOString(), kitBroadcastId: String(broadcastId), recipientCount },
      })
    } catch (e) {
      // The broadcast IS out; losing the stamp must not report failure (a retry
      // would double-send). Log loudly for manual repair instead.
      deps.payload.logger.error(
        `CRITICAL: newsletter ${doc.id} sent as Kit broadcast ${broadcastId} but stamping failed — set status=sent manually. ${e instanceof Error ? e.message : e}`,
      )
    }
    return { ok: true, recipientCount }
  } finally {
    sendsInFlight.delete(key)
  }
}

/** Email the rendered newsletter to one address (the logged-in admin) for proofing. */
export async function sendNewsletterTest(
  deps: { payload: Payload; sendEmail: (input: EmailInput) => Promise<void> },
  args: { id: string | number; to: string },
): Promise<{ ok: true } | { ok: false; status: 404 | 500; error: string }> {
  const rendered = await renderForSend(deps.payload, args.id)
  if (!rendered) return { ok: false, status: 404, error: 'Newsletter not found.' }
  try {
    await deps.sendEmail({ to: args.to, subject: `[Test] ${rendered.doc.subject}`, html: rendered.html })
    return { ok: true }
  } catch (e) {
    deps.payload.logger.error(`Newsletter test-send failed: ${e instanceof Error ? e.message : e}`)
    return { ok: false, status: 500, error: 'The test email failed to send.' }
  }
}

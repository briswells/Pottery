import type { Payload } from 'payload'
import type { EmailInput } from '../lib/email'
import { getNotifyEmail } from '../lib/notify-email'

export interface ContactDeps {
  payload: Payload
  sendEmail: (input: EmailInput) => Promise<void>
}

export interface ContactInput {
  name: string
  email: string
  message: string
  /** Honeypot — real users never fill this; any value means a bot. */
  website?: string
  /** Client render timestamp (ms). Submits < MIN_FILL_MS later are bots. */
  startedAt?: number
}

export type ContactResult = { ok: true } | { ok: false; status: 400 | 500; error: string }

const MAX_MESSAGE_CHARS = 5000
const MIN_FILL_MS = 3000
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/**
 * Relay a contact-form message to the studio's notify address with Reply-To set
 * to the visitor. Nothing is stored. Honeypot/too-fast submissions return
 * success WITHOUT sending so bots get no signal.
 */
export async function submitContactMessage(deps: ContactDeps, input: ContactInput): Promise<ContactResult> {
  const name = (input.name ?? '').replace(/[\r\n\t\v\f  ]+/g, ' ').trim().slice(0, 200)
  const email = (input.email ?? '').trim()
  const message = (input.message ?? '').trim()

  // Silent bot drops FIRST (before validation, so bots can't probe the rules).
  if (input.website) return { ok: true }
  if (typeof input.startedAt === 'number' && Date.now() - input.startedAt < MIN_FILL_MS) return { ok: true }

  if (!name || !email || !message) return { ok: false, status: 400, error: 'Please fill in your name, email, and message.' }
  if (!EMAIL_SHAPE.test(email)) return { ok: false, status: 400, error: 'Please enter a valid email address.' }
  if (message.length > MAX_MESSAGE_CHARS) return { ok: false, status: 400, error: 'Message is too long.' }

  const to = await getNotifyEmail(deps.payload)
  const fallbackNote = to ? ` at ${to}` : ''
  if (!to) return { ok: false, status: 500, error: 'The contact form is unavailable right now — please email us directly.' }

  try {
    await deps.sendEmail({
      to,
      replyTo: email,
      subject: `New message from ${name} — website contact form`,
      html: `<p><strong>${escapeHtml(name)}</strong> (${escapeHtml(email)}) wrote:</p><p>${escapeHtml(message).replaceAll('\n', '<br/>')}</p>`,
    })
    return { ok: true }
  } catch (e) {
    console.error('Contact form send failed:', e)
    return { ok: false, status: 500, error: `We couldn't send your message — please email us directly${fallbackNote}.` }
  }
}

/**
 * Newsletter signups. Kit (ConvertKit) is the source of truth for the list —
 * this service only validates + bot-filters and forwards to the injected Kit
 * client. Bot defense mirrors services/contact.ts: honeypot + min fill time,
 * both returning silent success so bots get no signal.
 */

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

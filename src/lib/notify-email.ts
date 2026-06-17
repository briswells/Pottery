import type { Payload } from 'payload'

/**
 * The studio's notification / public-contact email — used for staff alerts
 * (firing requests, membership issues) and the public "contact" / "ask about
 * membership" links. The Site Settings "email" field is the source of truth;
 * STAFF_NOTIFY_EMAIL is only a fallback for when that field is left blank.
 */
export function resolveNotifyEmail(siteEmail?: string | null): string | undefined {
  return siteEmail || process.env.STAFF_NOTIFY_EMAIL || undefined
}

/** Async variant for server code that doesn't already have Site Settings loaded. */
export async function getNotifyEmail(payload: Payload): Promise<string | undefined> {
  let siteEmail: string | null | undefined
  try {
    siteEmail = (await payload.findGlobal({ slug: 'site-settings' }))?.email
  } catch {
    /* fall back to env below */
  }
  return resolveNotifyEmail(siteEmail)
}

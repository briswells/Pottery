import type { CollectionAfterChangeHook } from 'payload'
import { sendEmail } from '../lib/email'
import { getNotifyEmail } from '../lib/notify-email'
import type { FiringRequest } from '../payload-types'

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/**
 * Email the customer when their firing is marked Completed: pieces are ready
 * for pickup during normal business hours (hours pulled live from Site
 * Settings so staff edits there flow through). Fires once per transition into
 * "completed"; best-effort — an email failure never blocks the admin save.
 */
export const sendFiringCompletedEmail: CollectionAfterChangeHook<FiringRequest> = async ({
  doc,
  previousDoc,
  operation,
  req,
}) => {
  if (operation !== 'update') return doc
  if (doc.status !== 'completed' || previousDoc?.status === 'completed') return doc
  if (!doc.email) return doc

  try {
    const settings = await req.payload.findGlobal({ slug: 'site-settings' })
    const hours = (settings.hours ?? []).filter((h) => h.days || h.time)
    const hoursHtml =
      hours.length > 0
        ? `<ul>${hours.map((h) => `<li>${escapeHtml([h.days, h.time].filter(Boolean).join(': '))}</li>`).join('')}</ul>`
        : ''
    const studioName = settings.studioName ?? 'Portside Pottery'
    const replyTo = await getNotifyEmail(req.payload)

    await sendEmail({
      to: doc.email,
      ...(replyTo ? { replyTo } : {}),
      subject: 'Your firing is complete — ready for pickup',
      html: `<p>Good news, ${escapeHtml(doc.name ?? '')} — your Cone 10 firing is complete!</p>
<p>You can pick up your pieces at ${escapeHtml(studioName)} during normal business hours${hours.length > 0 ? ':' : '.'}</p>
${hoursHtml}
<p>See you soon!</p>`,
    })
  } catch (e) {
    console.error(`Firing-completed email failed for request ${doc.id}:`, e)
  }
  return doc
}

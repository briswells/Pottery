import type { CollectionAfterChangeHook } from 'payload'
import { sendEmail } from '../lib/email'
import { getNotifyEmail } from '../lib/notify-email'
import { getStudioInfo, escapeHtml } from '../lib/studio-info'
import type { FiringRequest } from '../payload-types'

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
    const studio = await getStudioInfo(req.payload)
    const replyTo = await getNotifyEmail(req.payload)

    await sendEmail({
      to: doc.email,
      ...(replyTo ? { replyTo } : {}),
      subject: 'Your firing is complete — ready for pickup',
      html: `<p>Good news, ${escapeHtml(doc.name ?? '')} — your Cone 10 firing is complete!</p>
<p>You can pick up your pieces at ${studio.studioName}${studio.addressHtml ? ` (${studio.addressHtml})` : ''} during normal business hours${studio.hoursHtml ? ':' : '.'}</p>
${studio.hoursHtml}
<p>See you soon!</p>`,
    })
  } catch (e) {
    console.error(`Firing-completed email failed for request ${doc.id}:`, e)
  }
  return doc
}

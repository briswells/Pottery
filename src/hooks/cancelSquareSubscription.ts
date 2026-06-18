import type { CollectionAfterChangeHook, Payload } from 'payload'
import { getSquareClient } from '../lib/square'
import { sendEmail } from '../lib/email'
import { formatDate } from '../lib/schedule'
import { getNotifyEmail } from '../lib/notify-email'
import type { Person } from '../payload-types'

/** Resolve a member's assigned shelf name for staff emails, or "none on file". */
export async function resolveShelfName(payload: Payload, shelfRef: number | { id?: number } | null | undefined): Promise<string> {
  const id = shelfRef == null ? null : typeof shelfRef === 'object' ? shelfRef.id ?? null : shelfRef
  if (!id) return 'none on file'
  try {
    const shelf = await payload.findByID({ collection: 'shelves', id, depth: 0, overrideAccess: true })
    return shelf?.name || 'none on file'
  } catch {
    return 'none on file'
  }
}

/** Email the studio when a member cancels: who, their shelf, and their last day. */
async function notifyStaffOfCancellation(member: Person, lastDay: string | null, to: string | undefined, shelf: string): Promise<void> {
  if (!to) return
  const lastDayText = lastDay ? formatDate(lastDay) : 'the end of the current billing period'
  try {
    await sendEmail({
      to,
      subject: `Membership cancelled: ${member.name}`,
      html: `<p>${member.name} (${member.email}) has cancelled their Portside Pottery membership.</p>
<p><strong>Shelf:</strong> ${shelf}<br/>
<strong>Last active day:</strong> ${lastDayText}</p>
<p>Their membership stays active until then and won't renew — you may want to reclaim the shelf after that date.</p>`,
    })
  } catch (e) {
    console.error(`Failed to send cancellation notice for member ${member.id}:`, e)
  }
}

/**
 * When a member is set to cancelled/paused in the admin or via the self-serve cancel
 * link, reflect it in Square. On cancellation, also notify staff with the member's
 * shelf and last active day (the period-end date Square returns on the cancel).
 */
export const cancelSquareSubscription: CollectionAfterChangeHook<Person> = async ({ doc, previousDoc, operation, req }) => {
  if (operation !== 'update') return doc
  // Skip when the change originated from a Square webhook — Square already knows;
  // propagating back would just be a redundant (and erroring) round-trip call.
  if (req?.context?.fromSquareWebhook) return doc
  const becameCancelled = doc.status === 'cancelled' && previousDoc?.status !== 'cancelled'
  const becamePaused = doc.status === 'paused' && previousDoc?.status !== 'paused'
  if (!doc.squareSubscriptionId || (!becameCancelled && !becamePaused)) return doc

  const client = getSquareClient()
  try {
    if (becamePaused) await client.subscriptions.pause({ subscriptionId: doc.squareSubscriptionId })
    if (becameCancelled) {
      const res = await client.subscriptions.cancel({ subscriptionId: doc.squareSubscriptionId })
      await notifyStaffOfCancellation(doc, res.subscription?.canceledDate ?? null, await getNotifyEmail(req.payload), await resolveShelfName(req.payload, doc.shelf))
    }
  } catch (e) {
    // Surface but don't crash the admin save; staff can retry.
    console.error('Failed to propagate membership status to Square:', e)
  }
  return doc
}

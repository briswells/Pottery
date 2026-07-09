import { getPayload } from 'payload'
import config from '@payload-config'
import { WebhooksHelper } from 'square'
import { sendEmail } from '../../../../lib/email'
import { getNotifyEmail } from '../../../../lib/notify-email'
import { syncSquarePlans } from '../../../../services/sync-square-plans'
import { squareMembershipGateway, type MembershipGateway } from '../../../../lib/membership-gateway'
import { ensureMemberFromSubscription, mapSubscriptionStatus, isInvoicePastDue, type SquareSubscriptionInput } from '../../../../services/square-member-sync'

export async function handleCatalogVersionUpdated(payload: Awaited<ReturnType<typeof getPayload>>) {
  await syncSquarePlans({ payload, gateway: squareMembershipGateway })
}

type AutoCreateDeps = { payload: Awaited<ReturnType<typeof getPayload>>; gateway: MembershipGateway }

/** Normalize a Square webhook subscription object (snake_case) to the service shape. */
function normalizeSubscription(raw: any): SquareSubscriptionInput | null {
  const id = raw?.id
  if (!id) return null
  return {
    id,
    customerId: raw.customer_id ?? raw.customerId,
    planVariationId: raw.plan_variation_id ?? raw.planVariationId,
    status: raw.status,
    startDate: raw.start_date ?? raw.startDate,
    canceledDate: raw.canceled_date ?? raw.canceledDate,
  }
}

/** subscription.created: build a member from the event's subscription object. */
export async function handleSubscriptionCreated(deps: AutoCreateDeps, rawSubscription: any) {
  const sub = normalizeSubscription(rawSubscription)
  if (!sub) return null
  return ensureMemberFromSubscription(deps, sub)
}

/** Safety net: resolve a subscription id via the gateway, then ensure the member. */
export async function ensureMemberForSubscriptionId(deps: AutoCreateDeps, subscriptionId: string | undefined) {
  if (!subscriptionId) return null
  const sub = await deps.gateway.getSubscription(subscriptionId)
  if (!sub) return null
  return ensureMemberFromSubscription(deps, sub)
}

export async function POST(req: Request) {
  const requestBody = await req.text() // raw body required for signature verification
  const signature = req.headers.get('x-square-hmacsha256-signature') ?? ''
  const notificationUrl = `${process.env.PUBLIC_BASE_URL}/api/webhooks/square`

  const isValid = await WebhooksHelper.verifySignature({
    requestBody,
    signatureHeader: signature,
    signatureKey: process.env.SQUARE_WEBHOOK_SIGNATURE_KEY!,
    notificationUrl,
  })
  if (!isValid) return new Response('Invalid signature', { status: 401 })

  const event = JSON.parse(requestBody)
  const payload = await getPayload({ config: await config })
  const deps = { payload, gateway: squareMembershipGateway }

  // Reconcile a booking's status from a Square event, keyed on the Square
  // payment id we stored at booking time. Idempotent: only writes on change.
  async function reconcileBooking(squarePaymentId: string | undefined, nextStatus: string | undefined) {
    if (!squarePaymentId || !nextStatus) return
    const { docs } = await payload.find({
      collection: 'bookings',
      where: { squarePaymentId: { equals: squarePaymentId } },
      limit: 1,
    })
    const booking = docs[0]
    if (!booking || booking.status === nextStatus) return
    await payload.update({
      collection: 'bookings',
      id: booking.id,
      overrideAccess: true,
      data: { status: nextStatus as typeof booking.status },
    })
  }

  async function findMemberBySubscription(subscriptionId: string | undefined) {
    if (!subscriptionId) return null
    const { docs } = await payload.find({ collection: 'people', where: { squareSubscriptionId: { equals: subscriptionId } }, limit: 1 })
    return docs[0] ?? null
  }

  if (event.type === 'payment.updated') {
    // A captured payment that gets voided lands in CANCELED; a failed capture in FAILED.
    const payment = event.data?.object?.payment
    const status: string | undefined = payment?.status // COMPLETED | FAILED | CANCELED | ...
    const map: Record<string, string> = { CANCELED: 'refunded', FAILED: 'cancelled' }
    await reconcileBooking(payment?.id, status ? map[status] : undefined)
  } else if (event.type === 'refund.updated' || event.type === 'refund.created') {
    // A dashboard/API refund leaves the payment COMPLETED and emits a refund.*
    // event instead, so mark the booking refunded once the refund completes.
    const refund = event.data?.object?.refund
    const status: string | undefined = refund?.status // PENDING | COMPLETED | REJECTED | FAILED
    await reconcileBooking(refund?.payment_id, status === 'COMPLETED' ? 'refunded' : undefined)
  } else if (event.type === 'invoice.payment_made') {
    const invoice = event.data?.object?.invoice
    // Square delivers webhook JSON in snake_case (we parse the raw body, not via
    // the SDK), so read subscription_id; fall back to camelCase just in case.
    const subscriptionId = invoice?.subscription_id ?? invoice?.subscriptionId
    let member = await findMemberBySubscription(subscriptionId)
    if (!member && subscriptionId) {
      try {
        member = await ensureMemberForSubscriptionId(deps, subscriptionId)
      } catch (e) {
        console.error('invoice.payment_made auto-create failed:', e)
      }
    }
    if (member) {
      await payload.update({ collection: 'people', id: member.id, overrideAccess: true, context: { fromSquareWebhook: true }, data: {
        status: 'active', subscriptionStatus: 'ACTIVE',
        lastPaymentDate: new Date().toISOString(), lastPaymentStatus: 'PAID',
      } })
      await payload.create({ collection: 'payments', overrideAccess: true, data: {
        type: 'membership', member: member.id, amountCents: 20000, // TODO: source from invoice if price changes
        squareId: invoice?.id ?? `inv-${subscriptionId ?? 'unknown'}`, status: 'PAID', paidAt: new Date().toISOString(),
      } })
    }
  } else if (event.type === 'invoice.updated') {
    const invoice = event.data?.object?.invoice
    const status: string | undefined = invoice?.status // UNPAID | PAYMENT_PENDING | CANCELED | ...
    const dueDate = invoice?.payment_requests?.[0]?.due_date ?? invoice?.payment_requests?.[0]?.dueDate
    const graceDays = Number(process.env.MEMBERSHIP_GRACE_DAYS ?? '3')
    // A freshly issued invoice is unpaid until its due date — only escalate to past_due
    // once it's genuinely overdue (due date + grace), so new members aren't told their
    // payment "failed" the moment the first invoice is created.
    if ((status === 'UNPAID' || status === 'PAYMENT_PENDING') && isInvoicePastDue(dueDate, graceDays, new Date())) {
      const subscriptionId = invoice?.subscription_id ?? invoice?.subscriptionId
      let member = await findMemberBySubscription(subscriptionId)
      if (!member && subscriptionId) {
        try {
          member = await ensureMemberForSubscriptionId(deps, subscriptionId)
        } catch (e) {
          console.error('invoice.updated auto-create failed:', e)
        }
      }
      if (member && member.status !== 'past_due') {
        await payload.update({ collection: 'people', id: member.id, overrideAccess: true, context: { fromSquareWebhook: true }, data: {
          status: 'past_due', lastPaymentStatus: 'FAILED',
        } })
        // Notify staff only — Square already emails the member about overdue
        // invoices, so a second member-facing email would be duplicative.
        // No automatic lockout (per design decision).
        const notifyTo = await getNotifyEmail(payload)
        if (notifyTo) {
          await sendEmail({ to: notifyTo, subject: `Membership payment failed: ${member.name}`,
            html: `<p>${member.name} (${member.email}) has a failed/overdue membership payment. Square will retry; follow up as needed.</p>` })
        }
      }
    }
  } else if (event.type === 'subscription.created') {
    try {
      await handleSubscriptionCreated(deps, event.data?.object?.subscription)
    } catch (e) {
      console.error('subscription.created auto-create failed:', e)
    }
  } else if (event.type === 'subscription.updated') {
    const sub = event.data?.object?.subscription
    let member = await findMemberBySubscription(sub?.id)
    if (!member && sub?.id) {
      try {
        member = await handleSubscriptionCreated(deps, sub)
      } catch (e) {
        console.error('subscription.updated auto-create failed:', e)
      }
    }
    if (member && sub?.status) {
      // Square keeps a sub ACTIVE until its scheduled cancel date, so a scheduled
      // cancellation arrives as ACTIVE with canceled_date set — treat that as cancelled.
      const canceledDate = sub.canceled_date ?? sub.canceledDate
      const nextStatus = mapSubscriptionStatus(sub.status, canceledDate) ?? member.status
      // Idempotent: only write when something actually changes (also avoids
      // needless churn through the People afterChange → Square hook).
      if (member.subscriptionStatus !== sub.status || member.status !== nextStatus) {
        await payload.update({ collection: 'people', id: member.id, overrideAccess: true, context: { fromSquareWebhook: true }, data: {
          subscriptionStatus: sub.status, status: nextStatus as typeof member.status,
        } })
      }
    }
  } else if (event.type === 'catalog.version.updated') {
    await handleCatalogVersionUpdated(payload)
  }

  return new Response('ok', { status: 200 })
}

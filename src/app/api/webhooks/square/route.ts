import { getPayload } from 'payload'
import config from '@payload-config'
import { WebhooksHelper } from 'square'
import { sendEmail } from '../../../../lib/email'
import { syncSquarePlans } from '../../../../services/sync-square-plans'
import { squareMembershipGateway } from '../../../../lib/membership-gateway'

export async function handleCatalogVersionUpdated(payload: Awaited<ReturnType<typeof getPayload>>) {
  await syncSquarePlans({ payload, gateway: squareMembershipGateway })
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
    const { docs } = await payload.find({ collection: 'members', where: { squareSubscriptionId: { equals: subscriptionId } }, limit: 1 })
    return docs[0] ?? null
  }

  async function findFiringByInvoiceId(invoiceId: string | undefined) {
    if (!invoiceId) return null
    const { docs } = await payload.find({ collection: 'firing-requests', where: { squareInvoiceId: { equals: invoiceId } }, limit: 1 })
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
    const member = await findMemberBySubscription(subscriptionId)
    if (member) {
      await payload.update({ collection: 'members', id: member.id, overrideAccess: true, context: { fromSquareWebhook: true }, data: {
        status: 'active', subscriptionStatus: 'ACTIVE',
        lastPaymentDate: new Date().toISOString(), lastPaymentStatus: 'PAID',
      } })
      await payload.create({ collection: 'payments', overrideAccess: true, data: {
        type: 'membership', member: member.id, amountCents: 20000, // TODO: source from invoice if price changes
        squareId: invoice?.id ?? `inv-${subscriptionId ?? 'unknown'}`, status: 'PAID', paidAt: new Date().toISOString(),
      } })
    } else {
      // No membership subscription → this may be a one-off firing invoice.
      const firing = await findFiringByInvoiceId(invoice?.id)
      if (firing && firing.status !== 'paid') {
        if (!firing.quotedPriceCents) {
          console.warn(`Firing ${firing.id} paid but has no quotedPriceCents; recording $0.`)
        }
        await payload.update({
          collection: 'firing-requests', id: firing.id, overrideAccess: true,
          context: { fromFiringHook: true },
          data: { status: 'paid', paidAt: new Date().toISOString() },
        })
        await payload.create({
          collection: 'payments', overrideAccess: true, data: {
            type: 'firing', firingRequest: firing.id,
            amountCents: firing.quotedPriceCents ?? 0,
            squareId: invoice?.id ?? `firing-inv-${firing.id}`,
            status: 'PAID', paidAt: new Date().toISOString(),
          },
        })
      }
    }
  } else if (event.type === 'invoice.updated') {
    const invoice = event.data?.object?.invoice
    const status: string | undefined = invoice?.status // UNPAID | PAYMENT_PENDING | CANCELED | ...
    if (status === 'UNPAID' || status === 'PAYMENT_PENDING') {
      const subscriptionId = invoice?.subscription_id ?? invoice?.subscriptionId
      const member = await findMemberBySubscription(subscriptionId)
      if (member && member.status !== 'past_due') {
        await payload.update({ collection: 'members', id: member.id, overrideAccess: true, context: { fromSquareWebhook: true }, data: {
          status: 'past_due', lastPaymentStatus: 'FAILED',
        } })
        // Notify staff + member; no automatic lockout (per design decision).
        await sendEmail({ to: process.env.STAFF_NOTIFY_EMAIL!, subject: `Membership payment failed: ${member.name}`,
          html: `<p>${member.name} (${member.email}) has a failed/overdue membership payment. Square will retry; follow up as needed.</p>` })
        await sendEmail({ to: member.email, subject: 'Your Portside Pottery payment needs attention',
          html: `<p>Hi ${member.name}, we couldn't process your latest membership payment. Please update your card or contact the studio. Your access is unchanged for now.</p>` })
      }
    }
  } else if (event.type === 'subscription.updated') {
    const sub = event.data?.object?.subscription
    const member = await findMemberBySubscription(sub?.id)
    if (member && sub?.status) {
      const map: Record<string, string> = { ACTIVE: 'active', PAUSED: 'paused', CANCELED: 'cancelled', DEACTIVATED: 'cancelled' }
      const nextStatus = map[sub.status] ?? member.status
      // Idempotent: only write when something actually changes (also avoids
      // needless churn through the Members afterChange → Square hook).
      if (member.subscriptionStatus !== sub.status || member.status !== nextStatus) {
        await payload.update({ collection: 'members', id: member.id, overrideAccess: true, context: { fromSquareWebhook: true }, data: {
          subscriptionStatus: sub.status, status: nextStatus as typeof member.status,
        } })
      }
    }
  } else if (event.type === 'catalog.version.updated') {
    await handleCatalogVersionUpdated(payload)
  }

  return new Response('ok', { status: 200 })
}

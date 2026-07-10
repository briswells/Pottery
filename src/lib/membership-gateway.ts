import { randomUUID } from 'crypto'
import { getSquareClient, SQUARE_LOCATION_ID } from './square'

export interface MembershipGateway {
  createCustomer(input: { name: string; email: string; phone?: string }): Promise<{ customerId: string }>
  saveCard(input: { customerId: string; sourceId: string }): Promise<{ cardId: string }>
  createSubscription(input: {
    customerId: string
    planVariationId: string
    cardId?: string
  }): Promise<{ subscriptionId: string; status: string }>
  cancelSubscription(subscriptionId: string): Promise<void>
  listPlanVariations(): Promise<
    Array<{ variationId: string; planName: string; variationName?: string; priceCents?: number; cadence?: string }>
  >
  getSubscription(subscriptionId: string): Promise<{
    id: string; customerId?: string; planVariationId?: string; status?: string; startDate?: string
  } | null>
  getCustomer(customerId: string): Promise<{
    id: string; email?: string; givenName?: string; familyName?: string; phone?: string
  } | null>
  /** Read-only. Paginates internally. customerId narrows to one customer (used by the webhook branch). */
  listInvoices(args?: { customerId?: string }): Promise<MemberInvoice[]>
}

export interface MemberInvoice {
  customerId?: string
  email?: string
  givenName?: string
  familyName?: string
  title?: string
  status?: string // SCHEDULED | UNPAID | PAID | CANCELED | REFUNDED | ...
  dueDate?: string // payment_requests[0].due_date
  createdAt?: string
}

// NOTE: the customer → card → subscription sequence has no rollback. A failure
// partway through leaves the earlier objects (customer, card) orphaned in Square.
// Acceptable for now (idempotency keys make retries safe and sandbox orphans are
// free); revisit with cleanup/reconciliation if it ever matters in production.
export const squareMembershipGateway: MembershipGateway = {
  async createCustomer({ name, email, phone }) {
    const client = getSquareClient()
    const res = await client.customers.create({
      idempotencyKey: randomUUID(),
      givenName: name,
      emailAddress: email,
      phoneNumber: phone,
    })
    const id = res.customer?.id
    if (!id) throw new Error('Square customer was not created')
    return { customerId: id }
  },

  async saveCard({ customerId, sourceId }) {
    const client = getSquareClient()
    const res = await client.cards.create({
      idempotencyKey: randomUUID(),
      sourceId,
      card: { customerId },
    })
    const id = res.card?.id
    if (!id) throw new Error('Square card was not saved')
    return { cardId: id }
  },

  async createSubscription({ customerId, planVariationId, cardId }) {
    const client = getSquareClient()
    const res = await client.subscriptions.create({
      idempotencyKey: randomUUID(),
      locationId: SQUARE_LOCATION_ID(),
      planVariationId,
      customerId,
      // Cardless → Square emails the member an invoice each period (auto-pay opt-in).
      ...(cardId ? { cardId } : {}),
    })
    const sub = res.subscription
    if (!sub?.id) throw new Error('Square subscription was not created')
    return { subscriptionId: sub.id, status: sub.status ?? 'ACTIVE' }
  },

  async cancelSubscription(subscriptionId) {
    const client = getSquareClient()
    await client.subscriptions.cancel({ subscriptionId })
  },

  async getSubscription(subscriptionId) {
    const client = getSquareClient()
    const res = await client.subscriptions.get({ subscriptionId })
    const s = res.subscription
    if (!s?.id) return null
    return {
      id: s.id,
      customerId: s.customerId ?? undefined,
      planVariationId: s.planVariationId ?? undefined,
      status: s.status ?? undefined,
      startDate: s.startDate ?? undefined,
    }
  },

  async getCustomer(customerId) {
    const client = getSquareClient()
    const res = await client.customers.get({ customerId })
    const c = res.customer
    if (!c?.id) return null
    return { id: c.id, email: c.emailAddress ?? undefined, givenName: c.givenName ?? undefined, familyName: c.familyName ?? undefined, phone: c.phoneNumber ?? undefined }
  },

  async listPlanVariations() {
    const client = getSquareClient()
    const res: any = await client.catalog.list({ types: 'SUBSCRIPTION_PLAN,SUBSCRIPTION_PLAN_VARIATION' })
    const objects: any[] = []
    if (res && typeof res[Symbol.asyncIterator] === 'function') {
      for await (const o of res) objects.push(o)
    } else if (Array.isArray(res?.data)) objects.push(...res.data)
    else if (Array.isArray(res?.objects)) objects.push(...res.objects)
    else if (Array.isArray(res)) objects.push(...res)

    // Square returns plan variations NESTED inside each SUBSCRIPTION_PLAN's
    // subscriptionPlanData.subscriptionPlanVariations. They may ALSO appear as
    // top-level SUBSCRIPTION_PLAN_VARIATION objects. Collect from both, dedupe by
    // id. (A top-level-only parser misses real plans entirely — they come nested.)
    const planName = new Map<string, string>()
    const variations = new Map<string, any>()
    for (const o of objects) {
      if (o.type === 'SUBSCRIPTION_PLAN') {
        planName.set(o.id, o.subscriptionPlanData?.name ?? '(unnamed plan)')
        for (const v of o.subscriptionPlanData?.subscriptionPlanVariations ?? []) {
          if (v?.id) variations.set(v.id, v)
        }
      } else if (o.type === 'SUBSCRIPTION_PLAN_VARIATION') {
        variations.set(o.id, o)
      }
    }

    return [...variations.values()].map((v) => {
      const d = v.subscriptionPlanVariationData
      const phase = d?.phases?.[0]
      // Price field name varies across API/SDK versions: pricing.price (current
      // raw shape), pricing.priceMoney, or a legacy recurringPriceMoney.
      const money = phase?.pricing?.price ?? phase?.pricing?.priceMoney ?? phase?.recurringPriceMoney
      const amount = money?.amount
      return {
        variationId: v.id as string,
        planName: planName.get(d?.subscriptionPlanId) ?? '(unknown plan)',
        variationName: d?.name as string | undefined,
        priceCents: amount != null ? Number(amount) : undefined,
        cadence: phase?.cadence as string | undefined,
      }
    })
  },

  async listInvoices({ customerId } = {}) {
    const client = getSquareClient()
    const invoices: MemberInvoice[] = []
    let cursor: string | undefined

    do {
      const res = await client.invoices.search({
        cursor,
        query: {
          filter: {
            locationIds: [SQUARE_LOCATION_ID()],
            ...(customerId ? { customerIds: [customerId] } : {}),
          },
        },
      })
      for (const inv of res.invoices ?? []) {
        const recipient = inv.primaryRecipient
        invoices.push({
          customerId: recipient?.customerId ?? undefined,
          email: recipient?.emailAddress ?? undefined,
          givenName: recipient?.givenName ?? undefined,
          familyName: recipient?.familyName ?? undefined,
          title: inv.title ?? undefined,
          status: inv.status ?? undefined,
          dueDate: inv.paymentRequests?.[0]?.dueDate ?? undefined,
          createdAt: inv.createdAt ?? undefined,
        })
      }
      cursor = res.cursor ?? undefined
    } while (cursor)

    return invoices
  },
}

import { randomUUID } from 'crypto'
import { getSquareClient, SQUARE_LOCATION_ID } from './square'

export interface MembershipGateway {
  createCustomer(input: { name: string; email: string; phone?: string }): Promise<{ customerId: string }>
  saveCard(input: { customerId: string; sourceId: string }): Promise<{ cardId: string }>
  createSubscription(input: { customerId: string; cardId: string }): Promise<{ subscriptionId: string; status: string }>
}

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

  async createSubscription({ customerId, cardId }) {
    const client = getSquareClient()
    const res = await client.subscriptions.create({
      idempotencyKey: randomUUID(),
      locationId: SQUARE_LOCATION_ID(),
      planVariationId: process.env.SQUARE_MEMBERSHIP_PLAN_VARIATION_ID!,
      customerId,
      cardId,
    })
    const sub = res.subscription
    if (!sub?.id) throw new Error('Square subscription was not created')
    return { subscriptionId: sub.id, status: sub.status ?? 'ACTIVE' }
  },
}

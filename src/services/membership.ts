import { randomBytes } from 'crypto'
import type { Payload } from 'payload'
import type { MembershipGateway } from '../lib/membership-gateway'
import type { EmailInput } from '../lib/email'

export interface MembershipDeps {
  payload: Payload
  gateway: MembershipGateway
  sendEmail: (input: EmailInput) => Promise<void>
}

export interface MembershipInput {
  name: string
  email: string
  phone?: string
  sourceId: string
  password?: string // optional now; member sets/uses it when the portal launches
}

export async function createMembership(deps: MembershipDeps, input: MembershipInput) {
  const { payload, gateway } = deps

  // Square side first — if any step throws, no Member row is written.
  const { customerId } = await gateway.createCustomer({ name: input.name, email: input.email, phone: input.phone })
  const { cardId } = await gateway.saveCard({ customerId, sourceId: input.sourceId })
  const { subscriptionId, status } = await gateway.createSubscription({ customerId, cardId })

  const member = await payload.create({
    collection: 'members',
    overrideAccess: true,
    data: {
      name: input.name,
      email: input.email,
      password: input.password ?? randomPassword(),
      phone: input.phone,
      status: 'active',
      joinedDate: new Date().toISOString(),
      squareCustomerId: customerId,
      squareSubscriptionId: subscriptionId,
      subscriptionStatus: status,
    },
  })

  await deps.sendEmail({
    to: input.email,
    subject: 'Welcome to Portside Pottery',
    html: `<p>Welcome, ${input.name}! Your $200/month studio membership is active. Stop by and we'll get you set up with a shelf.</p>`,
  })

  return member
}

function randomPassword(): string {
  // Members don't log in yet; a strong placeholder password satisfies the auth collection.
  return randomBytes(24).toString('hex')
}

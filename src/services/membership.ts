import type { Payload, PayloadRequest } from 'payload'
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
  planVariationId: string
}

export async function createMembership(deps: MembershipDeps, input: MembershipInput) {
  const { payload, gateway } = deps

  // Square side first — if any step throws, no Member row is written.
  const { customerId } = await gateway.createCustomer({ name: input.name, email: input.email, phone: input.phone })
  const { cardId } = await gateway.saveCard({ customerId, sourceId: input.sourceId })
  const { subscriptionId, status } = await gateway.createSubscription({ customerId, cardId, planVariationId: input.planVariationId })

  const member = await payload.create({
    collection: 'members',
    overrideAccess: true,
    data: {
      name: input.name,
      email: input.email,
      phone: input.phone,
      status: 'active',
      joinedDate: new Date().toISOString(),
      squareCustomerId: customerId,
      squareSubscriptionId: subscriptionId,
      subscriptionStatus: status,
    },
  })

  // The member is already created and their subscription is live at this point.
  // A failed welcome email must NOT fail the signup (and make the client think
  // it didn't work), so swallow+log email errors rather than letting them propagate.
  try {
    await deps.sendEmail({
      to: input.email,
      subject: 'Welcome to Portside Pottery',
      // TODO: $200/mo is hardcoded here; source it from the membership plan if the price ever changes.
      html: `<p>Welcome, ${input.name}! Your $200/month studio membership is active. Stop by and we'll get you set up with a shelf.</p>`,
    })
  } catch (e) {
    console.error(`Member ${member.id} welcome email failed:`, e)
  }

  return member
}

/** A short, human-readable reason from a Square SDK error, for the admin to see. */
function squareErrorReason(e: unknown): string {
  const anyErr = e as { errors?: Array<{ detail?: string }>; message?: string }
  const detail = anyErr?.errors?.[0]?.detail ?? anyErr?.message ?? String(e)
  return detail.slice(0, 200)
}

export interface ReconcileDeps {
  payload: Payload
  gateway: MembershipGateway
  req?: PayloadRequest // thread the hook's req so write-backs join the save transaction
}

type MemberSnapshot = {
  id: string | number
  name: string
  email: string
  phone?: string | null
  plan?: string | number | { id: string | number } | null
  squareCustomerId?: string | null
  squareSubscriptionId?: string | null
}

const planId = (p: MemberSnapshot['plan']): string | number | null =>
  p == null ? null : typeof p === 'object' ? p.id : p

/**
 * Reconcile a member's Square subscription to match their assigned plan.
 * Free → no subscription (cancel any existing). Square → ensure a cardless
 * subscription on the plan's variation (swap if the plan changed). Reuses the
 * member's existing Square customer. All write-backs thread `req`.
 */
export async function reconcileMemberPlan(
  deps: ReconcileDeps,
  args: { member: MemberSnapshot; previousDoc?: { plan?: MemberSnapshot['plan'] } | undefined },
): Promise<void> {
  const { payload, gateway, req } = deps
  const { member, previousDoc } = args

  const write = (data: Record<string, unknown>) =>
    payload.update({ collection: 'members', id: member.id, overrideAccess: true, req, context: { fromMemberHook: true }, data })

  const currentPlanId = planId(member.plan)
  if (!currentPlanId) return

  const plan: any = await payload.findByID({ collection: 'membership-plans', id: currentPlanId, req, overrideAccess: true })
  if (!plan) return

  try {
    if (plan.kind === 'free') {
      if (member.squareSubscriptionId) await gateway.cancelSubscription(member.squareSubscriptionId)
      await write({ squareSubscriptionId: null, subscriptionStatus: 'FREE' })
      return
    }

    const planVariationId: string | undefined = plan.squarePlanVariationId
    if (!planVariationId) {
      await write({ subscriptionStatus: 'NOT_CONFIGURED' })
      return
    }

    const planChanged = planId(previousDoc?.plan) !== currentPlanId
    if (member.squareSubscriptionId && !planChanged) return

    if (member.squareSubscriptionId && planChanged) {
      await gateway.cancelSubscription(member.squareSubscriptionId)
    }

    const customerId =
      member.squareCustomerId ??
      (await gateway.createCustomer({ name: member.name, email: member.email, phone: member.phone ?? undefined })).customerId
    const { subscriptionId, status } = await gateway.createSubscription({ customerId, planVariationId })
    await write({ squareCustomerId: customerId, squareSubscriptionId: subscriptionId, subscriptionStatus: status })
  } catch (e) {
    console.error(`Member ${member.id} plan reconcile failed:`, e)
    await write({ subscriptionStatus: `SETUP_FAILED: ${squareErrorReason(e)}`.slice(0, 240) })
  }
}

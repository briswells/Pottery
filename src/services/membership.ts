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

export interface ProvisionDeps {
  payload: Payload
  gateway: MembershipGateway
  // Thread the triggering hook's req so the write-back JOINS its transaction
  // instead of deadlocking on the row lock the parent save holds.
  req?: PayloadRequest
}

/**
 * Provision Square for a member that already exists in Payload (admin-created):
 * create a customer + cardless subscription (Square emails an invoice with an
 * auto-pay opt-in), then attach the Square ids to the member.
 */
/** True only when a real Square plan variation id is configured (not unset/placeholder). */
function membershipPlanConfigured(): boolean {
  const v = process.env.SQUARE_MEMBERSHIP_PLAN_VARIATION_ID
  return !!v && !v.startsWith('replace-with')
}

/** A short, human-readable reason from a Square SDK error, for the admin to see. */
function squareErrorReason(e: unknown): string {
  const anyErr = e as { errors?: Array<{ detail?: string }>; message?: string }
  const detail = anyErr?.errors?.[0]?.detail ?? anyErr?.message ?? String(e)
  return detail.slice(0, 200)
}

export async function provisionMemberSubscription(
  deps: ProvisionDeps,
  member: { id: string | number; name: string; email: string; phone?: string | null },
): Promise<void> {
  const { payload, gateway, req } = deps

  const writeStatus = (subscriptionStatus: string) =>
    payload.update({
      collection: 'members',
      id: member.id,
      overrideAccess: true,
      req,
      context: { fromMemberHook: true },
      data: { subscriptionStatus },
    })

  // No usable plan id → don't make a doomed Square call (and don't create an
  // orphan customer). Record a clear status so staff know it's a config gap.
  if (!membershipPlanConfigured()) {
    console.error(
      `Member ${member.id}: SQUARE_MEMBERSHIP_PLAN_VARIATION_ID is unset/placeholder — skipping Square provisioning.`,
    )
    await writeStatus('NOT_CONFIGURED')
    return
  }

  try {
    const { customerId } = await gateway.createCustomer({
      name: member.name,
      email: member.email,
      phone: member.phone ?? undefined,
    })
    // TODO: removed in reconcile task
    const { subscriptionId, status } = await gateway.createSubscription({
      customerId,
      planVariationId: process.env.SQUARE_MEMBERSHIP_PLAN_VARIATION_ID ?? '',
    })
    await payload.update({
      collection: 'members',
      id: member.id,
      overrideAccess: true,
      req,
      context: { fromMemberHook: true },
      data: { squareCustomerId: customerId, squareSubscriptionId: subscriptionId, subscriptionStatus: status },
    })
  } catch (e) {
    console.error(`Member ${member.id} Square provisioning failed:`, e)
    // Surface the real reason in the admin (e.g. "plan ID does not match…")
    // instead of a bare SETUP_FAILED. Reuses the existing field — no migration.
    await writeStatus(`SETUP_FAILED: ${squareErrorReason(e)}`.slice(0, 240))
  }
}

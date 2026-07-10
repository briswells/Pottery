import type { Payload } from 'payload'
import type { MembershipGateway, MemberInvoice } from '../lib/membership-gateway'
import { ensureInvoicedPlan } from './sync-square-plans'
import { upsertPersonByEmail } from './people'
import { isInvoicePastDue } from './square-member-sync'

export interface ReconcileInvoiceMembersDeps {
  payload: Payload
  gateway: MembershipGateway
}

/** Invoice title match for "this is a membership invoice" (vs. a one-off like a kiln repair). */
export const MEMBERSHIP_TITLE = /membership/i

/**
 * Days an unpaid membership invoice may sit past its due date before we treat the
 * member as past due. Same env var + default as the Square webhook branch
 * (`isInvoicePastDue` caller in `app/api/webhooks/square/route.ts`) — keep in sync.
 */
function membershipGraceDays(): number {
  return Number(process.env.MEMBERSHIP_GRACE_DAYS ?? '3')
}

/**
 * Derive a member's status from their MEMBERSHIP invoices only. Square represents an
 * ongoing invoice-billed membership as a recurring SCHEDULED invoice; once that stops
 * being scheduled (the series was cancelled/not renewed), the member is cancelled
 * regardless of any older unpaid invoices left over from while it was still active.
 */
export function deriveInvoiceMemberStatus(
  invoices: MemberInvoice[],
  graceDays: number,
  now: Date,
): 'active' | 'past_due' | 'cancelled' {
  const hasScheduled = invoices.some((i) => i.status === 'SCHEDULED')
  if (!hasScheduled) return 'cancelled'
  const hasOverdueUnpaid = invoices.some(
    (i) => i.status === 'UNPAID' && isInvoicePastDue(i.dueDate, graceDays, now),
  )
  if (hasOverdueUnpaid) return 'past_due'
  return 'active'
}

export interface InvoiceReconcileResult {
  processed: number
  active: number
  pastDue: number
  cancelled: number
  skipped: number
  failed: number
}

interface CustomerGroup {
  customerId: string
  email: string
  givenName?: string
  familyName?: string
  invoices: MemberInvoice[]
}

/** Group membership invoices by customer. Invoices missing a customerId or email can't be reconciled. */
function groupByCustomer(invoices: MemberInvoice[]): { groups: CustomerGroup[]; skipped: number } {
  const groups = new Map<string, CustomerGroup>()
  let skipped = 0
  const warned = new Set<string>()

  for (const inv of invoices) {
    if (!inv.customerId || !inv.email) {
      skipped++
      const key = inv.customerId ?? '(no customer id)'
      if (!warned.has(key)) {
        warned.add(key)
        console.warn(`Membership invoice reconcile: customer ${key} skipped: missing customerId or email.`)
      }
      continue
    }
    let group = groups.get(inv.customerId)
    if (!group) {
      group = { customerId: inv.customerId, email: inv.email, givenName: inv.givenName, familyName: inv.familyName, invoices: [] }
      groups.set(inv.customerId, group)
    }
    group.invoices.push(inv)
  }

  return { groups: [...groups.values()], skipped }
}

/**
 * Apply one customer's membership invoices to a Person. Shared by both entry points
 * so the webhook (one-customer) branch and the bulk reconcile stay identical.
 * Returns the resulting status, or null if the customer was skipped (an existing
 * Square-subscription member — never touched by the invoice path).
 */
async function applyInvoiceMember(
  { payload }: ReconcileInvoiceMembersDeps,
  planId: number,
  group: CustomerGroup,
): Promise<'active' | 'past_due' | 'cancelled' | null> {
  const { docs } = await payload.find({
    collection: 'people',
    where: { email: { equals: group.email.trim().toLowerCase() } },
    limit: 1,
    overrideAccess: true,
  })
  const existing = docs[0]
  // A Square-subscription member is managed entirely by the subscription path —
  // never let an invoice (e.g. a stray one-off) touch their record.
  if (existing?.squareSubscriptionId) return null

  const name = [group.givenName, group.familyName].filter(Boolean).join(' ') || 'Imported Member'
  const person = await upsertPersonByEmail({ payload }, { name, email: group.email, squareCustomerId: group.customerId })

  const status = deriveInvoiceMemberStatus(group.invoices, membershipGraceDays(), new Date())
  const earliestCreatedAt = group.invoices
    .map((i) => i.createdAt)
    .filter((d): d is string => Boolean(d))
    .sort()[0]

  const patch: Record<string, unknown> = {}
  if (person.status !== status) patch.status = status
  if (person.squareCustomerId !== group.customerId) patch.squareCustomerId = group.customerId
  // Never replace a DIFFERENT existing plan — only set the invoiced plan when the
  // person has none yet (idempotent re-run: already-invoiced plan needs no patch).
  const currentPlanId = typeof person.plan === 'object' && person.plan ? person.plan.id : person.plan
  if (currentPlanId == null) patch.plan = planId
  if (!person.joinedDate && earliestCreatedAt) patch.joinedDate = earliestCreatedAt

  if (Object.keys(patch).length > 0) {
    await payload.update({
      collection: 'people',
      id: person.id,
      overrideAccess: true,
      context: { fromSquareWebhook: true },
      data: patch,
    })
  }

  return status
}

/**
 * Reconcile invoice-billed members against Square invoices at our location.
 * Read-only against Square (never creates/sends invoices) — this only mirrors
 * their state into People. Fetches every invoice, keeps membership-titled ones,
 * groups by customer, and syncs each into a Person. Idempotent: only writes on
 * change, and never touches a person already managed by a Square subscription.
 */
export async function reconcileInvoiceMembers(
  deps: ReconcileInvoiceMembersDeps,
): Promise<InvoiceReconcileResult> {
  const { payload, gateway } = deps
  const result: InvoiceReconcileResult = { processed: 0, active: 0, pastDue: 0, cancelled: 0, skipped: 0, failed: 0 }

  const all = await gateway.listInvoices()
  const membershipInvoices = all.filter((i) => MEMBERSHIP_TITLE.test(i.title ?? ''))
  const { groups, skipped } = groupByCustomer(membershipInvoices)
  result.skipped += skipped

  const planId = await ensureInvoicedPlan(payload)

  for (const group of groups) {
    try {
      const status = await applyInvoiceMember(deps, planId, group)
      if (status == null) {
        result.skipped++
        continue
      }
      result.processed++
      if (status === 'active') result.active++
      else if (status === 'past_due') result.pastDue++
      else result.cancelled++
    } catch (e) {
      result.failed++
      payload.logger.error(
        `Invoice member reconcile: customer ${group.customerId} failed: ${e instanceof Error ? e.message : e}`,
      )
    }
  }

  return result
}

/**
 * One-customer variant for the invoice webhook branch. Fetches just this customer's
 * invoices (narrowed gateway-side) and applies the same path as the bulk reconcile.
 * Does nothing if the customer has no membership invoices at all.
 */
export async function reconcileOneInvoiceMember(
  deps: ReconcileInvoiceMembersDeps,
  customerId: string,
): Promise<void> {
  const invoices = await deps.gateway.listInvoices({ customerId })
  const membershipInvoices = invoices.filter((i) => MEMBERSHIP_TITLE.test(i.title ?? ''))
  if (membershipInvoices.length === 0) return

  const { groups } = groupByCustomer(membershipInvoices)
  const group = groups[0]
  if (!group) return

  const planId = await ensureInvoicedPlan(deps.payload)
  await applyInvoiceMember(deps, planId, group)
}

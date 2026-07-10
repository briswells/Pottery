import type { Payload } from 'payload'
import type { MembershipGateway } from '../lib/membership-gateway'

export interface SyncPlansDeps {
  payload: Payload
  gateway: MembershipGateway
}

/**
 * Upsert a membership-plans record per Square subscription plan variation, and
 * deactivate `square` plans whose variation no longer exists in Square. Never
 * touches `free` plans. Idempotent; safe to run repeatedly.
 */
export async function syncSquarePlans({ payload, gateway }: SyncPlansDeps): Promise<void> {
  const variations = await gateway.listPlanVariations()
  const seen = new Set<string>()

  for (const v of variations) {
    seen.add(v.variationId)
    const data = {
      name: v.variationName ? `${v.planName} — ${v.variationName}` : v.planName,
      kind: 'square' as const,
      squarePlanVariationId: v.variationId,
      priceCents: v.priceCents,
      cadence: v.cadence,
      active: true,
    }
    const { docs } = await payload.find({
      collection: 'membership-plans',
      where: { squarePlanVariationId: { equals: v.variationId } },
      limit: 1,
      overrideAccess: true,
    })
    if (docs[0]) {
      await payload.update({ collection: 'membership-plans', id: docs[0].id, overrideAccess: true, context: { fromPlanSync: true }, data })
    } else {
      await payload.create({ collection: 'membership-plans', overrideAccess: true, context: { fromPlanSync: true }, data })
    }
  }

  const { docs: squarePlans } = await payload.find({
    collection: 'membership-plans',
    where: { kind: { equals: 'square' } },
    limit: 1000,
    overrideAccess: true,
  })
  for (const p of squarePlans) {
    if (!seen.has(p.squarePlanVariationId ?? '') && p.active !== false) {
      await payload.update({ collection: 'membership-plans', id: p.id, overrideAccess: true, context: { fromPlanSync: true }, data: { active: false } })
    }
  }
}

/**
 * Ensure a platform "Free" plan exists so staff can assign unbilled members
 * out of the box (no manual creation, no Square). Idempotent — creates one only
 * if no `free` plan exists yet.
 */
export async function ensureFreePlan(payload: Payload): Promise<void> {
  const { docs } = await payload.find({
    collection: 'membership-plans',
    where: { kind: { equals: 'free' } },
    limit: 1,
    overrideAccess: true,
  })
  if (docs.length > 0) return
  await payload.create({
    collection: 'membership-plans',
    overrideAccess: true,
    context: { fromPlanSync: true },
    data: { name: 'Free', kind: 'free', active: true },
  })
}

export const INVOICED_PLAN_NAME = 'Membership (invoiced)'

/**
 * Ensure a platform "Membership (invoiced)" plan exists for members billed via
 * manually-sent Square invoices rather than a Square subscription. Idempotent —
 * find-or-create by name, returns the plan id either way.
 */
export async function ensureInvoicedPlan(payload: Payload): Promise<number> {
  const { docs } = await payload.find({
    collection: 'membership-plans',
    where: { name: { equals: INVOICED_PLAN_NAME }, kind: { equals: 'free' } },
    limit: 1,
    overrideAccess: true,
  })
  if (docs[0]) return docs[0].id
  const created = await payload.create({
    collection: 'membership-plans',
    overrideAccess: true,
    context: { fromPlanSync: true },
    data: { name: INVOICED_PLAN_NAME, kind: 'free', active: true },
  })
  return created.id
}

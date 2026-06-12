import type { Payload, PayloadRequest } from 'payload'
import type { Person } from '../payload-types'

export interface UpsertPersonDeps {
  payload: Payload
  req?: PayloadRequest
}

export interface UpsertPersonInput {
  name: string
  email: string
  phone?: string | null
  squareCustomerId?: string | null
}

/**
 * Find-or-create a Person keyed on lowercased email. New people are non-members
 * (status 'none', no plan). On a match, fill only empty fields — never clobber
 * data already on the record. Safe re: Square: a planless person doesn't trigger
 * the reconcile hook, and an enrich update never changes status or plan.
 */
export async function upsertPersonByEmail(
  { payload, req }: UpsertPersonDeps,
  input: UpsertPersonInput,
): Promise<Person> {
  const email = input.email.trim().toLowerCase()

  const { docs } = await payload.find({
    collection: 'people',
    where: { email: { equals: email } },
    limit: 1,
    overrideAccess: true,
    req,
  })

  const existing = docs[0] as Person | undefined
  if (existing) {
    const patch: Record<string, unknown> = {}
    if (!existing.phone && input.phone) patch.phone = input.phone
    if (!existing.squareCustomerId && input.squareCustomerId) patch.squareCustomerId = input.squareCustomerId
    if (Object.keys(patch).length === 0) return existing
    return (await payload.update({
      collection: 'people',
      id: existing.id,
      overrideAccess: true,
      req,
      data: patch,
    })) as Person
  }

  return (await payload.create({
    collection: 'people',
    overrideAccess: true,
    req,
    data: {
      name: input.name,
      email,
      phone: input.phone ?? undefined,
      status: 'none',
      squareCustomerId: input.squareCustomerId ?? undefined,
    },
  })) as Person
}

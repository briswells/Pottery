import type { Payload, CollectionSlug, TextFieldSingleValidation } from 'payload'

/**
 * Whether another document in `collection` already uses this `name` (case-sensitive,
 * matching the DB unique constraint). Excludes the current document on update.
 */
export async function nameTaken(
  payload: Payload,
  collection: CollectionSlug,
  name: string,
  id?: string | number,
): Promise<boolean> {
  const { totalDocs } = await payload.find({
    collection,
    where: { and: [{ name: { equals: name } }, ...(id != null ? [{ id: { not_equals: id } }] : [])] },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  return totalDocs > 0
}

/**
 * A `name` field validator that returns a friendly "already exists" message on a
 * duplicate (instead of the generic unique-constraint error). `noun` names the
 * record type in the message, e.g. uniqueNameValidate('shelves', 'shelf').
 */
export function uniqueNameValidate(collection: CollectionSlug, noun: string): TextFieldSingleValidation {
  return async (value, { req, id }) => {
    if (!value || typeof value !== 'string') return true
    return (await nameTaken(req.payload, collection, value, id))
      ? `A ${noun} with that name already exists.`
      : true
  }
}

import type { Payload, CollectionSlug, TextFieldSingleValidation } from 'payload'

/** Whether another document in `collection` already uses `value` in `field`
 *  (case-sensitive, matching the DB unique constraint). Excludes `id` on update. */
export async function fieldTaken(
  payload: Payload,
  collection: CollectionSlug,
  field: string,
  value: string,
  id?: string | number,
): Promise<boolean> {
  const { totalDocs } = await payload.find({
    collection,
    where: { and: [{ [field]: { equals: value } }, ...(id != null ? [{ id: { not_equals: id } }] : [])] },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  return totalDocs > 0
}

/** A text-field validator returning `message` when the value is already taken. */
export function uniqueFieldValidate(collection: CollectionSlug, field: string, message: string): TextFieldSingleValidation {
  return async (value, { req, id }) => {
    if (!value || typeof value !== 'string') return true
    return (await fieldTaken(req.payload, collection, field, value, id)) ? message : true
  }
}

/**
 * A `name` field validator that returns a friendly "already exists" message on a
 * duplicate (instead of the generic unique-constraint error). `noun` names the
 * record type in the message, e.g. uniqueNameValidate('shelves', 'shelf').
 */
export function uniqueNameValidate(collection: CollectionSlug, noun: string): TextFieldSingleValidation {
  return uniqueFieldValidate(collection, 'name', `A ${noun} with that name already exists.`)
}

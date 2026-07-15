import { APIError, type CollectionBeforeDeleteHook } from 'payload'

/**
 * Refuse to delete a class instance that still has bookings — its roster is
 * customer purchase/attendance history, and the DB would reject the delete
 * anyway (bookings.classInstance is required) with an opaque 500. Surface a
 * clear, actionable message instead.
 */
export const blockInstanceDeleteWithBookings: CollectionBeforeDeleteHook = async ({ req, id }) => {
  const { totalDocs } = await req.payload.count({
    collection: 'bookings',
    where: { classInstance: { equals: id } },
    req,
  })
  if (totalDocs > 0) {
    throw new APIError(
      `This class instance has ${totalDocs} booking(s) — its roster is customer history. ` +
        `Past instances are hidden automatically once completed; use status "Cancelled" if it never ran. ` +
        `To really delete it, delete its bookings first.`,
      400,
    )
  }
}

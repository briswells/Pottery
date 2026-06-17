import type { CollectionBeforeChangeHook } from 'payload'
import type { FiringRequest } from '../payload-types'

/**
 * Stamp `completedAt` the moment a firing request enters "completed", and clear
 * it if the request later moves out of that state. This timestamp is what the
 * media-expiry sweep keys off to delete the attached photo two weeks later.
 */
export const setFiringCompletedAt: CollectionBeforeChangeHook<FiringRequest> = ({ data, originalDoc }) => {
  const nextStatus = data?.status ?? originalDoc?.status
  const prevStatus = originalDoc?.status

  if (nextStatus === 'completed' && prevStatus !== 'completed') {
    if (!data.completedAt) data.completedAt = new Date().toISOString()
  } else if (nextStatus && nextStatus !== 'completed') {
    data.completedAt = null
  }
  return data
}

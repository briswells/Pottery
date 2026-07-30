import type { PayloadRequest } from 'payload'

/** True when the request is authenticated as an admin or editor from the
 *  users collection — the gate for every custom staff-only endpoint. */
export function isStaffRequest(req: PayloadRequest): boolean {
  const user = req.user
  return Boolean(
    user && user.collection === 'users' && user.roles?.some((r: string) => r === 'admin' || r === 'editor'),
  )
}

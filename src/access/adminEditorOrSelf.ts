import type { Access, Where } from 'payload'

/**
 * Admins and editors may act on every user; any other signed-in user (e.g. an
 * instructor) may act only on their own record. This is what lets non-admin staff
 * use the `/admin/account` page to read and edit their own profile. The `roles`
 * field has its own admin-only field access, so a self-update can't escalate.
 */
export const adminEditorOrSelf: Access = ({ req: { user } }): boolean | Where => {
  if (!user || user.collection !== 'users') return false
  if (user.roles?.some((r) => r === 'admin' || r === 'editor')) return true
  return { id: { equals: user.id } } satisfies Where
}

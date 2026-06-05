import type { Access } from 'payload'

/** True for users whose roles include 'admin' or 'editor'. */
export const isAdminOrEditor: Access = ({ req: { user } }) =>
  Boolean(
    user &&
      'roles' in user &&
      (user as { roles?: string[] }).roles?.some((r) => r === 'admin' || r === 'editor'),
  )

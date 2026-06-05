import type { Access } from 'payload'

/** True for users whose roles include 'admin' or 'editor'. */
export const isAdminOrEditor: Access = ({ req: { user } }) =>
  Boolean(
    user &&
      user.collection === 'users' &&
      user.roles?.some((r) => r === 'admin' || r === 'editor'),
  )

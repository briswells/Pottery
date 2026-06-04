import type { Access } from 'payload'

/** True only for users whose roles include 'admin'. */
export const isAdmin: Access = ({ req: { user } }) =>
  Boolean(user?.roles?.includes('admin'))

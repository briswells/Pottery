'use client'

import { Link, useAuth } from '@payloadcms/ui'
import type { User } from '../payload-types'

/**
 * Top-of-sidebar shortcut to the "All Classes" view. Registered via
 * `admin.components.beforeNavLinks`. Instructor-only: admins/editors already
 * see every instance via the class-instances collection list.
 */
export default function AllClassesNavLink() {
  const { user } = useAuth<User>()
  if (!user?.roles?.includes('instructor')) return null

  return (
    <Link className="nav__link" href="/admin/all-classes" id="nav-all-classes" prefetch={false}>
      <span className="nav__link-label">All Classes</span>
    </Link>
  )
}

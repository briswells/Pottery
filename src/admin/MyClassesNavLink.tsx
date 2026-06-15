'use client'

import { Link, useAuth } from '@payloadcms/ui'
import type { User } from '../payload-types'

/**
 * Top-of-sidebar shortcut to the instructor's "My Classes" view. Registered via
 * `admin.components.beforeNavLinks`, so it renders above the collection nav groups.
 * Only shown to users whose roles include "instructor" (roles are saveToJWT, so
 * available on the client user).
 */
export default function MyClassesNavLink() {
  const { user } = useAuth<User>()
  if (!user?.roles?.includes('instructor')) return null

  return (
    <Link className="nav__link" href="/admin/my-classes" id="nav-my-classes" prefetch={false}>
      <span className="nav__link-label">My Classes</span>
    </Link>
  )
}

'use client'

import { Link, useAuth } from '@payloadcms/ui'
import type { User } from '../payload-types'

/**
 * Top-of-sidebar shortcut to the "My Classes" view. Registered via
 * `admin.components.beforeNavLinks`, so it renders above the collection nav groups.
 * Shown to every admin user — an admin or editor may also teach classes — and the
 * view simply lists whatever classes they're the instructor of (empty if none).
 */
export default function MyClassesNavLink() {
  const { user } = useAuth<User>()
  if (!user) return null

  return (
    <Link className="nav__link" href="/admin/my-classes" id="nav-my-classes" prefetch={false}>
      <span className="nav__link-label">My Classes</span>
    </Link>
  )
}

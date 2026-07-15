'use client'

import { Link, useAuth } from '@payloadcms/ui'
import type { User } from '../payload-types'

/** "Newsletter" link to the live Kit subscriber list — staff only. */
export default function NewsletterNavLink() {
  const { user } = useAuth<User>()
  if (!user?.roles?.some((r) => r === 'admin' || r === 'editor')) return null
  return (
    <Link className="nav__link" href="/admin/newsletter-subscribers" id="nav-newsletter-subscribers" prefetch={false}>
      <span className="nav__link-label">Newsletter subscribers</span>
    </Link>
  )
}

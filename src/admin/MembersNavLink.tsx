'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from '@payloadcms/ui'

// Members are People who have a membership plan assigned.
const MEMBERS_HREF = '/admin/collections/people?where[plan][exists]=true'

/**
 * Renders a "Members" shortcut nested directly under the People link inside the
 * People nav group. Rather than replace Payload's whole sidebar (which would drop
 * the account/logout controls and collapse-state persistence), we portal a single
 * link into the People group's content container — found via the stable `nav-people`
 * link id — and append it after the People link.
 */
export default function MembersNavLink() {
  const [container, setContainer] = useState<HTMLElement | null>(null)

  useEffect(() => {
    let frame = 0
    let attempts = 0
    let el: HTMLElement | null = null

    const tryMount = () => {
      const peopleLink = document.getElementById('nav-people')
      const content = peopleLink?.closest('.nav-group__content')
      if (!content) {
        // The nav may not be painted yet on the very first client frame; retry briefly.
        if (attempts++ < 20) frame = requestAnimationFrame(tryMount)
        return
      }
      // Guard against duplicates from remounts / fast refresh.
      content.querySelector('[data-members-nav-link]')?.remove()
      el = document.createElement('div')
      el.setAttribute('data-members-nav-link', '')
      content.appendChild(el)
      setContainer(el)
    }

    tryMount()
    return () => {
      cancelAnimationFrame(frame)
      el?.remove()
      setContainer(null)
    }
  }, [])

  if (!container) return null
  return createPortal(
    <Link className="nav__link" href={MEMBERS_HREF} id="nav-members" prefetch={false}>
      <span className="nav__link-label">Members</span>
    </Link>,
    container,
  )
}

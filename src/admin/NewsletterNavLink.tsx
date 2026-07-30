'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useAuth } from '@payloadcms/ui'
import type { User } from '../payload-types'

/**
 * Renders a "Subscribers" shortcut nested directly under the Newsletters link
 * inside the Studio nav group (same portal technique as MembersNavLink):
 * rather than replace Payload's sidebar, we insert a single link element right
 * after the Newsletters link — found via its stable `nav-newsletters` id.
 */
export default function NewsletterNavLink() {
  const { user } = useAuth<User>()
  const staff = Boolean(user?.roles?.some((r) => r === 'admin' || r === 'editor'))
  const [container, setContainer] = useState<HTMLElement | null>(null)

  useEffect(() => {
    if (!staff) return
    let frame = 0
    let attempts = 0
    let el: HTMLElement | null = null

    const tryMount = () => {
      const newslettersLink = document.getElementById('nav-newsletters')
      if (!newslettersLink) {
        // The nav may not be painted yet on the very first client frame; retry briefly.
        if (attempts++ < 20) frame = requestAnimationFrame(tryMount)
        return
      }
      // Guard against duplicates from remounts / fast refresh.
      newslettersLink.parentElement?.querySelector('[data-newsletter-subscribers-nav-link]')?.remove()
      el = document.createElement('div')
      el.setAttribute('data-newsletter-subscribers-nav-link', '')
      newslettersLink.insertAdjacentElement('afterend', el)
      setContainer(el)
    }

    tryMount()
    return () => {
      cancelAnimationFrame(frame)
      el?.remove()
      setContainer(null)
    }
  }, [staff])

  if (!staff || !container) return null
  return createPortal(
    <Link className="nav__link" href="/admin/newsletter-subscribers" id="nav-newsletter-subscribers" prefetch={false}>
      <span className="nav__link-label">Subscribers</span>
    </Link>,
    container,
  )
}

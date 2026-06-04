'use client'

import { useState } from 'react'
import Link from 'next/link'

export function MobileNav() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        className="pp-menu-toggle"
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          {open ? (
            <>
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </>
          ) : (
            <>
              <line x1="3" y1="7" x2="21" y2="7" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="17" x2="21" y2="17" />
            </>
          )}
        </svg>
      </button>
      <nav
        className={`pp-mobile-nav${open ? ' pp-nav--open' : ''}`}
        aria-label="Mobile navigation"
      >
        <Link href="/" onClick={() => setOpen(false)}>Home</Link>
        <Link href="/classes" onClick={() => setOpen(false)}>Classes</Link>
        <Link href="/membership" onClick={() => setOpen(false)}>Membership</Link>
        <Link href="/gallery" onClick={() => setOpen(false)}>Gallery</Link>
        <Link href="/staff" onClick={() => setOpen(false)}>Meet the Staff</Link>
        <Link href="/visit" onClick={() => setOpen(false)}>Visit Us</Link>
        <Link href="/classes" className="pp-nav-cta" onClick={() => setOpen(false)}>Book a class</Link>
      </nav>
    </>
  )
}

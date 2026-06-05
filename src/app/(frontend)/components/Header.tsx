import Link from 'next/link'
import { MobileNav } from './MobileNav'

type Socials = { platform?: string | null; url?: string | null }[]

export function Header({
  studioName,
  logoUrl,
  phone,
  hours,
  socials,
}: {
  studioName: string
  logoUrl: string | null
  phone?: string | null
  hours?: { days?: string | null; time?: string | null }[] | null
  socials?: Socials | null
}) {
  // Short hours summary for utility bar — take first entry or default
  const h = hours?.[0] ?? null
  const hoursLine = h && (h.days || h.time)
    ? `Open ${[h.days, h.time].filter(Boolean).join(' ')}`
    : null

  return (
    <div className="pp-site-header">
      {/* ─── Utility bar ─── */}
      <div className="pp-utility-bar">
        <div className="pp-utility-bar-inner">
          <div className="pp-utility-left">
            {phone && (
              <a href={`tel:${phone.replace(/\D/g, '')}`}>{phone}</a>
            )}
            {hoursLine && (
              <>
                <span className="pp-utility-sep">·</span>
                <span>{hoursLine}</span>
              </>
            )}
          </div>
          <div className="pp-utility-right">
            {socials?.map((s, i) =>
              s.url && s.platform ? (
                <a key={i} href={s.url} target="_blank" rel="noopener noreferrer">
                  {s.platform}
                </a>
              ) : null
            )}
          </div>
        </div>
      </div>

      {/* ─── Main header ─── */}
      <div className="pp-header">
        <Link href="/" className="pp-logo" aria-label={`${studioName} — home`}>
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={studioName}
              style={{ height: 60, width: 'auto' }}
              loading="eager"
            />
          ) : (
            studioName
          )}
        </Link>

        {/* Desktop nav */}
        <nav className="pp-nav" aria-label="Main navigation">
          <Link href="/">Home</Link>
          <Link href="/classes">Classes</Link>
          <Link href="/membership">Membership</Link>
          <Link href="/firings">Firings</Link>
          <Link href="/gallery">Gallery</Link>
          <Link href="/staff">Meet the Staff</Link>
          <Link href="/visit">Visit Us</Link>
          <Link href="/classes" className="pp-nav-cta">Book a class</Link>
        </nav>

        {/* Mobile nav (client component for toggle) */}
        <MobileNav />
      </div>
    </div>
  )
}

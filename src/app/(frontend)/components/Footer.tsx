import Link from 'next/link'

type Hours = { days?: string | null; time?: string | null }
type Socials = { platform?: string | null; url?: string | null }[]

export function Footer({
  studioName,
  logoUrl,
  phone,
  email,
  addressLine,
  hours,
  socials,
}: {
  studioName?: string | null
  logoUrl?: string | null
  phone?: string | null
  email?: string | null
  addressLine?: string | null
  hours?: Hours[] | null
  socials?: Socials | null
}) {
  const year = new Date().getFullYear()
  const mapsUrl = addressLine
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addressLine)}`
    : null

  const name = studioName ?? 'Portside Pottery'

  return (
    <footer className="pp-footer" role="contentinfo">
      <div className="pp-footer-main">
        {/* (a) Brand column */}
        <div className="pp-footer-brand">
          <Link href="/" className="pp-footer-logo" aria-label={`${name} — home`}>
            {logoUrl ? (
              <img src={logoUrl} alt={name} style={{ height: 52, width: 'auto' }} loading="lazy" />
            ) : (
              <span className="pp-footer-logo-text">{name}</span>
            )}
          </Link>
          <p className="pp-footer-tagline">
            Where clay meets community — wheel throwing, hand-building, and 24/7 studio access for makers of every level.
          </p>
        </div>

        {/* (b) Explore links */}
        <div className="pp-footer-col">
          <h4>Explore</h4>
          <ul>
            <li><Link href="/">Home</Link></li>
            <li><Link href="/classes">Classes</Link></li>
            <li><Link href="/membership">Membership</Link></li>
            <li><Link href="/gallery">Gallery</Link></li>
            <li><Link href="/staff">Meet the Staff</Link></li>
            <li><Link href="/visit">Visit Us</Link></li>
          </ul>
        </div>

        {/* (c) Visit */}
        <div className="pp-footer-col">
          <h4>Visit</h4>
          {addressLine && <p className="pp-footer-visit-addr">{addressLine}</p>}
          {hours && hours.length > 0 && (
            <ul className="pp-footer-hours-mini">
              {hours.map((h, i) => (
                <li key={i}>
                  <span className="pp-fh-days">{h.days}</span>
                  <span>{h.time}</span>
                </li>
              ))}
            </ul>
          )}
          {mapsUrl && (
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="pp-footer-directions-link"
            >
              Get directions →
            </a>
          )}
        </div>

        {/* (d) Connect */}
        <div className="pp-footer-col">
          <h4>Connect</h4>
          {phone && (
            <div className="pp-footer-connect-item">
              <span>☎</span>
              <a href={`tel:${phone.replace(/\D/g, '')}`}>{phone}</a>
            </div>
          )}
          {email && (
            <div className="pp-footer-connect-item">
              <span>✉</span>
              <a href={`mailto:${email}`}>{email}</a>
            </div>
          )}
          {socials?.map((s, i) =>
            s.url && s.platform ? (
              <div key={i} className="pp-footer-connect-item">
                <span>↗</span>
                <a href={s.url} target="_blank" rel="noopener noreferrer">
                  {s.platform}
                </a>
              </div>
            ) : null
          )}
        </div>
      </div>

      {/* Bottom bar */}
      <div className="pp-footer-bottom-bar">
        <div className="pp-footer-bottom">
          <p className="pp-footer-copy">© {year} {name}. All rights reserved.</p>
          <nav aria-label="Footer links" style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <Link href="/classes" style={{ color: 'rgba(255,255,255,.44)', fontSize: 13, textDecoration: 'none' }}>Classes</Link>
            <Link href="/membership" style={{ color: 'rgba(255,255,255,.44)', fontSize: 13, textDecoration: 'none' }}>Membership</Link>
            <Link href="/visit" style={{ color: 'rgba(255,255,255,.44)', fontSize: 13, textDecoration: 'none' }}>Visit</Link>
          </nav>
        </div>
      </div>
    </footer>
  )
}

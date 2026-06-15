import { getPayload } from 'payload'
import config from '@payload-config'
import { mediaUrl, mediaAlt } from '../../../lib/media'

export const metadata = {
  title: 'Visit Us',
  description: 'Find Portside Pottery in Vancouver, WA. Get directions, hours, and contact info.',
}

export const dynamic = 'force-dynamic'

export default async function VisitPage() {
  const payload = await getPayload({ config: await config })
  const settings = await payload.findGlobal({ slug: 'site-settings', depth: 2 })
  const home = await payload.findGlobal({ slug: 'home-page', depth: 2 })

  // Use hero image or first gallery image as visit page photo
  const photoRef = home.heroImage ?? (home.gallery?.[0] ?? null)
  const photoUrl = mediaUrl(photoRef)
  const photoAlt = mediaAlt(photoRef) || 'Portside Pottery studio'

  const mapsUrl = settings.addressLine
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(settings.addressLine)}`
    : null

  return (
    <div>
      {/* Studio photo banner */}
      {photoUrl && (
        <div className="pp-visit-hero">
          <img src={photoUrl} alt={photoAlt} loading="eager" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          <div className="pp-visit-hero-scrim" aria-hidden="true" />
          <div className="pp-visit-hero-text">
            <div className="pp-kicker">Come see us</div>
            <h1>Visit the Studio</h1>
          </div>
        </div>
      )}

      <div className="pp-visit-content">
        {/* Left: address + hours + CTAs */}
        <div className="pp-visit-left">
          {settings.addressLine && (
            <p className="pp-visit-address">{settings.addressLine}</p>
          )}

          <div className="pp-visit-info-row">
            {settings.hours && settings.hours.length > 0 && (
              <div className="pp-visit-info-block">
                <h2>Hours</h2>
                <ul className="pp-hours-list">
                  {settings.hours.map((h, i) => (
                    <li key={i}>
                      <span className="pp-hours-days">{h.days}</span>
                      <span>{h.time}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {settings.phone && (
              <div className="pp-visit-info-block">
                <h2>Phone</h2>
                <a href={`tel:${settings.phone.replace(/\D/g, '')}`}>{settings.phone}</a>
              </div>
            )}

            {settings.email && (
              <div className="pp-visit-info-block">
                <h2>Email</h2>
                <a href={`mailto:${settings.email}`}>{settings.email}</a>
              </div>
            )}
          </div>

          <div className="pp-visit-cta-group">
            {mapsUrl && (
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="pp-btn"
              >
                Get directions
              </a>
            )}
            {settings.phone && (
              <a
                href={`tel:${settings.phone.replace(/\D/g, '')}`}
                className="pp-btn"
                style={{ background: 'transparent', color: 'var(--pp-terracotta)', border: '2px solid var(--pp-terracotta)' }}
              >
                Call us
              </a>
            )}
          </div>
        </div>

        {/* Right: welcoming blurb */}
        <div className="pp-visit-right">
          <div className="pp-kicker">You&apos;re welcome here</div>
          <h2 style={{ fontFamily: 'var(--font-fraunces), Georgia, serif', fontSize: 'clamp(22px, 3vw, 32px)', margin: '0 0 16px', lineHeight: 1.15 }}>
            A studio built for makers of every level
          </h2>
          <p>
            Whether you&apos;re picking up clay for the first time or you&apos;ve been throwing for years, Portside Pottery is a place to feel at home. We&apos;re a working studio with professional equipment, warm instructors, and a community that celebrates the messy, meditative joy of making things by hand.
          </p>
          <p>
            Come by during open hours to peek around, or reach out — we&apos;d love to show you the space. Membership inquiries, class questions, or just a hello: drop us a line anytime.
          </p>
          {settings.socials && settings.socials.length > 0 && (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 4 }}>
              {settings.socials.map((s, i) =>
                s.url && s.platform ? (
                  <a
                    key={i}
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="pp-btn"
                    style={{ background: 'transparent', color: 'var(--pp-terracotta)', border: '2px solid var(--pp-terracotta)', padding: '8px 18px', fontSize: 14 }}
                  >
                    {s.platform}
                  </a>
                ) : null
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

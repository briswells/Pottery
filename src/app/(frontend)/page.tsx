import { getPayload } from 'payload'
import config from '@payload-config'
import Link from 'next/link'
import { mediaUrl, mediaAlt } from '../../lib/media'

export default async function HomePage() {
  const payload = await getPayload({ config: await config })
  const home = await payload.findGlobal({ slug: 'home-page', depth: 2 })

  const heroImgUrl = mediaUrl(home.heroImage, 'hero')
  const heroImgAlt = mediaAlt(home.heroImage) || home.heroHeadline || 'Portside Pottery studio'

  return (
    <div>
      {/* ── HERO (full-bleed editorial) ── */}
      {heroImgUrl ? (
        <section className="pp-hero">
          <img
            className="pp-hero-img"
            src={heroImgUrl}
            alt={heroImgAlt}
            loading="eager"
          />
          <div className="pp-hero-scrim" aria-hidden="true" />
          <div className="pp-hero-content">
            {home.heroKicker && <div className="pp-kicker">{home.heroKicker}</div>}
            <h1>{home.heroHeadline}</h1>
            {home.heroSubtext && <p>{home.heroSubtext}</p>}
            <div className="pp-hero-ctas">
              <Link href="/classes" className="pp-btn">Browse classes</Link>
              <Link href="/membership" className="pp-btn--ghost">Become a member</Link>
            </div>
          </div>
        </section>
      ) : (
        <section className="pp-hero-text">
          {home.heroKicker && <div className="pp-kicker">{home.heroKicker}</div>}
          <h1>{home.heroHeadline}</h1>
          {home.heroSubtext && <p>{home.heroSubtext}</p>}
          <div style={{ display: 'flex', gap: 14, marginTop: 16, flexWrap: 'wrap' }}>
            <Link href="/classes" className="pp-btn">Browse classes</Link>
            <Link href="/membership" className="pp-btn">Become a member</Link>
          </div>
        </section>
      )}

      {/* ── STORY BANDS (alternating image/text rows) ── */}
      {home.sections?.map((s, i) => {
        const imgUrl = mediaUrl(s.image)
        const imgAlt = mediaAlt(s.image)
        const isReverse = i % 2 !== 0
        return (
          <section key={i} className={`pp-row${imgUrl ? (isReverse ? ' pp-row--reverse' : '') : ' pp-row--full'}`}>
            {imgUrl && (
              <div className="pp-row-img">
                <img src={imgUrl} alt={imgAlt} loading="lazy" />
              </div>
            )}
            <div className="pp-row-body">
              <h2>{s.heading}</h2>
              <p>{s.body}</p>
            </div>
          </section>
        )
      })}

      {/* ── GALLERY (true masonry, zero crop) ── */}
      {home.gallery && home.gallery.length > 0 && (
        <section className="pp-gallery-section">
          <h2>From the studio</h2>
          <div className="pp-gallery">
            {home.gallery.map((item, i) => {
              const imgUrl = mediaUrl(item)
              const imgAlt = mediaAlt(item)
              if (!imgUrl) return null
              return (
                <div key={i} className="pp-gallery-item">
                  <img src={imgUrl} alt={imgAlt} loading="lazy" />
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* ── MEMBERSHIP INVITE BAND ── */}
      <section className="pp-membership-band">
        <h2>Ready to make something?</h2>
        <p>Join Portside Pottery and get 24/7 studio access, professional wheels, and a community of makers.</p>
        <Link href="/membership" className="pp-btn">Become a member</Link>
      </section>
    </div>
  )
}

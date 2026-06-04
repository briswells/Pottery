import { getPayload } from 'payload'
import config from '@payload-config'
import Link from 'next/link'
import { mediaUrl, mediaAlt } from '../../lib/media'

export default async function HomePage() {
  const payload = await getPayload({ config: await config })
  const home = await payload.findGlobal({ slug: 'home-page', depth: 2 })

  const heroImgUrl = mediaUrl(home.heroImage, 'hero')
  const heroImgAlt = mediaAlt(home.heroImage)

  return (
    <div>
      {/* ── HERO ── */}
      {heroImgUrl ? (
        <section className="pp-hero">
          <img
            className="pp-hero-img"
            src={heroImgUrl}
            alt={heroImgAlt}
            loading="lazy"
          />
          <div className="pp-hero-scrim" aria-hidden="true" />
          <div className="pp-hero-content">
            {home.heroKicker && <div className="pp-kicker">{home.heroKicker}</div>}
            <h1>{home.heroHeadline}</h1>
            {home.heroSubtext && <p>{home.heroSubtext}</p>}
            <Link href="/classes" className="pp-btn">Explore classes</Link>
          </div>
        </section>
      ) : (
        <section className="pp-hero-text">
          {home.heroKicker && <div className="pp-kicker">{home.heroKicker}</div>}
          <h1>{home.heroHeadline}</h1>
          {home.heroSubtext && <p>{home.heroSubtext}</p>}
          <Link href="/classes" className="pp-btn" style={{ marginTop: 16 }}>Explore classes</Link>
        </section>
      )}

      {/* ── SECTIONS (alternating rows) ── */}
      {home.sections?.map((s, i) => {
        const imgUrl = mediaUrl(s.image)
        const imgAlt = mediaAlt(s.image)
        const isReverse = i % 2 !== 0
        return (
          <section key={i} className={`pp-row${isReverse ? ' pp-row--reverse' : ''}`}>
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

      {/* ── GALLERY ── */}
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
    </div>
  )
}

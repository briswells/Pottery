import { getPayload } from 'payload'
import config from '@payload-config'
import Link from 'next/link'
import { mediaUrl, mediaAlt } from '../../lib/media'
import { NewsletterBand } from './components/NewsletterBand'

export default async function HomePage() {
  const payload = await getPayload({ config: await config })
  const home = await payload.findGlobal({ slug: 'home-page', depth: 2 })

  const heroImgUrl = mediaUrl(home.heroImage, 'hero')
  const heroImgAlt = mediaAlt(home.heroImage) || home.heroHeadline || 'Portside Pottery studio'

  // Pull gallery images for category cards (first few studio photos)
  const galleryItems = home.gallery ?? []
  const cardImg0 = galleryItems[0] ? mediaUrl(galleryItems[0]) : null
  const cardImg1 = galleryItems[1] ? mediaUrl(galleryItems[1]) : null
  const cardImg2 = galleryItems[2] ? mediaUrl(galleryItems[2]) : null
  const cardAlt0 = galleryItems[0] ? mediaAlt(galleryItems[0]) : 'Pottery class'
  const cardAlt1 = galleryItems[1] ? mediaAlt(galleryItems[1]) : 'Studio membership'
  const cardAlt2 = galleryItems[2] ? mediaAlt(galleryItems[2]) : 'Visit the studio'

  // Fallback: use section images for category cards if gallery is sparse
  const sections = home.sections ?? []
  const fallback0 = sections[0] ? mediaUrl(sections[0].image) : null
  const fallback1 = sections[1] ? mediaUrl(sections[1].image) : null
  const fallback2 = sections[2] ? mediaUrl(sections[2].image) : null

  const cat0 = cardImg0 || fallback0
  const cat1 = cardImg1 || fallback1
  const cat2 = cardImg2 || fallback2

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

      {/* ── CATEGORY CARDS ROW (Kilnfolk-style) ── */}
      <section className="pp-category-section" aria-label="What we offer">
        <div className="pp-kicker">What we offer</div>
        <h2>Find your place in clay</h2>
        <div className="pp-category-cards">
          {/* Card 1: Take a class */}
          <Link href="/classes" className="pp-category-card">
            {cat0 && <img src={cat0} alt={cardAlt0} loading="lazy" />}
            <div className="pp-category-card-scrim" aria-hidden="true" />
            <div className="pp-category-card-body">
              <div className="pp-kicker">For everyone</div>
              <h3>Take a class</h3>
              <p>Wheel throwing, hand-building, raku — classes for all skill levels.</p>
              <span className="pp-category-card-arrow">View classes →</span>
            </div>
          </Link>

          {/* Card 2: Become a member */}
          <Link href="/membership" className="pp-category-card">
            {cat1 && <img src={cat1} alt={cardAlt1} loading="lazy" />}
            <div className="pp-category-card-scrim" aria-hidden="true" />
            <div className="pp-category-card-body">
              <div className="pp-kicker">Open studio</div>
              <h3>Become a member</h3>
              <p>24/7 studio access, professional wheels, and a community of makers.</p>
              <span className="pp-category-card-arrow">Learn more →</span>
            </div>
          </Link>

          {/* Card 3: Visit the studio */}
          <Link href="/visit" className="pp-category-card">
            {cat2 && <img src={cat2} alt={cardAlt2} loading="lazy" />}
            <div className="pp-category-card-scrim" aria-hidden="true" />
            <div className="pp-category-card-body">
              <div className="pp-kicker">Come in</div>
              <h3>Visit the studio</h3>
              <p>Located in Vancouver, WA — come see the space and meet the team.</p>
              <span className="pp-category-card-arrow">Plan your visit →</span>
            </div>
          </Link>
        </div>
      </section>

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

      {/* ── GALLERY TEASER (true masonry, zero crop) ── */}
      {home.gallery && home.gallery.length > 0 && (
        <section className="pp-gallery-section">
          <div className="pp-kicker">Studio life</div>
          <h2>From the studio</h2>
          <p className="pp-gallery-intro">A glimpse into life at Portside — the work, the people, the process.</p>
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
          <div style={{ textAlign: 'center', marginTop: 28 }}>
            <Link href="/gallery" className="pp-btn" style={{ background: 'transparent', color: 'var(--pp-terracotta)', border: '2px solid var(--pp-terracotta)', borderRadius: 8 }}>
              View full gallery
            </Link>
          </div>
        </section>
      )}

      {/* ── MEMBERSHIP INVITE BAND ── */}
      <section className="pp-membership-band">
        <h2>Ready to make something?</h2>
        <p>Join Portside Pottery and get 24/7 studio access, professional wheels, and a community of makers.</p>
        <Link href="/membership" className="pp-btn">Become a member</Link>
      </section>

      {/* ── NEWSLETTER BAND ── */}
      <NewsletterBand />
    </div>
  )
}

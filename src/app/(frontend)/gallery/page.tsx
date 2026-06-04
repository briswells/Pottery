import { getPayload } from 'payload'
import config from '@payload-config'
import { mediaUrl, mediaAlt } from '../../../lib/media'

export const metadata = {
  title: 'Gallery — Portside Pottery',
  description: 'A visual look at life in the Portside Pottery studio — the work, the people, the process.',
}

export default async function GalleryPage() {
  const payload = await getPayload({ config: await config })
  const home = await payload.findGlobal({ slug: 'home-page', depth: 2 })

  const galleryItems = home.gallery ?? []

  return (
    <div>
      {/* Page header */}
      <div style={{ paddingTop: 48, paddingBottom: 32, borderBottom: '1px solid #e2d8cc', marginBottom: 0 }}>
        <div className="pp-kicker">Studio life</div>
        <h1 style={{ fontFamily: 'var(--font-fraunces), Georgia, serif', fontSize: 'clamp(30px, 5vw, 52px)', margin: '10px 0 14px', lineHeight: 1.05 }}>
          Gallery
        </h1>
        <p style={{ color: 'var(--pp-muted)', maxWidth: 560, lineHeight: 1.7, margin: 0, fontSize: 16 }}>
          A glimpse into life at Portside — the work, the people, and the joy of making things by hand.
        </p>
      </div>

      {/* Full masonry gallery */}
      {galleryItems.length > 0 ? (
        <section className="pp-gallery-section" style={{ borderTop: 'none', paddingTop: 40 }}>
          <div className="pp-gallery">
            {galleryItems.map((item, i) => {
              const imgUrl = mediaUrl(item)
              const imgAlt = mediaAlt(item)
              if (!imgUrl) return null
              return (
                <div key={i} className="pp-gallery-item">
                  <img src={imgUrl} alt={imgAlt} loading={i < 6 ? 'eager' : 'lazy'} />
                </div>
              )
            })}
          </div>
        </section>
      ) : (
        <p style={{ color: 'var(--pp-muted)', padding: '40px 0', fontSize: 16 }}>
          No gallery images yet — check back soon.
        </p>
      )}
    </div>
  )
}

import { getPayload } from 'payload'
import config from '@payload-config'
import { FiringRequestForm } from './FiringRequestForm'
import { mediaUrl, mediaAlt } from '../../../lib/media'
import { nextFiringDate } from '../../../lib/firing-date'
import { MAX_HALF_SHELVES, FIRING_HALF_SHELF_CENTS } from '../../../lib/firing-pricing'

export const metadata = {
  title: 'Firings',
  description: 'Request a custom Cone 10 firing — pay up front, no invoice to wait on.',
}

export const dynamic = 'force-dynamic'

export default async function FiringsPage() {
  const payload = await getPayload({ config: await config })
  const page = await payload.findGlobal({ slug: 'firings-page' })

  const nextDate = nextFiringDate()
  const nextDateLabel = nextDate.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
  // Whole-dollar prices read cleaner without cents ("$25", not "$25.00").
  const shelfPriceLabel = `$${(FIRING_HALF_SHELF_CENTS / 100).toFixed(2).replace(/\.00$/, '')}`
  const imageUrl = mediaUrl(page.image)

  return (
    <div style={{ padding: '40px 0 56px' }}>
      <div className="pp-kicker">Cone 10 · last Friday of every month</div>
      <h1 style={{ marginTop: 8 }}>{page.headline}</h1>

      <div className="pp-firings-grid">
        {/* Left: the story — what this is and how it goes */}
        <div>
          {page.intro && (
            <p style={{ color: 'var(--pp-muted)', lineHeight: 1.7, fontSize: 17 }}>{page.intro}</p>
          )}

          {page.steps && page.steps.length > 0 && (
            <>
              <h2 style={{ fontSize: 20, margin: '26px 0 6px' }}>How it works</h2>
              <ol className="pp-firings-steps">
                {page.steps.map((s, i) => (
                  <li key={i}>{s.step}</li>
                ))}
              </ol>
            </>
          )}

          {page.pricingNote && <p style={{ marginTop: 10, fontWeight: 600 }}>{page.pricingNote}</p>}
        </div>

        {/* Right: the photo with the "kiln ticket" — the three facts that decide a request */}
        <div>
          {imageUrl && (
            <img
              className="pp-firings-photo"
              src={imageUrl}
              alt={mediaAlt(page.image) || page.headline}
            />
          )}
          <div className={`pp-firing-ticket${imageUrl ? ' pp-firing-ticket--overlap' : ''}`}>
            <div className="pp-kicker">Next firing</div>
            <div className="pp-firing-ticket-date">{nextDateLabel}</div>
            <hr className="pp-firing-ticket-rule" />
            <p className="pp-firing-ticket-fact">
              <strong>{shelfPriceLabel}</strong> per half shelf (11″ × 22″ × 6″) · up to {MAX_HALF_SHELVES} per
              request
            </p>
            <p className="pp-firing-ticket-fact pp-firing-ticket-warn">
              <strong>Stoneware only.</strong> We fire to Cone 10 — no earthenware, no low-fire clay, and no
              porcelain (even high-fire porcelain).
            </p>
          </div>
        </div>
      </div>

      <div className="pp-firings-form-section">
        <h2 style={{ fontSize: 22, marginBottom: 4 }}>Request a firing</h2>
        <FiringRequestForm />
      </div>
    </div>
  )
}

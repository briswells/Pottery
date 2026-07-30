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

  return (
    <div style={{ padding: '40px 0', maxWidth: 680 }}>
      <h1>{page.headline}</h1>
      {page.intro && <p style={{ color: 'var(--pp-muted)', lineHeight: 1.7, maxWidth: 560 }}>{page.intro}</p>}

      {mediaUrl(page.image) && (
        <img
          src={mediaUrl(page.image)!}
          alt={mediaAlt(page.image) || page.headline}
          style={{ width: '100%', borderRadius: 8, marginTop: 8, display: 'block' }}
        />
      )}

      {page.steps && page.steps.length > 0 && (
        <>
          <h2 style={{ fontSize: 20, marginBottom: 12 }}>How it works</h2>
          <ol style={{ lineHeight: 1.7, paddingLeft: 20 }}>
            {page.steps.map((s, i) => (
              <li key={i}>{s.step}</li>
            ))}
          </ol>
        </>
      )}

      {page.pricingNote && <p style={{ marginTop: 16, fontWeight: 600 }}>{page.pricingNote}</p>}

      <div
        style={{
          marginTop: 20,
          padding: '14px 16px',
          background: 'var(--pp-cream)',
          borderLeft: '4px solid var(--pp-terracotta)',
          borderRadius: 4,
        }}
      >
        <strong>Stoneware only.</strong> We fire to Cone 10 — no earthenware, no low-fire clay, and
        no porcelain (even high-fire porcelain).
      </div>

      <p style={{ marginTop: 16 }}>
        Half shelf (11″ × 22″ × 6″) — {shelfPriceLabel} each, up to {MAX_HALF_SHELVES} per request.
      </p>

      <p style={{ marginTop: 8 }}>
        Next firing: <strong>{nextDateLabel}</strong> — we fire the last Friday of every month.
      </p>

      <h2 style={{ fontSize: 20, marginTop: 28, marginBottom: 4 }}>Request a firing</h2>
      <FiringRequestForm />
    </div>
  )
}

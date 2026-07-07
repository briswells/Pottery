import { getPayload } from 'payload'
import config from '@payload-config'
import { notFound } from 'next/navigation'
import { FiringRequestForm } from './FiringRequestForm'

export const metadata = {
  title: 'Firings',
  description: 'Request a custom Cone 10 firing. We quote a price by size — no upfront charge.',
}

export const dynamic = 'force-dynamic'

// Custom firings are hidden from the public site for now. The page 404s (nav
// link also removed in Header) — delete the notFound() call to re-enable.
const FIRINGS_PAGE_HIDDEN = true

export default async function FiringsPage() {
  if (FIRINGS_PAGE_HIDDEN) notFound()
  const payload = await getPayload({ config: await config })
  const page = await payload.findGlobal({ slug: 'firings-page' })

  return (
    <div style={{ padding: '40px 0', maxWidth: 680 }}>
      <h1>{page.headline}</h1>
      {page.intro && <p style={{ color: 'var(--pp-muted)', lineHeight: 1.7, maxWidth: 560 }}>{page.intro}</p>}

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

      <h2 style={{ fontSize: 20, marginTop: 28, marginBottom: 4 }}>Request a firing</h2>
      <FiringRequestForm />
    </div>
  )
}

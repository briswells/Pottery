import { getPayload } from 'payload'
import config from '@payload-config'
import Link from 'next/link'

export default async function HomePage() {
  const payload = await getPayload({ config: await config })
  const home = await payload.findGlobal({ slug: 'home-page' })

  return (
    <div>
      <section style={{ padding: '48px 0' }}>
        {home.heroKicker && <div className="pp-kicker">{home.heroKicker}</div>}
        <h1 style={{ fontSize: 44, margin: '12px 0' }}>{home.heroHeadline}</h1>
        {home.heroSubtext && <p style={{ maxWidth: 560, color: 'var(--pp-muted)' }}>{home.heroSubtext}</p>}
        <Link href="/classes" className="pp-btn" style={{ marginTop: 16 }}>Explore classes</Link>
      </section>

      {home.sections?.map((s, i) => (
        <section key={i} style={{ padding: '24px 0', borderTop: '1px solid #e2d8cc' }}>
          <h2>{s.heading}</h2>
          <p style={{ color: 'var(--pp-muted)' }}>{s.body}</p>
        </section>
      ))}
    </div>
  )
}

import { getPayload } from 'payload'
import config from '@payload-config'
import Link from 'next/link'
import { usd } from '../../../lib/format'

export default async function ClassesPage() {
  const payload = await getPayload({ config: await config })
  const { docs } = await payload.find({
    collection: 'classes',
    where: { status: { equals: 'active' } },
    sort: 'startDate',
    limit: 100,
  })

  return (
    <div style={{ padding: '40px 0' }}>
      <h1>Classes</h1>
      <div style={{ display: 'grid', gap: 20, marginTop: 24 }}>
        {docs.map((c) => (
          <article key={c.id} style={{ borderBottom: '1px solid #e2d8cc', paddingBottom: 16 }}>
            <h2 style={{ marginBottom: 2 }}>
              <Link href={`/classes/${c.slug}`}>{c.title}</Link>
            </h2>
            <div style={{ color: 'var(--pp-muted)' }}>{c.scheduleText} · {usd(c.priceCents)}</div>
          </article>
        ))}
        {docs.length === 0 && <p>New classes are being scheduled — check back soon.</p>}
      </div>
    </div>
  )
}

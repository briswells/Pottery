import { getPayload } from 'payload'
import config from '@payload-config'
import Link from 'next/link'
import { usd } from '../../../lib/format'
import { mediaUrl, mediaAlt } from '../../../lib/media'
import { formatDate } from '../../../lib/schedule'

export const dynamic = 'force-dynamic'

export default async function ClassesPage() {
  const payload = await getPayload({ config: await config })
  const todayIso = new Date().toISOString().slice(0, 10)

  const { docs: classes } = await payload.find({
    collection: 'classes',
    where: { status: { equals: 'active' } },
    sort: 'title',
    limit: 100,
    depth: 2,
  })

  const { docs: instances } = await payload.find({
    collection: 'class-instances',
    where: { and: [{ status: { equals: 'published' } }, { startDate: { greater_than_equal: todayIso } }] },
    sort: 'startDate',
    limit: 500,
    depth: 0,
  })

  // Earliest upcoming start date per class id (instances are sorted ascending).
  const nextByClass = new Map<number | string, string>()
  for (const inst of instances) {
    const cid = typeof inst.class === 'object' && inst.class ? inst.class.id : inst.class
    if (cid != null && !nextByClass.has(cid)) nextByClass.set(cid, inst.startDate as string)
  }

  return (
    <div style={{ padding: '40px 0' }}>
      <h1>Classes</h1>
      <p style={{ marginBottom: 16 }}>
        <Link href="/schedule">View class calendar →</Link>
      </p>
      {classes.length === 0 ? (
        <p>New classes are being scheduled — check back soon.</p>
      ) : (
        <div className="pp-cards-grid">
          {classes.map((c) => {
            const imgUrl = mediaUrl(c.image, 'card')
            const next = nextByClass.get(c.id)
            return (
              <article key={c.id} className="pp-card">
                {imgUrl && (
                  <div className="pp-card-img">
                    <img src={imgUrl} alt={mediaAlt(c.image)} loading="lazy" />
                  </div>
                )}
                <div className="pp-card-body">
                  <h2>
                    <Link href={`/classes/${c.slug}`}>{c.title}</Link>
                  </h2>
                  <div className="pp-card-meta">
                    {next ? `Next session: ${formatDate(next)}` : 'New dates coming soon'} · from {usd(c.defaultPriceCents)}
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}

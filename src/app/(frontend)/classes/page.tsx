import { getPayload } from 'payload'
import config from '@payload-config'
import Link from 'next/link'
import { usd } from '../../../lib/format'
import { mediaUrl, mediaAlt } from '../../../lib/media'

export const dynamic = 'force-dynamic'

export default async function ClassesPage() {
  const payload = await getPayload({ config: await config })
  const { docs } = await payload.find({
    collection: 'classes',
    where: { status: { equals: 'active' } },
    sort: 'startDate',
    limit: 100,
    depth: 2,
  })

  return (
    <div style={{ padding: '40px 0' }}>
      <h1>Classes</h1>
      {docs.length === 0 ? (
        <p>New classes are being scheduled — check back soon.</p>
      ) : (
        <div className="pp-cards-grid">
          {docs.map((c) => {
            const imgUrl = mediaUrl(c.image, 'card')
            const imgAlt = mediaAlt(c.image)
            return (
              <article key={c.id} className="pp-card">
                {imgUrl && (
                  <div className="pp-card-img">
                    <img src={imgUrl} alt={imgAlt} loading="lazy" />
                  </div>
                )}
                <div className="pp-card-body">
                  <h2>
                    <Link href={`/classes/${c.slug}`}>{c.title}</Link>
                  </h2>
                  <div className="pp-card-meta">{c.scheduleText} · {usd(c.priceCents)}</div>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}

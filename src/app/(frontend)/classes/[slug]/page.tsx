import { getPayload } from 'payload'
import config from '@payload-config'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { usd } from '../../../../lib/format'
import { mediaUrl, mediaAlt } from '../../../../lib/media'
import { seatsRemaining } from '../../../../lib/occupancy'
import { scheduleSummary } from '../../../../lib/schedule'

export const dynamic = 'force-dynamic'

export default async function ClassDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const payload = await getPayload({ config: await config })
  const { docs } = await payload.find({ collection: 'classes', where: { slug: { equals: slug } }, limit: 1, depth: 2 })
  const cls = docs[0]
  if (!cls) notFound()

  const todayIso = new Date().toISOString().slice(0, 10)
  const { docs: instances } = await payload.find({
    collection: 'class-instances',
    where: { and: [
      { class: { equals: cls.id } },
      { status: { equals: 'published' } },
      { startDate: { greater_than_equal: todayIso } },
    ] },
    sort: 'startDate',
    limit: 100,
    depth: 2,
  })

  const withSeats = await Promise.all(
    instances.map(async (inst) => ({ inst, remaining: await seatsRemaining(payload, inst.id) })),
  )

  const bannerUrl = mediaUrl(cls.image, 'hero')

  return (
    <div style={{ padding: '40px 0', maxWidth: 720 }}>
      {bannerUrl && (
        <div className="pp-detail-banner">
          <img src={bannerUrl} alt={mediaAlt(cls.image)} loading="lazy" />
        </div>
      )}
      <h1>{cls.title}</h1>
      {cls.skillLevel && <div style={{ color: 'var(--pp-muted)' }}>Skill level: {cls.skillLevel}</div>}
      {cls.description && <p style={{ marginTop: 16 }}>{cls.description}</p>}

      <h2 style={{ marginTop: 32 }}>Upcoming sessions</h2>
      {withSeats.length === 0 ? (
        <p>No sessions are scheduled right now — check back soon.</p>
      ) : (
        <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
          {withSeats.map(({ inst, remaining }) => {
            const instructorName = typeof inst.instructor === 'object' && inst.instructor ? inst.instructor.name : null
            return (
              <div key={inst.id} className="pp-card" style={{ padding: 16 }}>
                <div style={{ fontWeight: 600 }}>{scheduleSummary(inst)}</div>
                <div style={{ color: 'var(--pp-muted)' }}>
                  {instructorName ? `With ${instructorName} · ` : ''}{usd(inst.priceCents ?? 0)}
                </div>
                {remaining > 0 ? (
                  <p style={{ marginTop: 8 }}>
                    <Link className="pp-btn" href={`/classes/${slug}/signup/${inst.id}`}>
                      Sign up ({remaining} {remaining === 1 ? 'seat' : 'seats'} left)
                    </Link>
                  </p>
                ) : (
                  <p style={{ marginTop: 8, fontWeight: 600 }}>Full</p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

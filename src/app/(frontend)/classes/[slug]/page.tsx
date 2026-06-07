import { getPayload } from 'payload'
import config from '@payload-config'
import { notFound } from 'next/navigation'
import { usd, CATEGORY_LABELS } from '../../../../lib/format'
import { mediaUrl, mediaAlt } from '../../../../lib/media'
import { seatsRemaining } from '../../../../lib/occupancy'
import { BookingForm } from './BookingForm'

export const dynamic = 'force-dynamic'

export default async function ClassDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const payload = await getPayload({ config: await config })
  const { docs } = await payload.find({
    collection: 'classes',
    where: { slug: { equals: slug } },
    limit: 1,
    depth: 2,
  })
  const cls = docs[0]
  if (!cls) notFound()

  const remaining = await seatsRemaining(payload, cls.id)

  const bannerUrl = mediaUrl(cls.image, 'hero')
  const bannerAlt = mediaAlt(cls.image)

  return (
    <div style={{ padding: '40px 0', maxWidth: 720 }}>
      {bannerUrl && (
        <div className="pp-detail-banner">
          <img src={bannerUrl} alt={bannerAlt} loading="lazy" />
        </div>
      )}
      <div className="pp-kicker">{CATEGORY_LABELS[cls.category] ?? cls.category}</div>
      <h1>{cls.title}</h1>
      <div style={{ color: 'var(--pp-muted)' }}>{cls.scheduleText}</div>
      {cls.skillLevel && <div style={{ color: 'var(--pp-muted)' }}>Skill level: {cls.skillLevel}</div>}
      {cls.description && <p style={{ marginTop: 16 }}>{cls.description}</p>}
      <p style={{ fontSize: 22, fontWeight: 600 }}>{usd(cls.priceCents)}</p>
      {remaining > 0 ? (
        <BookingForm classId={cls.id} slug={slug} priceCents={cls.priceCents} priceLabel={usd(cls.priceCents)} />
      ) : (
        <p style={{ fontWeight: 600 }}>This class is full.</p>
      )}
    </div>
  )
}

import { getPayload } from 'payload'
import config from '@payload-config'
import { notFound } from 'next/navigation'
import { usd } from '../../../../lib/format'

export default async function ClassDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const payload = await getPayload({ config: await config })
  const { docs } = await payload.find({ collection: 'classes', where: { slug: { equals: slug } }, limit: 1 })
  const cls = docs[0]
  if (!cls) notFound()

  return (
    <div style={{ padding: '40px 0', maxWidth: 640 }}>
      <div className="pp-kicker">{cls.category}</div>
      <h1>{cls.title}</h1>
      <div style={{ color: 'var(--pp-muted)' }}>{cls.scheduleText}</div>
      {cls.skillLevel && <div style={{ color: 'var(--pp-muted)' }}>Skill level: {cls.skillLevel}</div>}
      {cls.description && <p style={{ marginTop: 16 }}>{cls.description}</p>}
      <p style={{ fontSize: 22, fontWeight: 600 }}>{usd(cls.priceCents)}</p>
      <a className="pp-btn" href="mailto:getcreative@portsidepottery.com?subject=Class%20registration">
        Ask about registering
      </a>
    </div>
  )
}

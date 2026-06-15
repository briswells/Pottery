import { getPayload } from 'payload'
import config from '@payload-config'
import { notFound } from 'next/navigation'
import { usd } from '../../../../../../lib/format'
import { seatsRemaining } from '../../../../../../lib/occupancy'
import { scheduleSummary } from '../../../../../../lib/schedule'
import { BookingForm } from '../../BookingForm'
import type { Metadata } from 'next'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ instanceId: string }> }): Promise<Metadata> {
  const { instanceId } = await params
  const payload = await getPayload({ config: await config })
  try {
    const inst = await payload.findByID({ collection: 'class-instances', id: instanceId, depth: 1 })
    const name = inst?.label || (typeof inst?.class === 'object' ? inst.class?.title : null)
    return { title: name ? `Sign up · ${name}` : 'Sign up' }
  } catch {
    return { title: 'Sign up' }
  }
}

export default async function SignupPage({ params }: { params: Promise<{ slug: string; instanceId: string }> }) {
  const { slug, instanceId } = await params
  const payload = await getPayload({ config: await config })

  let inst: any
  try {
    inst = await payload.findByID({ collection: 'class-instances', id: instanceId, depth: 2 })
  } catch {
    notFound()
  }
  const cls = inst && typeof inst.class === 'object' ? inst.class : null
  if (!inst || inst.status !== 'published' || !cls || cls.slug !== slug) notFound()

  const remaining = await seatsRemaining(payload, inst.id)

  return (
    <div style={{ padding: '40px 0', maxWidth: 720 }}>
      <h1>{cls.title}</h1>
      <div style={{ color: 'var(--pp-muted)' }}>{scheduleSummary(inst)}</div>
      <p style={{ fontSize: 22, fontWeight: 600 }}>{usd(inst.priceCents ?? 0)}</p>
      {remaining > 0 ? (
        <BookingForm classInstanceId={inst.id} slug={slug} priceCents={inst.priceCents ?? 0} priceLabel={usd(inst.priceCents ?? 0)} />
      ) : (
        <p style={{ fontWeight: 600 }}>This session is full.</p>
      )}
    </div>
  )
}

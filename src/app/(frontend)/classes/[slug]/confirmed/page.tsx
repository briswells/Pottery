import { getPayload } from 'payload'
import config from '@payload-config'
import Link from 'next/link'

export const metadata = { title: 'Booking Confirmed' }

export const dynamic = 'force-dynamic'

export default async function BookingConfirmedPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ ref?: string }>
}) {
  const { slug } = await params
  const { ref } = await searchParams
  const safeRef = ref && /^[A-Za-z0-9_-]{1,64}$/.test(ref) ? ref : null
  const payload = await getPayload({ config: await config })
  const { docs } = await payload.find({
    collection: 'classes',
    where: { slug: { equals: slug } },
    limit: 1,
  })
  const cls = docs[0]

  return (
    <div style={{ padding: '40px 0', maxWidth: 560 }}>
      <div className="pp-kicker">Confirmed</div>
      <h1>Payment successful!</h1>
      <p style={{ marginTop: 16, fontSize: 18 }}>
        {cls?.title ? (
          <>You&rsquo;re booked for <strong>{cls.title}</strong>.</>
        ) : (
          'Your booking is confirmed.'
        )}
      </p>
      <p style={{ color: 'var(--pp-muted)' }}>A confirmation has been sent to your email.</p>
      {safeRef && <p style={{ color: 'var(--pp-muted)' }}>Reference: #{safeRef}</p>}
      <p style={{ marginTop: 24 }}>
        <Link className="pp-btn" href="/classes">
          Browse more classes
        </Link>
      </p>
    </div>
  )
}

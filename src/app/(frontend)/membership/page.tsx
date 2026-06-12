import { getPayload } from 'payload'
import config from '@payload-config'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function MembershipPage() {
  const payload = await getPayload({ config: await config })
  const m = await payload.findGlobal({ slug: 'membership-page' })

  return (
    <div style={{ padding: '40px 0', maxWidth: 680 }}>
      <h1>{m.headline}</h1>
      {m.intro && <p style={{ color: 'var(--pp-muted)', lineHeight: 1.7, maxWidth: 560 }}>{m.intro}</p>}

      <div className="pp-membership-price">
        <div className="pp-membership-price-label">{m.priceLabel}</div>
        <div className="pp-membership-price-sub">per member, billed monthly</div>
      </div>

      {m.benefits && m.benefits.length > 0 && (
        <>
          <h2 style={{ fontSize: 20, marginBottom: 16 }}>What&apos;s included</h2>
          <ul className="pp-benefits-grid">
            {m.benefits.map((b, i) => (
              <li key={i}>{b.item}</li>
            ))}
          </ul>
        </>
      )}

      {/* Membership requires staff approval — this is a request, not self-serve signup. */}
      <a className="pp-btn" href="mailto:getcreative@portsidepottery.com?subject=Membership">
        Ask about membership
      </a>
      <p style={{ marginTop: 16 }}>
        <Link href="/membership/cancel" style={{ color: 'var(--pp-muted)', fontSize: 14 }}>
          Cancel my membership
        </Link>
      </p>
    </div>
  )
}

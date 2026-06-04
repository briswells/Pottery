import { getPayload } from 'payload'
import config from '@payload-config'

export default async function MembershipPage() {
  const payload = await getPayload({ config: await config })
  const m = await payload.findGlobal({ slug: 'membership-page' })

  return (
    <div style={{ padding: '40px 0', maxWidth: 640 }}>
      <h1>{m.headline}</h1>
      {m.intro && <p style={{ color: 'var(--pp-muted)' }}>{m.intro}</p>}
      <p style={{ fontSize: 28, fontWeight: 700, color: 'var(--pp-terracotta)' }}>{m.priceLabel}</p>
      <ul>
        {m.benefits?.map((b, i) => <li key={i}>{b.item}</li>)}
      </ul>
      <a className="pp-btn" href="mailto:getcreative@portsidepottery.com?subject=Membership">Ask about membership</a>
    </div>
  )
}

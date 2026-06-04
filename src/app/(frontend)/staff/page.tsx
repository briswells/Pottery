import { getPayload } from 'payload'
import config from '@payload-config'

export default async function StaffPage() {
  const payload = await getPayload({ config: await config })
  const { docs } = await payload.find({
    collection: 'users',
    where: { showOnStaffPage: { equals: true } },
    sort: 'order',
    limit: 50,
  })

  return (
    <div style={{ padding: '40px 0' }}>
      <h1>Meet the Staff</h1>
      <div style={{ display: 'grid', gap: 28, marginTop: 24 }}>
        {docs.map((u) => (
          <article key={u.id}>
            <h2 style={{ marginBottom: 2 }}>{u.name}</h2>
            {u.title && <div className="pp-kicker">{u.title}</div>}
            {u.bio && <p style={{ color: 'var(--pp-muted)' }}>{u.bio}</p>}
          </article>
        ))}
      </div>
    </div>
  )
}

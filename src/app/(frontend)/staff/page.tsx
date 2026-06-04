import { getPayload } from 'payload'
import config from '@payload-config'
import { mediaUrl, mediaAlt } from '../../../lib/media'

export default async function StaffPage() {
  const payload = await getPayload({ config: await config })
  const { docs } = await payload.find({
    collection: 'users',
    where: { showOnStaffPage: { equals: true } },
    sort: 'order',
    limit: 50,
    depth: 2,
  })

  return (
    <div style={{ padding: '40px 0' }}>
      <h1>Meet the Staff</h1>
      <div className="pp-staff-grid">
        {docs.map((u) => {
          const photoUrl = mediaUrl(u.photo, 'card')
          const photoAlt = mediaAlt(u.photo)
          return (
            <article key={u.id} className="pp-staff-card">
              <div className="pp-avatar">
                {photoUrl && (
                  <img src={photoUrl} alt={photoAlt || u.name} loading="lazy" />
                )}
              </div>
              <h2>{u.name}</h2>
              {u.title && <div className="pp-kicker">{u.title}</div>}
              {u.bio && <p>{u.bio}</p>}
            </article>
          )
        })}
      </div>
    </div>
  )
}

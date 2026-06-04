import { getPayload } from 'payload'
import config from '@payload-config'
import { mediaUrl, mediaAlt, mediaAspect } from '../../../lib/media'

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
          const aspect = mediaAspect(u.photo)
          return (
            <article key={u.id} className="pp-staff-card">
              {photoUrl && (
                <div
                  className="pp-staff-photo"
                  style={{ aspectRatio: aspect ? String(aspect) : '4 / 3' }}
                >
                  <img src={photoUrl} alt={photoAlt || u.name} loading="lazy" />
                </div>
              )}
              <div className="pp-staff-body">
                <h2>{u.name}</h2>
                {u.title && <div className="pp-kicker">{u.title}</div>}
                {u.bio && <p>{u.bio}</p>}
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}

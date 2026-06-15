import type { AdminViewServerProps } from 'payload'
import { DefaultTemplate } from '@payloadcms/next/templates'
import { Gutter, Link } from '@payloadcms/ui'
import { redirect } from 'next/navigation'

import { scheduleSummary } from '../../lib/schedule'
import { occupiedSeats } from '../../lib/occupancy'
import type { ClassInstance } from '../../payload-types'

const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 8px',
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '.5px',
  color: 'var(--theme-elevation-500)',
  borderBottom: '2px solid var(--theme-elevation-150)',
}
const td: React.CSSProperties = {
  padding: '11px 8px',
  borderBottom: '1px solid var(--theme-elevation-100)',
  fontSize: 14,
}

function classTitle(inst: ClassInstance): string {
  if (inst.label) return inst.label
  if (inst.class && typeof inst.class === 'object' && inst.class.title) return inst.class.title
  return 'Class'
}

function statusPill(status: string) {
  const paid = status === 'paid'
  return (
    <span
      style={{
        padding: '2px 8px',
        borderRadius: 20,
        fontSize: 12,
        background: paid ? 'var(--theme-success-100)' : 'var(--theme-warning-100)',
        color: paid ? 'var(--theme-success-800)' : 'var(--theme-warning-800)',
      }}
    >
      {paid ? 'Paid' : 'Pending'}
    </span>
  )
}

export default async function MyClassRoster({ initPageResult, params, searchParams }: AdminViewServerProps) {
  const { req, permissions, visibleEntities, locale } = initPageResult
  const { user, payload } = req
  if (!user || user.collection !== 'users') redirect('/admin/login')

  const wrap = (children: React.ReactNode) => (
    <DefaultTemplate
      i18n={req.i18n}
      locale={locale}
      params={params}
      payload={payload}
      permissions={permissions}
      searchParams={searchParams}
      user={user}
      visibleEntities={visibleEntities}
    >
      <Gutter>
        <Link
          href="/admin/my-classes"
          prefetch={false}
          style={{ color: 'var(--theme-elevation-500)', fontSize: 13, textDecoration: 'none' }}
        >
          ← Back to my classes
        </Link>
        {children}
      </Gutter>
    </DefaultTemplate>
  )

  // Path is /my-classes/:id, delivered as params.segments = ['my-classes', '<id>'].
  const rawSegments = params?.segments
  const segments = Array.isArray(rawSegments) ? rawSegments : rawSegments ? [rawSegments] : []
  const id = segments[segments.length - 1]

  let instance: ClassInstance | null = null
  try {
    instance = id
      ? await payload.findByID({ collection: 'class-instances', id, depth: 1, overrideAccess: false, user })
      : null
  } catch {
    instance = null
  }

  // Defense in depth: only the assigned instructor may view this roster.
  const instructorId =
    instance && instance.instructor && typeof instance.instructor === 'object'
      ? instance.instructor.id
      : instance?.instructor
  if (!instance || instructorId !== user.id) {
    return wrap(<p style={{ marginTop: 16 }}>Class not found.</p>)
  }

  const occupied = await occupiedSeats(payload, instance.id)
  const capacity = instance.capacity ?? 0
  const remaining = Math.max(0, capacity - occupied)

  // Bookings read access is admin-only; we've already scoped to this instructor's
  // own instance above, so overrideAccess is safe and required here.
  const { docs: bookings } = await payload.find({
    collection: 'bookings',
    where: { and: [{ classInstance: { equals: instance.id } }, { status: { in: ['paid', 'pending'] } }] },
    sort: 'customerName',
    limit: 0,
    depth: 0,
    overrideAccess: true,
  })

  return wrap(
    <div style={{ marginTop: 10 }}>
      <h1 style={{ marginBottom: 4 }}>{classTitle(instance)}</h1>
      <div style={{ color: 'var(--theme-elevation-500)', fontSize: 13 }}>
        {scheduleSummary(instance)}
        {instance.location ? ` · ${instance.location}` : ''}
      </div>
      <div style={{ marginTop: 10, fontWeight: 600, color: 'var(--theme-success-700)' }}>
        {occupied} enrolled · {remaining} spots left
      </div>

      {bookings.length === 0 ? (
        <p style={{ marginTop: 18, color: 'var(--theme-elevation-500)' }}>No one is signed up yet.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 18 }}>
          <thead>
            <tr>
              <th style={th}>Name</th>
              <th style={th}>Email</th>
              <th style={th}>Phone</th>
              <th style={th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {bookings.map((b) => (
              <tr key={b.id}>
                <td style={{ ...td, fontWeight: 600 }}>{b.customerName}</td>
                <td style={td}>{b.customerEmail}</td>
                <td style={td}>{b.customerPhone || '—'}</td>
                <td style={td}>{statusPill(b.status)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>,
  )
}

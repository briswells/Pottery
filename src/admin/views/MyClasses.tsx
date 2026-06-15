import type { AdminViewServerProps } from 'payload'
import { DefaultTemplate } from '@payloadcms/next/templates'
import { Gutter, Link } from '@payloadcms/ui'
import { redirect } from 'next/navigation'

import { scheduleSummary } from '../../lib/schedule'
import { occupiedSeats } from '../../lib/occupancy'
import { splitByTiming, todayKey } from '../../lib/myClasses'
import { MyClassesTabs } from './MyClassesTabs'
import type { ClassInstance } from '../../payload-types'

const cardStyle: React.CSSProperties = {
  display: 'block',
  background: 'var(--theme-elevation-0)',
  border: '1px solid var(--theme-elevation-150)',
  borderRadius: 8,
  padding: 14,
  marginBottom: 10,
  textDecoration: 'none',
  color: 'inherit',
}

function classTitle(inst: ClassInstance): string {
  if (inst.label) return inst.label
  if (inst.class && typeof inst.class === 'object' && inst.class.title) return inst.class.title
  return 'Class'
}

export default async function MyClasses({ initPageResult, params, searchParams }: AdminViewServerProps) {
  const { req, permissions, visibleEntities, locale } = initPageResult
  const { user, payload } = req
  if (!user || user.collection !== 'users') redirect('/admin/login')

  // Scoped to this instructor by the collection's read access (overrideAccess: false + user).
  const { docs } = await payload.find({
    collection: 'class-instances',
    where: { and: [{ instructor: { equals: user.id } }, { status: { not_equals: 'cancelled' } }] },
    depth: 1,
    limit: 0,
    sort: 'startDate',
    overrideAccess: false,
    user,
  })

  const { upcoming, past } = splitByTiming(docs, todayKey(new Date()))

  const renderSection = async (rows: ClassInstance[], emptyText: string) => {
    if (rows.length === 0) {
      return <p style={{ color: 'var(--theme-elevation-500)' }}>{emptyText}</p>
    }
    const cards = await Promise.all(
      rows.map(async (inst) => {
        const occupied = await occupiedSeats(payload, inst.id)
        const capacity = inst.capacity ?? 0
        const full = capacity > 0 && occupied >= capacity
        const pillStyle: React.CSSProperties = {
          display: 'inline-block',
          marginTop: 8,
          padding: '3px 10px',
          borderRadius: 20,
          fontSize: 13,
          background: full ? 'var(--theme-warning-100)' : 'var(--theme-success-100)',
          color: full ? 'var(--theme-warning-800)' : 'var(--theme-success-800)',
        }
        return (
          <Link key={inst.id} href={`/admin/my-classes/${inst.id}`} prefetch={false} style={cardStyle}>
            <div style={{ fontWeight: 600, fontSize: 15 }}>{classTitle(inst)}</div>
            <div style={{ color: 'var(--theme-elevation-500)', fontSize: 13, marginTop: 4 }}>
              {scheduleSummary(inst)}
            </div>
            <span style={pillStyle}>
              {capacity > 0
                ? `${occupied} / ${capacity}${full ? ' full' : ' enrolled'}`
                : `${occupied} enrolled`}
            </span>
          </Link>
        )
      }),
    )
    return <div>{cards}</div>
  }

  const upcomingNode = await renderSection(upcoming, 'You have no upcoming classes.')
  const pastNode = await renderSection(past, 'No past classes.')

  return (
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
        <h1 style={{ marginBottom: 'var(--base)' }}>My Classes</h1>
        <MyClassesTabs upcoming={upcomingNode} past={pastNode} />
      </Gutter>
    </DefaultTemplate>
  )
}

import { getPayload } from 'payload'
import config from '@payload-config'
import Link from 'next/link'
import { expandSessions, monthGrid, formatTime } from '../../../lib/schedule'

export const dynamic = 'force-dynamic'

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEKDAY_HEADS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

interface Chip { instanceId: number | string; slug: string; title: string; time: string }

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { month: monthParam } = await searchParams
  const now = new Date()
  const m = /^(\d{4})-(\d{2})$/.exec(monthParam ?? '')
  const year = m ? Number(m[1]) : now.getUTCFullYear()
  const month = m ? Number(m[2]) : now.getUTCMonth() + 1 // 1-based

  const grid = monthGrid(year, month)
  const gridStart = new Date(`${grid[0][0]}T00:00:00.000Z`)
  const gridEnd = new Date(`${grid[grid.length - 1][6]}T23:59:59.000Z`)

  const payload = await getPayload({ config: await config })
  const { docs: instances } = await payload.find({
    collection: 'class-instances',
    where: { status: { equals: 'published' } },
    // Generous for a boutique studio; sessions beyond this would silently drop
    // from the calendar — revisit (paginate/warn) if the catalog ever grows.
    limit: 500,
    depth: 2,
  })

  // Bucket session chips by "YYYY-MM-DD".
  const byDay = new Map<string, Chip[]>()
  for (const inst of instances) {
    const cls = typeof inst.class === 'object' && inst.class ? inst.class : null
    if (!cls || !cls.slug) continue
    const sessions = expandSessions(
      { startDate: inst.startDate as string ?? '', endDate: (inst.endDate as string | null | undefined) ?? null, daysOfWeek: inst.daysOfWeek as string[] | null, skipDates: inst.skipDates as { date: string }[] | null },
      gridStart,
      gridEnd,
    )
    for (const day of sessions) {
      const chip: Chip = { instanceId: inst.id, slug: cls.slug as string, title: cls.title, time: inst.startTime ? formatTime(inst.startTime as string) : '' }
      const list = byDay.get(day) ?? []
      list.push(chip)
      byDay.set(day, list)
    }
  }

  const prev = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`
  const next = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`

  return (
    <div style={{ padding: '40px 0' }}>
      <p style={{ marginBottom: 16 }}>
        <Link href="/classes">← Back to classes</Link>
      </p>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1>{MONTH_NAMES[month - 1]} {year}</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link className="pp-btn" href={`/schedule?month=${prev}`}>← Prev</Link>
          <Link className="pp-btn" href={`/schedule?month=${next}`}>Next →</Link>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginTop: 16 }}>
        {WEEKDAY_HEADS.map((d) => (
          <div key={d} style={{ fontWeight: 600, textAlign: 'center', padding: 4 }}>{d}</div>
        ))}
        {grid.flat().map((day) => {
          const inMonth = Number(day.slice(5, 7)) === month
          const chips = byDay.get(day) ?? []
          return (
            <div key={day} style={{ minHeight: 96, border: '1px solid var(--pp-border, #d9cdbf)', borderRadius: 4, padding: 4, opacity: inMonth ? 1 : 0.45 }}>
              <div style={{ fontSize: 12, color: 'var(--pp-muted)' }}>{Number(day.slice(8, 10))}</div>
              <div style={{ display: 'grid', gap: 2, marginTop: 2 }}>
                {chips.map((c, i) => (
                  <Link key={`${c.instanceId}-${i}`} href={`/classes/${c.slug}/signup/${c.instanceId}`}
                    style={{ fontSize: 11, background: 'var(--pp-accent, #A8502F)', color: '#fff', borderRadius: 3, padding: '2px 4px', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.time && `${c.time} `}{c.title}
                  </Link>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button, toast } from '@payloadcms/ui'

type Option = { id: number; label: string }
type PreviewDate = { date: string; conflict: boolean; checked: boolean }

const WEEKDAYS = [
  { value: 'SU', label: 'Sunday' }, { value: 'MO', label: 'Monday' }, { value: 'TU', label: 'Tuesday' },
  { value: 'WE', label: 'Wednesday' }, { value: 'TH', label: 'Thursday' }, { value: 'FR', label: 'Friday' },
  { value: 'SA', label: 'Saturday' },
]
const ORDINALS: { value: string; label: string }[] = [
  { value: '1', label: '1st' }, { value: '2', label: '2nd' }, { value: '3', label: '3rd' },
  { value: '4', label: '4th' }, { value: '5', label: '5th' }, { value: 'last', label: 'last' },
]

const inputStyle: React.CSSProperties = {
  padding: '8px 10px',
  border: '1px solid var(--theme-elevation-150)',
  borderRadius: 4,
  background: 'var(--theme-input-bg)',
  color: 'var(--theme-text)',
}
const rowStyle: React.CSSProperties = { display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }
const labelStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }

function todayYmd(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
}

function prettyDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  })
}

export function ScheduleSeriesForm() {
  const [classes, setClasses] = useState<Option[]>([])
  const [classDefaults, setClassDefaults] = useState<
    Record<string, { priceCents?: number | null; capacity?: number | null }>
  >({})
  const [instructors, setInstructors] = useState<Option[]>([])
  const [classId, setClassId] = useState('')
  const [instructorId, setInstructorId] = useState('')
  const [startTime, setStartTime] = useState('18:00')
  const [endTime, setEndTime] = useState('20:00')
  const [label, setLabel] = useState('')
  const [capacity, setCapacity] = useState('')
  const [price, setPrice] = useState('')

  const [repeats, setRepeats] = useState<'weekly' | 'biweekly' | 'monthly'>('weekly')
  const [weekday, setWeekday] = useState('TU')
  const [monthlyMode, setMonthlyMode] = useState<'ordinal' | 'day'>('ordinal')
  const [dayOfMonth, setDayOfMonth] = useState('1')
  const [ordinals, setOrdinals] = useState<string[]>(['1'])

  const [from, setFrom] = useState(todayYmd())
  const [until, setUntil] = useState('')

  const [preview, setPreview] = useState<PreviewDate[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ created: number; skipped: { date: string; reason: string }[] } | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const [clsRes, usersRes] = await Promise.all([
          fetch('/api/classes?limit=200&depth=0&sort=title', { credentials: 'include' }),
          fetch('/api/users?limit=200&depth=0&sort=name', { credentials: 'include' }),
        ])
        if (clsRes.ok) {
          const data = await clsRes.json()
          const docs: { id: number; title: string; defaultPriceCents?: number | null; defaultCapacity?: number | null }[] =
            data.docs
          setClasses(docs.map((c) => ({ id: c.id, label: c.title })))
          setClassDefaults(
            Object.fromEntries(docs.map((c) => [String(c.id), { priceCents: c.defaultPriceCents, capacity: c.defaultCapacity }])),
          )
        }
        if (usersRes.ok) {
          const data = await usersRes.json()
          setInstructors(
            data.docs.map((u: { id: number; name?: string; email: string }) => ({ id: u.id, label: u.name || u.email })),
          )
        }
      } catch {
        toast.error("Couldn't load classes — refresh and try again.")
      }
    })()
  }, [])

  const rule = useMemo(() => {
    if (repeats === 'weekly' || repeats === 'biweekly') {
      return { kind: 'weekly', weekday, interval: repeats === 'weekly' ? 1 : 2 }
    }
    if (monthlyMode === 'day') return { kind: 'dayOfMonth', day: Number(dayOfMonth) }
    return { kind: 'ordinalWeekday', weekday, ordinals: ordinals.map((o) => (o === 'last' ? 'last' : Number(o))) }
  }, [repeats, weekday, monthlyMode, dayOfMonth, ordinals])

  // Any input change invalidates the current preview — the create button only
  // ever acts on dates the admin has just seen. Reset during render (React's
  // "adjusting state when a prop changes" pattern) rather than in an effect,
  // since setState synchronously inside an effect body is a lint error here.
  const previewKey = JSON.stringify({ classId, rule, from, until })
  const [prevPreviewKey, setPrevPreviewKey] = useState(previewKey)
  if (previewKey !== prevPreviewKey) {
    setPrevPreviewKey(previewKey)
    setPreview(null)
    setDone(null)
  }

  const runPreview = async () => {
    if (!classId) return toast.error('Pick a class first.')
    if (!until) return toast.error('Pick an until date.')
    setBusy(true)
    try {
      const res = await fetch('/api/class-instances/series-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classId: Number(classId), rule, from, until }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Preview failed.')
      if (data.dates.length === 0) {
        toast.error('That pattern makes no dates in the range.')
        setPreview(null)
      } else {
        setPreview(data.dates.map((d: { date: string; conflict: boolean }) => ({ ...d, checked: !d.conflict })))
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Preview failed.')
    }
    setBusy(false)
  }

  const runCreate = async () => {
    if (!preview) return
    if (!instructorId) return toast.error('Pick an instructor.')
    const dates = preview.filter((d) => d.checked).map((d) => d.date)
    if (dates.length === 0) return toast.error('No dates are checked.')
    if (!window.confirm(`Create and publish ${dates.length} class${dates.length === 1 ? '' : 'es'}?`)) return
    setBusy(true)
    try {
      const res = await fetch('/api/class-instances/series-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          classId: Number(classId),
          instructorId: Number(instructorId),
          dates,
          startTime,
          endTime,
          ...(label ? { label } : {}),
          ...(capacity !== '' ? { capacity: Number(capacity) } : {}),
          ...(price !== '' ? { priceCents: Math.round(Number(price) * 100) } : {}),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Create failed.')
      setDone(data)
      setPreview(null)
      toast.success(`Created ${data.created} class${data.created === 1 ? '' : 'es'}.`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Create failed.')
    }
    setBusy(false)
  }

  const toggle = (date: string) =>
    setPreview((p) => (p ? p.map((d) => (d.date === date ? { ...d, checked: !d.checked } : d)) : p))

  const checkedCount = preview?.filter((d) => d.checked).length ?? 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 720 }}>
      <div style={rowStyle}>
        <label style={labelStyle}>
          Class
          <select
            style={inputStyle}
            value={classId}
            onChange={(e) => {
              const id = e.target.value
              setClassId(id)
              // Show the picked class's price/capacity so what gets published is
              // visible up front — both stay editable.
              const d = classDefaults[id]
              setCapacity(d?.capacity != null ? String(d.capacity) : '')
              setPrice(d?.priceCents != null ? String(d.priceCents / 100) : '')
            }}
          >
            <option value="">Choose…</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </label>
        <label style={labelStyle}>
          Instructor
          <select style={inputStyle} value={instructorId} onChange={(e) => setInstructorId(e.target.value)}>
            <option value="">Choose…</option>
            {instructors.map((u) => (
              <option key={u.id} value={u.id}>{u.label}</option>
            ))}
          </select>
        </label>
        <label style={labelStyle}>
          Title override (optional)
          <input style={inputStyle} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Defaults to the class name" />
        </label>
      </div>

      <div style={rowStyle}>
        <label style={labelStyle}>
          Starts
          <input style={inputStyle} value={startTime} onChange={(e) => setStartTime(e.target.value)} placeholder="18:00" />
        </label>
        <label style={labelStyle}>
          Ends
          <input style={inputStyle} value={endTime} onChange={(e) => setEndTime(e.target.value)} placeholder="20:00" />
        </label>
        <label style={labelStyle}>
          Capacity
          <input style={{ ...inputStyle, width: 90 }} type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="from class" />
        </label>
        <label style={labelStyle}>
          Price $
          <input style={{ ...inputStyle, width: 90 }} type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="from class" />
        </label>
      </div>

      <div style={rowStyle}>
        <label style={labelStyle}>
          Repeats
          <select style={inputStyle} value={repeats} onChange={(e) => setRepeats(e.target.value as typeof repeats)}>
            <option value="weekly">Every week</option>
            <option value="biweekly">Every other week</option>
            <option value="monthly">Monthly</option>
          </select>
        </label>

        {repeats === 'monthly' && (
          <label style={labelStyle}>
            On
            <select style={inputStyle} value={monthlyMode} onChange={(e) => setMonthlyMode(e.target.value as typeof monthlyMode)}>
              <option value="ordinal">a chosen weekday (e.g. 2nd Tuesday)</option>
              <option value="day">a day of the month (e.g. the 1st)</option>
            </select>
          </label>
        )}

        {(repeats !== 'monthly' || monthlyMode === 'ordinal') && (
          <label style={labelStyle}>
            Weekday
            <select style={inputStyle} value={weekday} onChange={(e) => setWeekday(e.target.value)}>
              {WEEKDAYS.map((w) => (
                <option key={w.value} value={w.value}>{w.label}</option>
              ))}
            </select>
          </label>
        )}

        {repeats === 'monthly' && monthlyMode === 'ordinal' && (
          <div style={{ ...labelStyle, flexDirection: 'column' }}>
            Occurrences
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {ORDINALS.map((o) => (
                <label key={o.value} style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={ordinals.includes(o.value)}
                    onChange={(e) =>
                      setOrdinals((prev) => (e.target.checked ? [...prev, o.value] : prev.filter((x) => x !== o.value)))
                    }
                  />
                  {o.label}
                </label>
              ))}
            </div>
          </div>
        )}

        {repeats === 'monthly' && monthlyMode === 'day' && (
          <label style={labelStyle}>
            Day of month
            <input style={{ ...inputStyle, width: 80 }} type="number" min={1} max={31} value={dayOfMonth} onChange={(e) => setDayOfMonth(e.target.value)} />
          </label>
        )}
      </div>

      <div style={rowStyle}>
        <label style={labelStyle}>
          From
          <input style={inputStyle} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label style={labelStyle}>
          Until
          <input style={inputStyle} type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
        </label>
        <div style={{ alignSelf: 'flex-end' }}>
          <Button size="small" buttonStyle="secondary" onClick={runPreview} disabled={busy}>
            Preview dates
          </Button>
        </div>
      </div>

      {preview && (
        <div>
          <table style={{ borderCollapse: 'collapse' }}>
            <tbody>
              {preview.map((d) => (
                <tr key={d.date}>
                  <td style={{ padding: '6px 10px 6px 0' }}>
                    <input type="checkbox" checked={d.checked} onChange={() => toggle(d.date)} />
                  </td>
                  <td style={{ padding: '6px 12px 6px 0', fontSize: 14 }}>{prettyDate(d.date)}</td>
                  <td style={{ padding: '6px 0', fontSize: 13, color: 'var(--theme-warning-600, #9a6700)' }}>
                    {d.conflict ? 'already scheduled — left unchecked' : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop: 12 }}>
            <Button size="small" onClick={runCreate} disabled={busy || checkedCount === 0}>
              Create {checkedCount} class{checkedCount === 1 ? '' : 'es'}
            </Button>
          </div>
        </div>
      )}

      {done && (
        <p role="status" style={{ fontSize: 14 }}>
          Created {done.created} class{done.created === 1 ? '' : 'es'}
          {done.skipped.length > 0 && <> · skipped {done.skipped.map((s) => `${s.date} (${s.reason})`).join(', ')}</>}
          {' — '}
          <a href="/admin/collections/class-instances">back to Class Instances</a>
        </p>
      )}
    </div>
  )
}

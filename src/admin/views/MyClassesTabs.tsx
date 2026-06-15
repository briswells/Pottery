'use client'

import { useState } from 'react'
import type { ReactNode } from 'react'

/**
 * Client wrapper that toggles between the (server-rendered) Upcoming and Past
 * sections. Both nodes are rendered on the server and passed in as props; this
 * component only controls which one is visible.
 */
export function MyClassesTabs({ upcoming, past }: { upcoming: ReactNode; past: ReactNode }) {
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming')

  const tabButton = (key: 'upcoming' | 'past', label: string) => (
    <button
      type="button"
      onClick={() => setTab(key)}
      style={{
        padding: '6px 14px',
        borderRadius: 4,
        border: 'none',
        cursor: 'pointer',
        fontSize: 14,
        background: tab === key ? 'var(--theme-elevation-800)' : 'var(--theme-elevation-100)',
        color: tab === key ? 'var(--theme-elevation-0)' : 'var(--theme-elevation-800)',
      }}
    >
      {label}
    </button>
  )

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 'var(--base)' }}>
        {tabButton('upcoming', 'Upcoming')}
        {tabButton('past', 'Past')}
      </div>
      <div>{tab === 'upcoming' ? upcoming : past}</div>
    </div>
  )
}

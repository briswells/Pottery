'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, toast } from '@payloadcms/ui'

export function SubscribersToolbar({ initialSearch }: { initialSearch?: string }) {
  const router = useRouter()
  const [q, setQ] = useState(initialSearch ?? '')
  const [email, setEmail] = useState('')
  const [firstName, setFirstName] = useState('')
  const [busy, setBusy] = useState(false)

  const search = (e: React.FormEvent) => {
    e.preventDefault()
    router.push(q ? `/admin/newsletter-subscribers?q=${encodeURIComponent(q)}` : '/admin/newsletter-subscribers')
  }

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const res = await fetch('/api/newsletter-subscribers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, firstName }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Add failed.')
      toast.success(`${email} added to the list.`)
      setEmail('')
      setFirstName('')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Add failed.')
    }
    setBusy(false)
  }

  const row: React.CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }
  const input: React.CSSProperties = {
    padding: '8px 10px',
    border: '1px solid var(--theme-elevation-150)',
    borderRadius: 4,
    background: 'var(--theme-input-bg)',
    color: 'var(--theme-text)',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
      <form onSubmit={search} style={row}>
        <input style={input} type="search" placeholder="Search by email" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button size="small" buttonStyle="secondary" onClick={search}>Search</Button>
      </form>
      <form onSubmit={add} style={row}>
        <input style={input} type="email" required placeholder="new@subscriber.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input style={input} type="text" placeholder="First name (optional)" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        <Button size="small" onClick={add} disabled={busy}>Add subscriber</Button>
      </form>
    </div>
  )
}

export function UnsubscribeButton({ id, email }: { id: number; email: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  const unsubscribe = async () => {
    if (!window.confirm(`Unsubscribe ${email}? They'll stop receiving newsletters.`)) return
    setBusy(true)
    try {
      const res = await fetch('/api/newsletter-subscribers/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Unsubscribe failed.')
      toast.success(`${email} unsubscribed.`)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unsubscribe failed.')
    }
    setBusy(false)
  }

  return (
    <Button size="small" buttonStyle="secondary" onClick={unsubscribe} disabled={busy}>
      Unsubscribe
    </Button>
  )
}

'use client'
import { useState } from 'react'

export function FiringRequestForm() {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setBusy(true); setMsg(null)
    try {
      const res = await fetch('/api/firings', { method: 'POST', body: new FormData(e.currentTarget) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Submission failed')
      setDone(true)
      setMsg('Request received — we’ll review the size and email you an invoice.')
    } catch (err: any) {
      setMsg(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (done) return <p style={{ marginTop: 24, fontWeight: 600 }}>{msg}</p>

  return (
    <form onSubmit={submit} style={{ marginTop: 24, display: 'grid', gap: 12, maxWidth: 480 }}>
      <input required name="name" placeholder="Your name" />
      <input required type="email" name="email" placeholder="Email" />
      <input name="phone" placeholder="Phone (optional)" />
      <textarea required name="description" placeholder="Describe your piece(s)" rows={3} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        <input type="number" step="0.1" min="0" name="heightIn" placeholder="Height (in)" />
        <input type="number" step="0.1" min="0" name="widthIn" placeholder="Width (in)" />
        <input type="number" step="0.1" min="0" name="depthIn" placeholder="Depth (in)" />
      </div>
      <input type="number" min="1" name="quantity" placeholder="Quantity" defaultValue={1} />
      <label style={{ fontSize: 14, color: 'var(--pp-muted)' }}>
        Photo (optional)
        <input type="file" name="photo" accept="image/*" style={{ display: 'block', marginTop: 4 }} />
      </label>
      <textarea name="notes" placeholder="Anything else? (optional)" rows={2} />
      <button className="pp-btn" type="submit" disabled={busy}>
        {busy ? 'Sending…' : 'Request a firing'}
      </button>
      {msg && <p>{msg}</p>}
    </form>
  )
}

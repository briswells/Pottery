'use client'
import { useState } from 'react'

export default function CancelRequestPage() {
  const [email, setEmail] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/membership/cancel/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json()
      setMsg(data.message ?? 'If a membership matches that email, we’ve sent a cancellation link.')
    } catch {
      setMsg('Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ padding: '40px 0', maxWidth: 480 }}>
      <h1>Cancel your membership</h1>
      <p style={{ color: 'var(--pp-muted)' }}>
        Enter the email on your membership and we’ll send you a one-time link to confirm cancellation.
      </p>
      <form onSubmit={submit} style={{ display: 'grid', gap: 10, marginTop: 16 }}>
        <input
          required
          type="email"
          className="pp-input"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button className="pp-btn" type="submit" disabled={busy}>
          {busy ? 'Sending…' : 'Send cancellation link'}
        </button>
      </form>
      {msg && <p style={{ marginTop: 16 }}>{msg}</p>}
    </div>
  )
}

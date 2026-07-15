'use client'
import { useState } from 'react'

export function ContactForm({ startedAt }: { startedAt: number }) {
  const [form, setForm] = useState({ name: '', email: '', message: '', website: '', subscribe: false })
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, startedAt }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Something went wrong.')
      setSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setBusy(false)
    }
  }

  if (sent) return <p role="status" style={{ marginTop: 24, fontWeight: 600 }}>Thanks — we&apos;ll get back to you soon.</p>

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 10, marginTop: 24, maxWidth: 480 }}>
      <input
        required
        className="pp-input"
        aria-label="Your name"
        placeholder="Your name"
        value={form.name}
        onChange={(e) => setForm({ ...form, name: e.target.value })}
      />
      <input
        required
        className="pp-input"
        type="email"
        aria-label="Email"
        placeholder="Email"
        value={form.email}
        onChange={(e) => setForm({ ...form, email: e.target.value })}
      />
      <textarea
        required
        className="pp-input"
        aria-label="Message"
        placeholder="How can we help?"
        rows={6}
        value={form.message}
        onChange={(e) => setForm({ ...form, message: e.target.value })}
      />
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
        <input
          type="checkbox"
          checked={form.subscribe}
          onChange={(e) => setForm({ ...form, subscribe: e.target.checked })}
        />
        Email me studio news &amp; new classes
      </label>
      {/* Honeypot: hidden off-screen, excluded from tab order; bots fill it, people can't. */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        style={{ position: 'absolute', left: '-9999px', height: 0, width: 0, opacity: 0 }}
        value={form.website}
        onChange={(e) => setForm({ ...form, website: e.target.value })}
      />
      <button className="pp-btn" type="submit" disabled={busy}>
        {busy ? 'Sending…' : 'Send message'}
      </button>
      {error && <p role="alert" style={{ color: '#b3261e' }}>{error}</p>}
    </form>
  )
}

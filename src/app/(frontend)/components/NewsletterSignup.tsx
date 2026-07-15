'use client'
import { useState } from 'react'

export function NewsletterSignup({ startedAt }: { startedAt: number }) {
  const [email, setEmail] = useState('')
  const [website, setWebsite] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/newsletter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, website, startedAt }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Something went wrong.')
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setBusy(false)
    }
  }

  if (done) {
    return (
      <p role="status" style={{ marginTop: 14, fontWeight: 600 }}>
        You&apos;re on the list!
      </p>
    )
  }

  return (
    <form onSubmit={submit} style={{ marginTop: 14 }} aria-label="Newsletter signup">
      <label htmlFor="pp-newsletter-email" style={{ display: 'block', fontSize: 14, marginBottom: 6 }}>
        Get studio news &amp; new classes
      </label>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          id="pp-newsletter-email"
          className="pp-input"
          type="email"
          required
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ flex: 1, minWidth: 0 }}
        />
        <button className="pp-btn" type="submit" disabled={busy}>
          {busy ? 'Joining…' : 'Join'}
        </button>
      </div>
      {/* Honeypot: hidden off-screen, excluded from tab order; bots fill it, people can't. */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        style={{ position: 'absolute', left: '-9999px', height: 0, width: 0, opacity: 0 }}
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
      />
      {error && (
        <p role="alert" style={{ color: '#ffb4a8', fontSize: 13, marginTop: 6 }}>
          {error}
        </p>
      )}
    </form>
  )
}

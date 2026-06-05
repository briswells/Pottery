'use client'
import { useEffect, useRef, useState } from 'react'

declare global {
  interface Window {
    Square?: any
  }
}

const SDK_URL =
  process.env.NEXT_PUBLIC_SQUARE_ENVIRONMENT === 'production'
    ? 'https://web.squarecdn.com/v1/square.js'
    : 'https://sandbox.web.squarecdn.com/v1/square.js'

export function MembershipForm({ priceLabel }: { priceLabel: string }) {
  const cardRef = useRef<any>(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', email: '', phone: '' })

  useEffect(() => {
    let cancelled = false

    async function initCard() {
      try {
        const payments = window.Square!.payments(
          process.env.NEXT_PUBLIC_SQUARE_APP_ID,
          process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID,
        )
        const card = await payments.card()
        if (cancelled) {
          await card.destroy()
          return
        }
        await card.attach('#membership-card')
        cardRef.current = card
        setReady(true)
      } catch {
        if (!cancelled) setMsg('The payment form could not be loaded. Please refresh and try again.')
      }
    }

    if (window.Square) {
      void initCard()
      return () => {
        cancelled = true
        void cardRef.current?.destroy()
      }
    }

    const script = document.createElement('script')
    script.src = SDK_URL
    script.onload = () => {
      if (!cancelled) void initCard()
    }
    script.onerror = () => {
      if (!cancelled) setMsg('The payment form could not be loaded. Please refresh and try again.')
    }
    document.body.appendChild(script)
    return () => {
      cancelled = true
      void cardRef.current?.destroy()
    }
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    try {
      if (!cardRef.current) throw new Error('Payment form is not ready yet. Please wait a moment and try again.')
      const result = await cardRef.current.tokenize()
      if (result.status !== 'OK') throw new Error('Card was not accepted')
      const res = await fetch('/api/membership', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, sourceId: result.token }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Signup failed')
      setMsg("You're a member! Check your email — see you at the studio.")
    } catch (err: any) {
      setMsg(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} style={{ marginTop: 24, display: 'grid', gap: 10, maxWidth: 380 }}>
      <input required placeholder="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      <input required type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      <input placeholder="Phone (optional)" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
      <div id="membership-card" />
      <button className="pp-btn" type="submit" disabled={!ready || busy}>
        {busy ? 'Processing…' : `Join — ${priceLabel}`}
      </button>
      {msg && <p>{msg}</p>}
    </form>
  )
}

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

export function BookingForm({ classId, priceLabel }: { classId: string | number; priceLabel: string }) {
  const cardRef = useRef<any>(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [form, setForm] = useState({ customerName: '', customerEmail: '', customerPhone: '' })

  useEffect(() => {
    const script = document.createElement('script')
    script.src = SDK_URL
    script.onload = async () => {
      const payments = window.Square.payments(
        process.env.NEXT_PUBLIC_SQUARE_APP_ID,
        process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID,
      )
      const card = await payments.card()
      await card.attach('#card-container')
      cardRef.current = card
      setReady(true)
    }
    document.body.appendChild(script)
    return () => {
      script.remove()
    }
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    try {
      const result = await cardRef.current.tokenize()
      if (result.status !== 'OK') throw new Error('Card was not accepted')
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classId, sourceId: result.token, ...form }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Booking failed')
      setMsg('Booked! Check your email for confirmation.')
    } catch (err: any) {
      setMsg(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} style={{ marginTop: 24, display: 'grid', gap: 10, maxWidth: 380 }}>
      <input
        required
        placeholder="Your name"
        value={form.customerName}
        onChange={(e) => setForm({ ...form, customerName: e.target.value })}
      />
      <input
        required
        type="email"
        placeholder="Email"
        value={form.customerEmail}
        onChange={(e) => setForm({ ...form, customerEmail: e.target.value })}
      />
      <input
        placeholder="Phone (optional)"
        value={form.customerPhone}
        onChange={(e) => setForm({ ...form, customerPhone: e.target.value })}
      />
      <div id="card-container" />
      <button className="pp-btn" type="submit" disabled={!ready || busy}>
        {busy ? 'Processing…' : `Book & pay ${priceLabel}`}
      </button>
      {msg && <p>{msg}</p>}
    </form>
  )
}

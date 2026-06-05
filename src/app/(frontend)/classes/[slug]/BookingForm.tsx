'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { WalletButtons } from './WalletButtons'

declare global {
  interface Window {
    Square?: any
  }
}

const SDK_URL =
  process.env.NEXT_PUBLIC_SQUARE_ENVIRONMENT === 'production'
    ? 'https://web.squarecdn.com/v1/square.js'
    : 'https://sandbox.web.squarecdn.com/v1/square.js'

export function BookingForm({
  classId,
  priceCents,
  priceLabel,
}: {
  classId: string | number
  priceCents: number
  priceLabel: string
}) {
  const cardRef = useRef<any>(null)
  const [payments, setPayments] = useState<any>(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [form, setForm] = useState({ customerName: '', customerEmail: '', customerPhone: '' })

  const formRef = useRef(form)
  useEffect(() => {
    formRef.current = form
  }, [form])

  // Single choke point for card + every wallet. Guard against a second submit
  // (e.g. tapping a wallet while a charge is in flight) so we never double-charge.
  const busyRef = useRef(false)

  const completeBooking = useCallback(
    async (sourceId: string) => {
      if (busyRef.current) return
      busyRef.current = true
      setBusy(true)
      setMsg(null)
      try {
        const f = formRef.current
        const res = await fetch('/api/bookings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            classId,
            sourceId,
            customerName: f.customerName,
            customerEmail: f.customerEmail,
            customerPhone: f.customerPhone,
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'Booking failed')
        setMsg('Booked! Check your email for confirmation.')
      } catch (err: any) {
        setMsg(err.message)
      } finally {
        setBusy(false)
        busyRef.current = false
      }
    },
    [classId],
  )

  useEffect(() => {
    let cancelled = false

    async function init() {
      try {
        const sq = window.Square!.payments(
          process.env.NEXT_PUBLIC_SQUARE_APP_ID,
          process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID,
        )
        const card = await sq.card()
        if (cancelled) {
          await card.destroy()
          return
        }
        await card.attach('#card-container')
        cardRef.current = card
        setPayments(sq)
        setReady(true)
      } catch {
        if (!cancelled) setMsg('The payment form could not be loaded. Please refresh and try again.')
      }
    }

    if (window.Square) {
      void init()
      return () => {
        cancelled = true
        void cardRef.current?.destroy()
      }
    }

    const script = document.createElement('script')
    script.src = SDK_URL
    script.onload = () => {
      if (!cancelled) void init()
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

  async function submitCard(e: React.FormEvent) {
    e.preventDefault()
    try {
      if (!cardRef.current) throw new Error('Payment form is not ready yet. Please wait a moment and try again.')
      const result = await cardRef.current.tokenize()
      if (result.status !== 'OK') throw new Error('Card was not accepted')
      await completeBooking(result.token)
    } catch (err: any) {
      setMsg(err.message)
    }
  }

  const hasIdentity = form.customerName.trim() !== '' && form.customerEmail.trim() !== ''

  return (
    <div style={{ marginTop: 24, maxWidth: 380 }}>
      <div style={{ display: 'grid', gap: 10 }}>
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
      </div>

      {payments &&
        (hasIdentity ? (
          <div style={{ marginTop: 12 }}>
            <WalletButtons
              payments={payments}
              priceCents={priceCents}
              referenceId={`booking-${classId}`}
              disabled={busy}
              onToken={completeBooking}
              onError={setMsg}
            />
          </div>
        ) : (
          <p style={{ marginTop: 12, fontSize: 13, color: 'var(--pp-muted)' }}>
            Enter your name and email above to pay with Apple Pay, Google Pay, or Cash App Pay.
          </p>
        ))}

      <div className="pp-or-divider">or pay with card</div>

      <form onSubmit={submitCard} style={{ display: 'grid', gap: 10 }}>
        <input
          placeholder="Phone (optional)"
          value={form.customerPhone}
          onChange={(e) => setForm({ ...form, customerPhone: e.target.value })}
        />
        <div id="card-container" />
        <button className="pp-btn" type="submit" disabled={!ready || busy}>
          {busy ? 'Processing…' : `Book & pay ${priceLabel}`}
        </button>
      </form>

      {msg && <p>{msg}</p>}
    </div>
  )
}

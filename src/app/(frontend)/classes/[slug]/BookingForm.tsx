'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
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

// Theme the Square card iframe to match the cream/terracotta brand. The Web
// Payments SDK only honors the selectors/properties below; the iframe is
// cross-origin so it cannot read our CSS variables — values are inlined.
const CARD_STYLE = {
  input: {
    color: '#2E2A26',
    fontFamily: 'Inter, system-ui, sans-serif',
    fontSize: '16px',
  },
  'input::placeholder': { color: '#6b5d52' },
  '.input-container': { borderColor: '#d9cdbf', borderRadius: '4px' },
  '.input-container.is-focus': { borderColor: '#A8502F' },
  '.input-container.is-error': { borderColor: '#b3261e' },
  '.message-text.is-error': { color: '#b3261e' },
  '.message-icon.is-error': { color: '#b3261e' },
}

const LOAD_ERROR = 'The payment form could not be loaded. Please refresh and try again.'

export function BookingForm({
  classId,
  slug,
  priceCents,
  priceLabel,
}: {
  classId: string | number
  slug: string
  priceCents: number
  priceLabel: string
}) {
  const router = useRouter()
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

  const hasIdentity = form.customerName.trim() !== '' && form.customerEmail.trim() !== ''

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
        // Leave the form locked (busy stays true) while the confirmation page
        // loads — this component unmounts on navigation, so no reset is needed.
        router.push(`/classes/${slug}/confirmed?ref=${data.bookingId}`)
      } catch (err: any) {
        setMsg(err.message)
        setBusy(false)
        busyRef.current = false
      }
    },
    [classId, slug, router],
  )

  // Effect A: load the SDK and create the payments instance (no card yet).
  useEffect(() => {
    let cancelled = false

    function makePayments() {
      try {
        const sq = window.Square!.payments(
          process.env.NEXT_PUBLIC_SQUARE_APP_ID,
          process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID,
        )
        if (!cancelled) setPayments(sq)
      } catch {
        if (!cancelled) setMsg(LOAD_ERROR)
      }
    }

    if (window.Square) {
      makePayments()
      return () => {
        cancelled = true
      }
    }

    const script = document.createElement('script')
    script.src = SDK_URL
    script.onload = () => {
      if (!cancelled) makePayments()
    }
    script.onerror = () => {
      if (!cancelled) setMsg(LOAD_ERROR)
    }
    document.body.appendChild(script)
    return () => {
      cancelled = true
    }
  }, [])

  // Effect B: attach the themed card only once the SDK is ready AND the
  // #card-container is rendered (i.e. identity entered). Re-runs if identity
  // is cleared/re-entered; cleanup destroys this run's card so none accumulate.
  useEffect(() => {
    if (!payments || !hasIdentity) return
    let cancelled = false
    let localCard: any = null

    async function attachCard() {
      try {
        const card = await payments.card({ style: CARD_STYLE })
        // Teardown already ran before the SDK resolved — destroy this orphan.
        if (cancelled) {
          await card.destroy()
          return
        }
        await card.attach('#card-container')
        localCard = card
        cardRef.current = card
        setReady(true)
      } catch {
        if (!cancelled) setMsg(LOAD_ERROR)
      }
    }

    void attachCard()
    return () => {
      cancelled = true
      void localCard?.destroy()
      if (cardRef.current === localCard) cardRef.current = null
      setReady(false)
    }
  }, [payments, hasIdentity])

  async function submitCard(e: React.FormEvent) {
    e.preventDefault()
    try {
      if (!cardRef.current)
        throw new Error('Payment form is not ready yet. Please wait a moment and try again.')
      const result = await cardRef.current.tokenize()
      if (result.status !== 'OK') throw new Error('Card was not accepted')
      await completeBooking(result.token)
    } catch (err: any) {
      setMsg(err.message)
    }
  }

  return (
    <div style={{ marginTop: 24, maxWidth: 380 }}>
      <div style={{ display: 'grid', gap: 10 }}>
        <input
          required
          className="pp-input"
          aria-label="Your name"
          placeholder="Your name"
          value={form.customerName}
          onChange={(e) => setForm({ ...form, customerName: e.target.value })}
        />
        <input
          required
          className="pp-input"
          type="email"
          aria-label="Email"
          placeholder="Email"
          value={form.customerEmail}
          onChange={(e) => setForm({ ...form, customerEmail: e.target.value })}
        />
      </div>

      {!hasIdentity ? (
        <p style={{ marginTop: 12, fontSize: 13, color: 'var(--pp-muted)' }}>
          Enter your name and email to continue to payment.
        </p>
      ) : (
        <>
          {payments && (
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
          )}

          <div className="pp-or-divider">or pay with card</div>

          <form onSubmit={submitCard} style={{ display: 'grid', gap: 10 }}>
            <input
              className="pp-input"
              aria-label="Phone (optional)"
              placeholder="Phone (optional)"
              value={form.customerPhone}
              onChange={(e) => setForm({ ...form, customerPhone: e.target.value })}
            />
            <div id="card-container" />
            <button className="pp-btn" type="submit" disabled={!ready || busy}>
              {busy ? 'Processing…' : `Book & pay ${priceLabel}`}
            </button>
          </form>
        </>
      )}

      {msg && <p>{msg}</p>}
    </div>
  )
}

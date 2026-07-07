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
// NB: do NOT set `fontFamily` here — Square's card iframe rejects arbitrary
// font stacks (only its own hosted allowlist is valid) and throws
// InvalidStylesError, which kills the whole card field. Let it use its default.
const CARD_STYLE = {
  input: {
    color: '#2E2A26',
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
  classInstanceId,
  slug,
  priceCents,
  priceLabel,
}: {
  classInstanceId: string | number
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
  const [couponInput, setCouponInput] = useState('')
  const [applied, setApplied] = useState<{
    code: string
    discountCents: number
    finalCents: number
  } | null>(null)
  const [couponMsg, setCouponMsg] = useState<string | null>(null)

  const effectiveCents = applied ? applied.finalCents : priceCents
  const effectiveLabel = `$${(effectiveCents / 100).toFixed(2)}`
  const isFree = applied !== null && applied.finalCents === 0

  const formRef = useRef(form)
  useEffect(() => {
    formRef.current = form
  }, [form])

  const appliedRef = useRef(applied)
  useEffect(() => {
    appliedRef.current = applied
  }, [applied])

  async function applyCoupon() {
    setCouponMsg(null)
    const code = couponInput.trim()
    if (!code) return
    try {
      const res = await fetch('/api/coupons/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, classInstanceId, email: formRef.current.customerEmail }),
      })
      const data = await res.json()
      if (!data.ok) {
        setApplied(null)
        setCouponMsg(data.reason ?? "That code isn't valid.")
        return
      }
      setApplied({ code: data.code, discountCents: data.discountCents, finalCents: data.finalCents })
    } catch {
      setCouponMsg('Could not check that code — please try again.')
    }
  }

  // Reveal payment options only once a full, well-formed email is present —
  // not on the first keystroke. Keeps wallets/card from flickering in mid-typing.
  const hasIdentity =
    form.customerName.trim() !== '' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.customerEmail.trim())

  // Single choke point for card + every wallet. Guard against a second submit
  // (e.g. tapping a wallet while a charge is in flight) so we never double-charge.
  const busyRef = useRef(false)

  const completeBooking = useCallback(
    async (sourceId: string | null) => {
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
            classInstanceId,
            ...(sourceId ? { sourceId } : {}),
            ...(appliedRef.current ? { couponCode: appliedRef.current.code } : {}),
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
    [classInstanceId, slug, router],
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
      {/* Identity — always visible. Name, email, then phone directly beneath. */}
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
        <input
          className="pp-input"
          aria-label="Phone (optional)"
          placeholder="Phone (optional)"
          value={form.customerPhone}
          onChange={(e) => setForm({ ...form, customerPhone: e.target.value })}
        />
      </div>

      {!hasIdentity ? (
        <p style={{ marginTop: 12, fontSize: 13, color: 'var(--pp-muted)' }}>
          Enter your name and email to continue to payment.
        </p>
      ) : (
        <>
          {/* Coupon code — preview only; the server re-validates at charge time. */}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <input
              className="pp-input"
              aria-label="Coupon code"
              placeholder="Coupon code (optional)"
              value={couponInput}
              onChange={(e) => setCouponInput(e.target.value)}
              style={{ flex: 1 }}
            />
            <button type="button" className="pp-btn" onClick={applyCoupon} disabled={busy}>
              Apply
            </button>
          </div>
          {applied && (
            <p style={{ marginTop: 6, fontSize: 13 }}>
              {applied.code} applied: <s>{priceLabel}</s> <strong>{effectiveLabel}</strong>
            </p>
          )}
          {couponMsg && <p style={{ marginTop: 6, fontSize: 13, color: '#b3261e' }}>{couponMsg}</p>}

          {isFree ? (
            <button
              className="pp-btn"
              style={{ marginTop: 12 }}
              disabled={busy}
              onClick={() => void completeBooking(null)}
            >
              {busy ? 'Processing…' : 'Book free'}
            </button>
          ) : (
            <>
              {/* Card first, with its Book & pay submit. */}
              <form onSubmit={submitCard} style={{ display: 'grid', gap: 10, marginTop: 12 }}>
                <div id="card-container" />
                <PoweredBySquare />
                <button className="pp-btn" type="submit" disabled={!ready || busy}>
                  {busy ? 'Processing…' : `Book & pay ${effectiveLabel}`}
                </button>
              </form>

              {/* Wallets below the card. */}
              {payments && (
                <>
                  <div className="pp-or-divider">or pay with</div>
                  <WalletButtons
                    key={effectiveCents}
                    payments={payments}
                    priceCents={effectiveCents}
                    referenceId={`booking-instance-${classInstanceId}`}
                    disabled={busy}
                    onToken={completeBooking}
                    onError={setMsg}
                  />
                </>
              )}
            </>
          )}
        </>
      )}

      {msg && <p>{msg}</p>}
    </div>
  )
}

// Small trust signal under the card field so buyers know who processes the payment.
function PoweredBySquare() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        fontSize: 12,
        color: 'var(--pp-muted)',
      }}
    >
      <svg width="13" height="13" viewBox="0 0 32 32" fill="currentColor" aria-hidden="true">
        <path d="M5 0h22a5 5 0 0 1 5 5v22a5 5 0 0 1-5 5H5a5 5 0 0 1-5-5V5a5 5 0 0 1 5-5zm1.5 6A1.5 1.5 0 0 0 5 7.5v17A1.5 1.5 0 0 0 6.5 26h19a1.5 1.5 0 0 0 1.5-1.5v-17A1.5 1.5 0 0 0 25.5 6h-19zM13 13h6v6h-6z" />
      </svg>
      <span>Powered by Square</span>
    </div>
  )
}

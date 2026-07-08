'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { WalletButtons } from '../classes/[slug]/WalletButtons'
import { nextFiringDate } from '../../../lib/firing-date'
import { FIRING_HALF_SHELF_CENTS, MAX_HALF_SHELVES, MAX_FIRING_PHOTOS } from '../../../lib/firing-pricing'

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
// Matches the server's per-photo cap in src/app/api/firings/route.ts.
const MAX_PHOTO_BYTES = 10 * 1024 * 1024

export function FiringRequestForm() {
  const cardRef = useRef<any>(null)
  const [payments, setPayments] = useState<any>(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const [form, setForm] = useState({ name: '', email: '', phone: '', description: '', notes: '' })
  const [halfShelves, setHalfShelves] = useState(1)
  const [stonewareConfirmed, setStonewareConfirmed] = useState(false)
  const [photos, setPhotos] = useState<File[]>([])
  const [photoMsg, setPhotoMsg] = useState<string | null>(null)

  const [couponInput, setCouponInput] = useState('')
  const [applied, setApplied] = useState<{
    code: string
    discountCents: number
    finalCents: number
  } | null>(null)
  const [couponMsg, setCouponMsg] = useState<string | null>(null)

  const priceCents = FIRING_HALF_SHELF_CENTS * halfShelves
  const priceLabel = `$${(priceCents / 100).toFixed(2)}`
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

  const halfShelvesRef = useRef(halfShelves)
  useEffect(() => {
    halfShelvesRef.current = halfShelves
  }, [halfShelves])

  const stonewareRef = useRef(stonewareConfirmed)
  useEffect(() => {
    stonewareRef.current = stonewareConfirmed
  }, [stonewareConfirmed])

  const photosRef = useRef(photos)
  useEffect(() => {
    photosRef.current = photos
  }, [photos])

  // Totals only ever come from the server — clear any applied coupon when the
  // shelf count changes so the customer re-applies against the new total.
  function updateHalfShelves(next: number) {
    setHalfShelves(next)
    setApplied(null)
    setCouponMsg(null)
  }

  async function applyCoupon() {
    setCouponMsg(null)
    const code = couponInput.trim()
    if (!code) return
    try {
      const res = await fetch('/api/coupons/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          firing: true,
          halfShelves: halfShelvesRef.current,
          email: formRef.current.email,
        }),
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

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    setPhotoMsg(null)
    if (files.length > MAX_FIRING_PHOTOS) {
      setPhotoMsg(`Please attach at most ${MAX_FIRING_PHOTOS} photos.`)
      e.target.value = ''
      setPhotos([])
      return
    }
    const oversized = files.find((f) => f.size > MAX_PHOTO_BYTES)
    if (oversized) {
      setPhotoMsg(`"${oversized.name}" is larger than 10 MB — please choose a smaller photo.`)
      e.target.value = ''
      setPhotos([])
      return
    }
    setPhotos(files)
  }

  // Reveal payment options only once a full, well-formed email is present —
  // not on the first keystroke. Keeps wallets/card from flickering in mid-typing.
  const hasIdentity =
    form.name.trim() !== '' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())

  const formValid =
    form.description.trim() !== '' && stonewareConfirmed && photos.length >= 1 && photos.length <= MAX_FIRING_PHOTOS

  // Single choke point for card + every wallet. Guard against a second submit
  // (e.g. tapping a wallet while a charge is in flight) so we never double-charge.
  const busyRef = useRef(false)

  const submitFiring = useCallback(async (sourceId: string | null) => {
    if (busyRef.current) return
    if (!stonewareRef.current || photosRef.current.length < 1 || photosRef.current.length > MAX_FIRING_PHOTOS) {
      setMsg('Please confirm your pieces are stoneware and attach 1–5 photos.')
      return
    }
    busyRef.current = true
    setBusy(true)
    setMsg(null)
    try {
      const f = formRef.current
      const fd = new FormData()
      fd.append('name', f.name)
      fd.append('email', f.email)
      if (f.phone) fd.append('phone', f.phone)
      fd.append('description', f.description)
      if (f.notes) fd.append('notes', f.notes)
      fd.append('halfShelves', String(halfShelvesRef.current))
      fd.append('stonewareConfirmed', String(stonewareRef.current))
      if (sourceId) fd.append('sourceId', sourceId)
      if (appliedRef.current) fd.append('couponCode', appliedRef.current.code)
      for (const file of photosRef.current) fd.append('photos', file)

      const res = await fetch('/api/firings', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Firing request failed')
      // Leave the form locked (busy stays true) — we swap to the confirmation view.
      setDone(true)
    } catch (err: any) {
      setMsg(err.message)
      setBusy(false)
      busyRef.current = false
    }
  }, [])

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
    if (!formValid) {
      setMsg('Please confirm your pieces are stoneware and attach 1–5 photos.')
      return
    }
    try {
      if (!cardRef.current)
        throw new Error('Payment form is not ready yet. Please wait a moment and try again.')
      const result = await cardRef.current.tokenize()
      if (result.status !== 'OK') throw new Error('Card was not accepted')
      await submitFiring(result.token)
    } catch (err: any) {
      setMsg(err.message)
    }
  }

  if (done) {
    const dateLabel = nextFiringDate().toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })
    return (
      <p role="status" style={{ marginTop: 24, fontWeight: 600 }}>
        Thanks! We&apos;ve received your firing request. We&apos;ll fire your pieces at the next
        firing on {dateLabel} and email you when they&apos;re ready.
      </p>
    )
  }

  return (
    <div style={{ marginTop: 24, maxWidth: 420 }}>
      {/* Identity — always visible. Name, email, then phone directly beneath. */}
      <div style={{ display: 'grid', gap: 10 }}>
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
        <input
          className="pp-input"
          aria-label="Phone (optional)"
          placeholder="Phone (optional)"
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
        />
      </div>

      {!hasIdentity ? (
        <p style={{ marginTop: 12, fontSize: 13, color: 'var(--pp-muted)' }}>
          Enter your name and email to continue.
        </p>
      ) : (
        <>
          {/* Half-shelf stepper — 1 to MAX_HALF_SHELVES, live total. */}
          <div style={{ marginTop: 16 }}>
            <label style={{ fontSize: 14, fontWeight: 600 }}>Half shelves</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6 }}>
              <button
                type="button"
                className="pp-btn"
                onClick={() => updateHalfShelves(Math.max(1, halfShelves - 1))}
                disabled={busy || halfShelves <= 1}
                aria-label="Fewer half shelves"
              >
                −
              </button>
              <span style={{ minWidth: 110, textAlign: 'center' }}>
                {halfShelves} {halfShelves === 1 ? 'half shelf' : 'half shelves'}
              </span>
              <button
                type="button"
                className="pp-btn"
                onClick={() => updateHalfShelves(Math.min(MAX_HALF_SHELVES, halfShelves + 1))}
                disabled={busy || halfShelves >= MAX_HALF_SHELVES}
                aria-label="More half shelves"
              >
                +
              </button>
            </div>
            <p style={{ marginTop: 6, fontSize: 13, color: 'var(--pp-muted)' }}>
              {priceLabel} total ({halfShelves} × ${(FIRING_HALF_SHELF_CENTS / 100).toFixed(2)})
            </p>
          </div>

          <textarea
            required
            className="pp-input"
            aria-label="Describe your piece(s)"
            placeholder="Describe your piece(s)"
            rows={3}
            style={{ marginTop: 12, width: '100%' }}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />

          <textarea
            className="pp-input"
            aria-label="Anything else? (optional)"
            placeholder="Anything else? (optional)"
            rows={2}
            style={{ marginTop: 10, width: '100%' }}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />

          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 12, fontSize: 14 }}>
            <input
              required
              type="checkbox"
              checked={stonewareConfirmed}
              onChange={(e) => setStonewareConfirmed(e.target.checked)}
              style={{ marginTop: 3 }}
            />
            <span>My piece(s) are stoneware clay, suitable for a Cone 10 firing.</span>
          </label>

          <label style={{ display: 'block', marginTop: 12, fontSize: 14, color: 'var(--pp-muted)' }}>
            Photos (1–{MAX_FIRING_PHOTOS}, required)
            <input
              required
              type="file"
              accept="image/*"
              multiple
              onChange={handlePhotoChange}
              style={{ display: 'block', marginTop: 4 }}
            />
          </label>
          {photos.length > 0 && (
            <ul style={{ marginTop: 6, fontSize: 13, color: 'var(--pp-muted)', paddingLeft: 18 }}>
              {photos.map((f, i) => (
                <li key={i}>{f.name}</li>
              ))}
            </ul>
          )}
          {photoMsg && (
            <p role="alert" style={{ marginTop: 6, fontSize: 13, color: '#b3261e' }}>
              {photoMsg}
            </p>
          )}

          {/* Coupon code — preview only; the server re-validates at charge time. */}
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
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

          {isFree && (
            <button
              className="pp-btn"
              style={{ marginTop: 12 }}
              disabled={busy || !formValid}
              onClick={() => void submitFiring(null)}
            >
              {busy ? 'Processing…' : 'Submit free'}
            </button>
          )}

          {/* Keep the card form MOUNTED while free (hidden via CSS) so the Square
              card iframe's attach/destroy lifecycle (Effect B) is undisturbed —
              unmounting #card-container orphans the card instance because the
              effect's deps don't include isFree. */}
          <div style={isFree ? { display: 'none' } : undefined}>
            {/* Card first, with its Submit & pay button. */}
            <form onSubmit={submitCard} style={{ display: 'grid', gap: 10, marginTop: 12 }}>
              <div id="card-container" />
              <PoweredBySquare />
              <button className="pp-btn" type="submit" disabled={!ready || busy || isFree || !formValid}>
                {busy ? 'Processing…' : `Submit & pay ${effectiveLabel}`}
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
                  referenceId="firing"
                  disabled={busy || !formValid}
                  onToken={submitFiring}
                  onError={setMsg}
                />
              </>
            )}
          </div>
        </>
      )}

      {msg && (
        <p role="alert" style={{ marginTop: 12 }}>
          {msg}
        </p>
      )}
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

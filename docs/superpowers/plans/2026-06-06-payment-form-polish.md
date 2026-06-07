# Payment Form Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate the booking payment area behind name+email, theme the Square card widget to match the brand, and redirect to a dedicated confirmation page after a successful charge.

**Architecture:** All work is in the class-detail booking flow. `BookingForm.tsx` (client) is restructured so the Square card mounts only once its container is rendered (after identity is entered), is themed via the SDK's `style` object, and redirects on success. A new server-rendered confirmation page shows a generic success state. Shared input CSS makes the form look intentional. No charge/email/booking-service logic changes; the API already returns `bookingId`.

**Tech Stack:** Next.js (App Router, Next 15 async params/searchParams), Payload CMS, Square Web Payments SDK, Playwright (e2e), existing `.pp-*` theme classes.

**Spec:** `docs/superpowers/specs/2026-06-06-payment-form-polish-design.md`

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/app/(frontend)/classes/[slug]/confirmed/page.tsx` | **New.** Server component: generic payment-success page (class title + reference). |
| `src/styles/globals.css` | Add `.pp-input` class + `#card-container` styling so text inputs and the card widget look cohesive. |
| `src/app/(frontend)/classes/[slug]/BookingForm.tsx` | Gate full payment area on identity; split SDK init so the card attaches only when its container exists; theme card via `style`; redirect on success; accept a `slug` prop. |
| `src/app/(frontend)/classes/[slug]/page.tsx` | Pass `slug` to `BookingForm`. |
| `tests/e2e/booking-confirmation.e2e.spec.ts` | **New.** e2e: confirmation page renders; payment area is gated on identity. |

---

## Task 1: Booking confirmation page

**Files:**
- Create: `src/app/(frontend)/classes/[slug]/confirmed/page.tsx`
- Test: `tests/e2e/booking-confirmation.e2e.spec.ts`

- [ ] **Step 1: Write the failing e2e test**

Create `tests/e2e/booking-confirmation.e2e.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

const SLUG = '6wk-wheel-throwing-tuesdays'

test('confirmation page shows success, class title, and reference', async ({ page }) => {
  await page.goto(`/classes/${SLUG}/confirmed?ref=1234`)
  await expect(page.getByRole('heading', { name: 'Payment successful!' })).toBeVisible()
  await expect(page.getByText(/6wk Wheel Throwing/)).toBeVisible()
  await expect(page.getByText('Reference: #1234')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Browse more classes' })).toBeVisible()
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec playwright test tests/e2e/booking-confirmation.e2e.spec.ts -g "confirmation page shows success"`
Expected: FAIL — the `/confirmed` route 404s (heading not found).

- [ ] **Step 3: Create the confirmation page**

Create `src/app/(frontend)/classes/[slug]/confirmed/page.tsx`:

```tsx
import { getPayload } from 'payload'
import config from '@payload-config'
import { notFound } from 'next/navigation'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function BookingConfirmedPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ ref?: string }>
}) {
  const { slug } = await params
  const { ref } = await searchParams
  const payload = await getPayload({ config: await config })
  const { docs } = await payload.find({
    collection: 'classes',
    where: { slug: { equals: slug } },
    limit: 1,
  })
  const cls = docs[0]
  if (!cls) notFound()

  return (
    <div style={{ padding: '40px 0', maxWidth: 560 }}>
      <div className="pp-kicker">Confirmed</div>
      <h1>Payment successful!</h1>
      <p style={{ marginTop: 16, fontSize: 18 }}>
        You&rsquo;re booked for <strong>{cls.title}</strong>.
      </p>
      <p style={{ color: 'var(--pp-muted)' }}>A confirmation has been sent to your email.</p>
      {ref && <p style={{ color: 'var(--pp-muted)' }}>Reference: #{ref}</p>}
      <p style={{ marginTop: 24 }}>
        <Link className="pp-btn" href="/classes">
          Browse more classes
        </Link>
      </p>
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec playwright test tests/e2e/booking-confirmation.e2e.spec.ts -g "confirmation page shows success"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(frontend)/classes/[slug]/confirmed/page.tsx" tests/e2e/booking-confirmation.e2e.spec.ts
git commit -m "Add booking confirmation page"
```

---

## Task 2: Shared input + card-container styling

**Files:**
- Modify: `src/styles/globals.css`

The name/email/phone inputs currently use unstyled browser defaults, which is half of why the form "looks sketchy." Add a `.pp-input` class and style the Square `#card-container` wrapper to match, so the whole form looks intentional. (The Square iframe's *internal* fields are themed separately in Task 3 via the SDK `style` object — this task styles the surrounding inputs and the container border/background.)

- [ ] **Step 1: Add the CSS**

Append to `src/styles/globals.css`:

```css
/* Booking form inputs + Square card container */
.pp-input {
  width: 100%;
  padding: 11px 12px;
  background: #fff;
  color: var(--pp-charcoal);
  border: 1px solid #d9cdbf;
  border-radius: var(--pp-radius);
  font-family: var(--font-inter), system-ui, sans-serif;
  font-size: 16px;
}
.pp-input::placeholder { color: var(--pp-muted); }
.pp-input:focus {
  outline: none;
  border-color: var(--pp-terracotta);
}
#card-container {
  background: #fff;
  border: 1px solid #d9cdbf;
  border-radius: var(--pp-radius);
  padding: 4px 12px;
  min-height: 44px;
}
```

- [ ] **Step 2: Verify it compiles (no separate test)**

Run: `pnpm lint`
Expected: PASS (no lint errors introduced). CSS application is verified visually in Task 3's manual check.

- [ ] **Step 3: Commit**

```bash
git add src/styles/globals.css
git commit -m "Add shared booking input and card-container styles"
```

---

## Task 3: Restructure BookingForm — gate, theme, redirect

**Files:**
- Modify: `src/app/(frontend)/classes/[slug]/BookingForm.tsx` (full rewrite)
- Modify: `src/app/(frontend)/classes/[slug]/page.tsx:42`
- Test: `tests/e2e/booking-confirmation.e2e.spec.ts` (add gating test)

- [ ] **Step 1: Write the failing gating e2e test**

Append to `tests/e2e/booking-confirmation.e2e.spec.ts`:

```ts
test('payment area is hidden until name and email are entered', async ({ page }) => {
  await page.goto(`/classes/${SLUG}`)

  const prompt = page.getByText('Enter your name and email to continue to payment.')
  await expect(prompt).toBeVisible()
  await expect(page.getByRole('button', { name: /Book & pay/ })).toHaveCount(0)

  await page.getByPlaceholder('Your name').fill('Test Customer')
  await page.getByPlaceholder('Email').fill('test@example.com')

  await expect(prompt).toBeHidden()
  await expect(page.getByRole('button', { name: /Book & pay/ })).toBeVisible()
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec playwright test tests/e2e/booking-confirmation.e2e.spec.ts -g "payment area is hidden"`
Expected: FAIL — the prompt text does not exist yet and the Book button is visible from the start.

- [ ] **Step 3: Rewrite `BookingForm.tsx`**

Replace the entire contents of `src/app/(frontend)/classes/[slug]/BookingForm.tsx` with:

```tsx
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
  // is cleared/re-entered; cleanup destroys the card so none accumulate.
  useEffect(() => {
    if (!payments || !hasIdentity) return
    let cancelled = false

    async function attachCard() {
      try {
        const card = await payments.card({ style: CARD_STYLE })
        if (cancelled) {
          await card.destroy()
          return
        }
        await card.attach('#card-container')
        cardRef.current = card
        setReady(true)
      } catch {
        if (!cancelled) setMsg(LOAD_ERROR)
      }
    }

    void attachCard()
    return () => {
      cancelled = true
      void cardRef.current?.destroy()
      cardRef.current = null
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
          placeholder="Your name"
          value={form.customerName}
          onChange={(e) => setForm({ ...form, customerName: e.target.value })}
        />
        <input
          required
          className="pp-input"
          type="email"
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
```

- [ ] **Step 4: Pass `slug` from the class page**

In `src/app/(frontend)/classes/[slug]/page.tsx`, line 42, change:

```tsx
        <BookingForm classId={cls.id} priceCents={cls.priceCents} priceLabel={usd(cls.priceCents)} />
```

to:

```tsx
        <BookingForm classId={cls.id} slug={slug} priceCents={cls.priceCents} priceLabel={usd(cls.priceCents)} />
```

- [ ] **Step 5: Run the gating test to verify it passes**

Run: `pnpm exec playwright test tests/e2e/booking-confirmation.e2e.spec.ts -g "payment area is hidden"`
Expected: PASS.

- [ ] **Step 6: Run the full new e2e file + lint + typecheck**

Run: `pnpm exec playwright test tests/e2e/booking-confirmation.e2e.spec.ts && pnpm lint && pnpm exec tsc --noEmit`
Expected: all PASS (both e2e tests green, no lint or type errors).

- [ ] **Step 7: Commit**

```bash
git add "src/app/(frontend)/classes/[slug]/BookingForm.tsx" "src/app/(frontend)/classes/[slug]/page.tsx" tests/e2e/booking-confirmation.e2e.spec.ts
git commit -m "Gate booking payment area, theme card widget, redirect to confirmation"
```

---

## Task 4: Manual verification (Square sandbox)

Automated tests cannot drive a real Square card iframe end to end. Verify the themed widget and the success redirect by hand against the sandbox.

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server**

Run: `pnpm dev`
Open: `http://localhost:3000/classes/6wk-wheel-throwing-tuesdays`

- [ ] **Step 2: Verify gating**

Confirm only the name/email inputs + the "Enter your name and email to continue to payment." prompt are visible. No wallets, no card field, no Book button.

- [ ] **Step 3: Verify reveal + theming**

Fill name and email. Confirm the wallets (if available on your browser), the "or pay with card" divider, the themed card field (cream/terracotta border, charcoal text, 4px radius matching the name/email inputs), and the Book & pay button all appear. Confirm there are no Square console warnings about attaching to a hidden/zero-size element.

- [ ] **Step 4: Verify successful payment redirect**

Pay with the Square sandbox test card `4111 1111 1111 1111`, any future expiry, any CVV, any ZIP. Confirm you are redirected to `/classes/6wk-wheel-throwing-tuesdays/confirmed?ref=<id>` showing "Payment successful!", the class title, and the reference number. Confirm the back button returns to the class page without re-submitting (no second charge in the Square sandbox dashboard).

- [ ] **Step 5: Verify identity-clear cleanup**

After the card field appears, clear the email field. Confirm the payment area collapses back to the prompt. Re-enter the email and confirm a single working card field reappears (no duplicate/stacked card iframes).

---

## Self-Review Notes

- **Spec coverage:** Gating full area → Task 3 (render + Effect B lifecycle). Card theming → Task 3 `CARD_STYLE` (supported selectors only, confirmed against Square docs) + Task 2 container CSS. Confirmation page + redirect → Task 1 (page) + Task 3 (`router.push`, no busy reset on success). `slug` prop → Task 3 Step 4. No backend logic change — confirmed API already returns `bookingId`.
- **Type consistency:** `BookingForm` props gain `slug: string`; the only call site is updated in the same task. `completeBooking` signature unchanged (still `(sourceId: string)`), so `WalletButtons` `onToken`/`onError` props are unaffected.
- **No placeholders:** every code/step is complete and runnable.

# Digital Wallets on the Class Booking Form Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Apple Pay, Google Pay, and Cash App Pay to the class booking form, reusing the existing `/api/bookings` charge flow unchanged.

**Architecture:** All three wallets use the Square Web Payments SDK (loaded from Square's CDN) and tokenize to a `sourceId` — identical to the card field. They POST to the same `/api/bookings` and run through the same `createPaidBooking` service; the amount stays server-authoritative. This is a client-only change plus a deploy-time Apple Pay domain file. No server/DB/test changes.

**Tech Stack:** Next.js 16 (client components), React 19, Square Web Payments SDK (browser, from `web.squarecdn.com` / `sandbox.web.squarecdn.com`).

**Spec:** `docs/superpowers/specs/2026-06-05-booking-wallets-design.md`.

---

## Environment / context notes (READ FIRST)

1. **Commit identity** is repo-local `briswells <briswells@gmail.com>`. **NEVER add AI/Claude attribution.** Use the exact commit messages.
2. **No automated tests for this work.** The Web Payments SDK is browser-only code loaded from Square's CDN (the repo types it as `window.Square?: any`), so wallet init can't be unit-tested without a real browser/device. The server charge path is already covered by `tests/int/booking-service.int.spec.ts` (a wallet just supplies a different `sourceId`). Verification is `pnpm exec tsc --noEmit` + `pnpm lint` + manual sandbox checks. Do NOT add fake browser tests.
3. The Square **browser** SDK API has some version drift. The code below matches Square's current published docs (verified via context7). If the live `square.js` the page loads exposes a different shape (e.g. Apple Pay `mount()` + `paymentauthorized` event instead of `tokenize()` in a click handler), adapt to the shipped SDK and note it — but keep the same component interface and the same `onToken(sourceId)` → `/api/bookings` flow.
4. `.env` already has working sandbox creds (`NEXT_PUBLIC_SQUARE_APP_ID`, `NEXT_PUBLIC_SQUARE_LOCATION_ID`, `NEXT_PUBLIC_SQUARE_ENVIRONMENT=sandbox`). After any `NEXT_PUBLIC_*` change you must restart `pnpm dev`.
5. Gates after each task: `pnpm exec tsc --noEmit` clean, `pnpm lint` no NEW errors (pre-existing `no-explicit-any` warnings are OK — wallet code will add a few, consistent with the existing `BookingForm`).

---

## File Structure

```
src/app/(frontend)/classes/[slug]/
├── page.tsx           # MODIFY: pass priceCents to BookingForm
├── BookingForm.tsx    # MODIFY: priceCents prop; expose `payments`; shared completeBooking; layout
└── WalletButtons.tsx  # NEW: defensively init + render Apple/Google/Cash App Pay buttons
src/styles/globals.css # MODIFY: .pp-or-divider + #apple-pay-button styling
src/app/.well-known/apple-developer-merchantid-domain-association/route.ts  # NEW (deploy-time)
docs/DEPLOY.md         # MODIFY: Apple Pay registration + Cloudflare-tunnel notes
```

---

## Task 1: BookingForm refactor — price prop, shared submit, layout, wallet slot

**Files:**
- Modify: `src/app/(frontend)/classes/[slug]/page.tsx`
- Modify: `src/app/(frontend)/classes/[slug]/BookingForm.tsx`
- Modify: `src/styles/globals.css`

- [ ] **Step 1: Pass `priceCents` from the class page**

In `src/app/(frontend)/classes/[slug]/page.tsx`, the form is currently rendered as
`<BookingForm classId={cls.id} priceLabel={usd(cls.priceCents)} />`. Change it to:
```tsx
<BookingForm classId={cls.id} priceCents={cls.priceCents} priceLabel={usd(cls.priceCents)} />
```
(`usd` and `cls.priceCents` are already in scope on that page.)

- [ ] **Step 2: Refactor `BookingForm.tsx`**

Replace the entire contents of `src/app/(frontend)/classes/[slug]/BookingForm.tsx` with:
```tsx
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

  // Keep the latest form values readable from async wallet/card handlers without
  // stale closures.
  const formRef = useRef(form)
  useEffect(() => {
    formRef.current = form
  }, [form])

  // Shared by the card submit AND every wallet button: charge the tokenized source.
  const completeBooking = useCallback(
    async (sourceId: string) => {
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

      {/* Express wallets — only after name+email so the booking has an identity. */}
      {payments &&
        (hasIdentity ? (
          <div style={{ marginTop: 12 }}>
            <WalletButtons
              payments={payments}
              priceCents={priceCents}
              referenceId={`booking-${classId}`}
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
```

- [ ] **Step 3: Add the divider + Apple Pay button styles**

Append to `src/styles/globals.css`:
```css
/* Booking form: payment-method divider + Apple Pay button target */
.pp-or-divider {
  text-align: center;
  color: var(--pp-muted);
  font-size: 13px;
  margin: 14px 0;
}
#apple-pay-button {
  -webkit-appearance: -apple-pay-button;
  -apple-pay-button-type: plain;
  -apple-pay-button-style: black;
  height: 44px;
  border-radius: 8px;
  cursor: pointer;
}
```

- [ ] **Step 4: Stub WalletButtons so the app compiles**

Create `src/app/(frontend)/classes/[slug]/WalletButtons.tsx` with a temporary stub (Task 2 fills it in):
```tsx
'use client'
export function WalletButtons(_props: {
  payments: any
  priceCents: number
  referenceId: string
  onToken: (sourceId: string) => void | Promise<void>
  onError: (msg: string) => void
}) {
  return null
}
```

- [ ] **Step 5: Type-check + lint**

Run:
```bash
pnpm exec tsc --noEmit
pnpm lint
```
Expected: tsc clean; lint no new errors.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(frontend)/classes/[slug]/page.tsx" "src/app/(frontend)/classes/[slug]/BookingForm.tsx" "src/app/(frontend)/classes/[slug]/WalletButtons.tsx" src/styles/globals.css
git commit -m "Refactor booking form for shared submit and a wallet slot"
```

---

## Task 2: WalletButtons — Apple/Google/Cash App Pay

**Files:**
- Modify: `src/app/(frontend)/classes/[slug]/WalletButtons.tsx`

- [ ] **Step 1: Implement WalletButtons**

Replace the stub in `src/app/(frontend)/classes/[slug]/WalletButtons.tsx` with:
```tsx
'use client'
import { useEffect, useState } from 'react'

export function WalletButtons({
  payments,
  priceCents,
  referenceId,
  onToken,
  onError,
}: {
  payments: any
  priceCents: number
  referenceId: string
  onToken: (sourceId: string) => void | Promise<void>
  onError: (msg: string) => void
}) {
  const [shown, setShown] = useState({ apple: false, google: false, cashapp: false })

  useEffect(() => {
    let cancelled = false
    const cleanups: Array<() => void> = []

    // A fresh payment request per method (Square treats these as single-use).
    const makeRequest = () =>
      payments.paymentRequest({
        countryCode: 'US',
        currencyCode: 'USD',
        total: { amount: (priceCents / 100).toFixed(2), label: 'Portside Pottery' },
      })

    async function initApplePay() {
      try {
        const applePay = await payments.applePay(makeRequest())
        if (cancelled) return
        const btn = document.getElementById('apple-pay-button')
        if (!btn) return
        // Apple requires tokenize() to run synchronously inside the click handler —
        // no awaits before it.
        const handler = async (e: Event) => {
          e.preventDefault()
          try {
            const result = await applePay.tokenize()
            if (result.status === 'OK') await onToken(result.token)
            else onError('Apple Pay was not completed.')
          } catch {
            onError('Apple Pay was not completed.')
          }
        }
        btn.addEventListener('click', handler)
        cleanups.push(() => btn.removeEventListener('click', handler))
        setShown((s) => ({ ...s, apple: true }))
      } catch {
        /* Apple Pay unsupported (non-Safari/device/account) — skip its button. */
      }
    }

    async function initGooglePay() {
      try {
        const googlePay = await payments.googlePay(makeRequest())
        if (cancelled) return
        await googlePay.attach('#google-pay-button')
        const btn = document.getElementById('google-pay-button')
        const handler = async (e: Event) => {
          e.preventDefault()
          try {
            const result = await googlePay.tokenize()
            if (result.status === 'OK') await onToken(result.token)
            else onError('Google Pay was not completed.')
          } catch {
            onError('Google Pay was not completed.')
          }
        }
        btn?.addEventListener('click', handler)
        cleanups.push(() => {
          btn?.removeEventListener('click', handler)
          googlePay.destroy?.()
        })
        setShown((s) => ({ ...s, google: true }))
      } catch {
        /* Google Pay unsupported — skip. */
      }
    }

    async function initCashAppPay() {
      try {
        const cashAppPay = await payments.cashAppPay(makeRequest(), {
          redirectURL: window.location.href,
          referenceId,
        })
        if (cancelled) {
          cashAppPay.destroy?.()
          return
        }
        const listener = (event: any) => {
          const tr = event?.detail?.tokenResult
          if (tr?.status === 'OK') void onToken(tr.token)
          else onError('Cash App Pay was not completed.')
        }
        cashAppPay.addEventListener('ontokenization', listener)
        await cashAppPay.attach('#cash-app-pay')
        cleanups.push(() => cashAppPay.destroy?.())
        setShown((s) => ({ ...s, cashapp: true }))
      } catch {
        /* Cash App Pay unsupported — skip. */
      }
    }

    void initApplePay()
    void initGooglePay()
    void initCashAppPay()

    return () => {
      cancelled = true
      cleanups.forEach((fn) => fn())
    }
  }, [payments, priceCents, referenceId, onToken, onError])

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div id="apple-pay-button" style={{ display: shown.apple ? 'block' : 'none' }} />
      <div id="google-pay-button" style={{ display: shown.google ? 'block' : 'none' }} />
      <div id="cash-app-pay" style={{ display: shown.cashapp ? 'block' : 'none' }} />
    </div>
  )
}
```

- [ ] **Step 2: Type-check + lint**

Run:
```bash
pnpm exec tsc --noEmit
pnpm lint
```
Expected: tsc clean; lint no new errors (a few `no-explicit-any` warnings from the SDK are fine).

- [ ] **Step 3: Manual sandbox verification (no automated test possible)**

Restart and open a class page in Chrome:
```bash
pnpm devsafe
```
- Open `http://localhost:3000/classes/<a-class-slug>`.
- Type a name + email → the wallet area appears.
- **Google Pay** button should render (Chrome). Click it → Google Pay sheet (sandbox) → on success the page shows "Booked! Check your email for confirmation." and a paid `Bookings` row + `Payments` row appear in `/admin`.
- **Cash App Pay** button should render → completing the sandbox flow books the class.
- **Apple Pay** will NOT appear in Chrome/localhost — expected (Task 3 covers production).
- The **card** path must still work (sandbox card `4111 1111 1111 1111`).
Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(frontend)/classes/[slug]/WalletButtons.tsx"
git commit -m "Add Apple Pay, Google Pay, and Cash App Pay buttons to booking"
```

---

## Task 3: Apple Pay domain verification + deploy docs

**Files:**
- Create: `src/app/.well-known/apple-developer-merchantid-domain-association/route.ts`
- Modify: `docs/DEPLOY.md`

- [ ] **Step 1: Serve the Apple Pay domain-association file**

Square gives you a domain-association file when you register a domain for Apple Pay. Serve
it at `/.well-known/apple-developer-merchantid-domain-association` from an env var so the
secret content isn't committed. Create
`src/app/.well-known/apple-developer-merchantid-domain-association/route.ts`:
```ts
// Serves the Apple Pay domain-association file (content from Square, set via env).
// Returns 404 until APPLE_PAY_DOMAIN_ASSOCIATION is configured, so it's inert locally.
export function GET() {
  const body = process.env.APPLE_PAY_DOMAIN_ASSOCIATION
  if (!body) return new Response('Not found', { status: 404 })
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  })
}
```

- [ ] **Step 2: Document the env var**

Append to `.env.example` and `.env.production.example`:
```bash
# Apple Pay on the Web: the domain-association file contents from the Square dashboard
APPLE_PAY_DOMAIN_ASSOCIATION=
```

- [ ] **Step 3: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Add the Apple Pay section to `docs/DEPLOY.md`**

Append a new section to `docs/DEPLOY.md`:
```markdown
## Apple Pay on the class booking form (production)

Apple Pay only appears on HTTPS + Safari/Apple devices; Google Pay and Cash App Pay need
no extra setup. To enable Apple Pay:

1. In the **Square Dashboard → Apple Pay**, register your production domain (the exact
   public hostname customers use — e.g. the Cloudflare-tunnel domain).
2. Square provides a **domain-association file**. Put its contents in the
   `APPLE_PAY_DOMAIN_ASSOCIATION` env var (in `.env.production`). The app serves it at
   `https://<domain>/.well-known/apple-developer-merchantid-domain-association`.
3. Confirm `https://<domain>/.well-known/apple-developer-merchantid-domain-association`
   returns the file over HTTPS, then complete verification in the Square dashboard.

**Cloudflare tunnel:** serving the app over HTTP behind a Cloudflare tunnel that
terminates TLS is fine — Apple only sees the public `https://<domain>`. BUT the storefront
and especially the `/.well-known/...` path must be **publicly reachable, NOT behind a
Cloudflare Access (Zero-Trust login) policy**, or Apple/Square's verification fetch hits
the login page and fails (and customers couldn't shop). The tunnel for connectivity is
fine; an Access auth gate on public routes is not. The Apple-Pay-registered domain,
`PUBLIC_BASE_URL`, and the Square webhook URL should all be that same public hostname.
```

- [ ] **Step 5: Commit**

```bash
git add "src/app/.well-known/apple-developer-merchantid-domain-association/route.ts" .env.example .env.production.example docs/DEPLOY.md
git commit -m "Serve Apple Pay domain-association file and document setup"
```

---

## Self-Review

**Spec coverage:**
- Apple Pay + Google Pay + Cash App Pay on the booking form — Tasks 1–2. ✓
- Same `/api/bookings` + `createPaidBooking`, server-authoritative amount — unchanged; `completeBooking` posts `sourceId` + the DB-priced class is charged server-side. ✓
- Layout: name/email → wallets → "or pay with card" → card — Task 1 Step 2. ✓
- Graceful degradation (each wallet hidden if init fails; card always present) — Task 2 (per-method try/catch + `shown` flags). ✓
- Name/email required before wallets (identity for the booking) — gated by `hasIdentity` mount. ✓
- Apple Pay deploy + Cloudflare-tunnel notes — Task 3. ✓
- No new automated tests (browser-only SDK), manual sandbox verification — stated; charge path already covered. ✓

**Placeholder scan:** none. The "adapt if the live SDK differs" note (env note #3) is a genuine browser-SDK-version check, flagged not hidden.

**Type consistency:** `WalletButtons` props `{ payments, priceCents, referenceId, onToken, onError }` are identical in the Task 1 stub, the Task 2 implementation, and the BookingForm call site. `onToken` = `completeBooking(sourceId: string)`. The wallet tokenize result uses `{ status, token }` (matching the existing card path) for Apple/Google; Cash App Pay uses `event.detail.tokenResult`. `priceCents` flows page → BookingForm → WalletButtons.

**Known limitation (logged):** wallet buttons mount only once name+email are filled, so they "appear" after those fields — deliberate, to guarantee the booking has an identity (and to avoid Cash App Pay completing before we have an email). If the live `square.js` uses Apple Pay `mount()` + `paymentauthorized` instead of `tokenize()`+click, the implementer adapts that one handler (noted in env note #3).

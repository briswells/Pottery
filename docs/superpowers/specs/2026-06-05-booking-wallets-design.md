# Digital Wallets on the Class Booking Form: Design Spec

**Date:** 2026-06-05
**Status:** Approved (brainstorm) — pending spec review

## Goal

Let customers pay for a class with **Apple Pay**, **Google Pay**, or **Cash App Pay**
in addition to a raw credit card, on the class booking form — without changing the
server-side charge/booking logic.

## Why this shape

All three wallets use the **same Square Web Payments SDK** the card field already uses,
and each tokenizes to a `sourceId` — identical to what `payments.card().tokenize()`
returns. So they POST to the **same `POST /api/bookings`** and flow through the **same
`createPaidBooking` service**; the amount stays **server-authoritative** (charged from
the DB `priceCents`, never the client). This is therefore almost entirely a client-side
enhancement. PayPal/Venmo are not in scope — Square doesn't support them.

Scope is the **class booking form only** (`/classes/[slug]`). Firings pay via Square's
hosted invoice page (which already surfaces enabled wallets — no code), and membership
is an email request.

## Architecture / units

```
src/app/(frontend)/classes/[slug]/
├── BookingForm.tsx      # MODIFY: load SDK once, build paymentRequest, render WalletButtons + card
└── WalletButtons.tsx    # NEW: defensively init + render apple/google/cashapp buttons
src/app/.well-known/apple-developer-merchantid-domain-association/route.ts  # NEW: serve Apple file (deploy)
docs/DEPLOY.md           # MODIFY: Apple Pay domain registration + Cloudflare-tunnel notes
```

**Server: unchanged.** `POST /api/bookings`, `createPaidBooking`, `chargeCard`, the
`Bookings`/`Payments` collections, and the webhook all stay exactly as they are — a
wallet `sourceId` is charged identically to a card `sourceId`.

### `BookingForm.tsx` (refactor)

- New prop **`priceCents: number`** (the class page already has `cls.priceCents`) — needed
  to build the wallet `paymentRequest`. `priceLabel` stays for the card button text.
- Loads the Square SDK once (keep the existing hardened load: `window.Square` reuse,
  `script.onerror`, `card.destroy()` cleanup), creates `payments`, and builds:
  `const paymentRequest = payments.paymentRequest({ countryCode: 'US', currencyCode: 'USD', total: { amount: (priceCents / 100).toFixed(2), label: 'Portside Pottery' } })`.
- Layout, top → bottom: **Name** (required) → **Email** (required) → `<WalletButtons>` →
  an **"— or pay with card —"** divider → **Phone** (optional) → `#card-container` →
  **"Book & pay {priceLabel}"** button → message area.
- A single shared **`completeBooking(sourceId)`** function does the POST to
  `/api/bookings` with `{ classId, sourceId, customerName, customerEmail, customerPhone }`
  and renders success/error — used by BOTH the card submit and the wallet `onToken`.

### `WalletButtons.tsx` (new — isolation)

Props: `{ payments, paymentRequest, referenceId, getCustomer, onToken }` where
`getCustomer()` returns `{ name, email }` or `null` (and the parent shows "enter your
name and email first" when null), and `onToken(sourceId)` runs `completeBooking`.

In an effect, **defensively** initialize each method — wrapped so an unsupported/erroring
method simply isn't rendered (no breakage):
- **Apple Pay:** `await payments.applePay(paymentRequest)`; render an Apple Pay button;
  on click → validate `getCustomer()` → `applePay.tokenize()` → `onToken(token)`. Apple
  Pay init/usage throws on non-Safari/unsupported → caught → button hidden.
- **Google Pay:** `await payments.googlePay(paymentRequest)`; `attach` to a container;
  on the button event → validate → `tokenize()` → `onToken`.
- **Cash App Pay:** `await payments.cashAppPay(paymentRequest, { redirectURL: window.location.href, referenceId })`;
  `attach` to a container; listen for the tokenization event → `onToken`.

Cleanup destroys any attached wallet instances on unmount (mirror the card cleanup).

> The exact SDK method/option signatures (`applePay`, `googlePay`, `cashAppPay`,
> `paymentRequest`, the tokenization event names, `redirectURL`/`referenceId` options)
> will be **confirmed against the current Square Web Payments SDK docs (via context7)**
> during implementation, and adapted to the shipped API — not assumed from memory.

### Validation / identity

Name + email are required for the booking record and the confirmation email, so both
the card path and every wallet path require them. The wallet buttons validate that
name/email are filled before tokenizing (a JS check, since a wallet click isn't a form
submit); if missing, the parent shows a clear message. This keeps the `/api/bookings`
contract unchanged (it still requires `customerName` + `customerEmail`).

### Amount authority

The wallet `paymentRequest.total` is built from `priceCents` (the class price), and the
server charges the same DB `priceCents` via `createPaidBooking`, so what the customer
approves equals what is charged.

## Apple Pay domain verification (deploy-time)

Apple Pay only activates on a real **HTTPS** domain in **Safari/Apple** devices — it will
**not** appear on `localhost` or in non-Safari browsers (graceful: the button just isn't
rendered). To enable it in production:
1. Register the production domain in the **Square Dashboard → Apple Pay** settings.
2. Serve the domain-association file at
   `https://<domain>/.well-known/apple-developer-merchantid-domain-association` (a route
   under `src/app/.well-known/...` returning the Square-provided file contents).
3. Valid public TLS cert + publicly resolvable domain.

**Cloudflare tunnel note (per the studio's setup):** serving the app over HTTP on the
origin behind a Cloudflare tunnel that terminates TLS is fine — Apple only sees the
public `https://<domain>` the browser loads. **But** the storefront and especially the
`/.well-known/...` path must be **publicly reachable — NOT behind a Cloudflare Access
(Zero-Trust login) policy**, or Apple/Square's verification fetch hits the login page and
fails (and customers couldn't shop anyway). The tunnel for connectivity is fine; an
Access auth gate on public routes is not. `PUBLIC_BASE_URL` / the Square-registered
domain / the Apple Pay domain must all be that same public tunnel hostname.

The exact mechanism (Square-dashboard registration vs. self-hosted association file, and
whether Square hosts it) will be confirmed against current Square docs during build; the
HTTPS + public-reachability requirements above hold regardless.

## Testing

No new server logic, so the existing `createPaidBooking` integration tests already cover
the charge/booking path (a wallet just supplies a different `sourceId`). Wallet
initialization is browser-only SDK code that can't be meaningfully unit-tested without a
real browser + the Square SDK + device support, so it is verified **manually in sandbox**:
Google Pay in Chrome and Cash App Pay in sandbox locally; Apple Pay after deploy on the
HTTPS domain in Safari. This matches how the existing card form is handled (no unit
tests). Existing gates (tsc/lint/int/e2e) must stay green.

## Out of scope (YAGNI)

PayPal/Venmo (not a Square option); wallets on firings (Square-hosted invoice handles
them) or membership (email request); ACH/Afterpay/gift cards (can be added later with the
same pattern); requesting shipping/contact info from the wallet (we collect name/email in
our own fields); saving cards on file.

## Commit identity

Repo-local `briswells <briswells@gmail.com>`. No AI attribution in commit messages.

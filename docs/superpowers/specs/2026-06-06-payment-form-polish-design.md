# Payment Form Polish — Design

**Date:** 2026-06-06
**Scope:** `src/app/(frontend)/classes/[slug]/BookingForm.tsx`, a new confirmation page route, and supporting CSS. No backend/API logic changes beyond a new page route.

## Problem

The class-booking payment form (`BookingForm.tsx`) has three issues:

1. **Partial gating.** Wallet buttons (Apple/Google/Cash App) already gate behind name + email (`hasIdentity`), but the "or pay with card" section and the Book & pay button are always visible.
2. **Unstyled card widget.** `sq.card()` is initialized with no `style` object, so the Square card/expiry/CVV fields render in Square's bare default look, clashing with the cream + terracotta theme.
3. **Weak success state.** On success the form sets an inline "Booked!" message but stays mounted and interactive — confusing, and the Book button can be pressed again (double-charge / double-submit risk).

## Goals

- Hide the entire payment area until name + email are entered.
- Theme the official Square card widget to match the brand.
- Replace the inline success message with a redirect to a dedicated confirmation page that unmounts the form.

## Non-goals

- No switch to Square hosted checkout (keeps on-site, on-brand widget).
- No exposure of booking PII on the confirmation page (no fetch of customer data).
- No changes to charge logic, email, or the booking service.

---

## 1. Gate the entire payment area

Wrap the full payment block — wallet buttons, the "or pay with card" divider, the phone field, the card container, and the Book & pay button — in the existing `hasIdentity` check (name and email both non-empty).

Before identity is entered, render a short prompt in place of the payment block:

> Enter your name and email to continue to payment.

Once both fields are filled, the entire payment block appears at once.

### Lifecycle change (important)

The Square card widget attaches to `#card-container` on init. If that element only exists after `hasIdentity` becomes true, calling `card()`/`attach()` before the element is in the DOM produces a blank or zero-height card iframe.

**Fix:** split the current single `useEffect`:

- **Effect A (on mount):** load the Square SDK script and create the `payments` instance (`window.Square.payments(...)`). Set a `sdkReady` flag. Do **not** create the card yet.
- **Effect B (depends on `sdkReady && hasIdentity`):** when both are true and no card exists yet, call `sq.card({ style })`, `attach('#card-container')`, store in `cardRef`, set `ready`. Clean up (`card.destroy()`) on unmount.

This guarantees the card mounts exactly when its container is rendered. Wallet init in `WalletButtons` already runs only when rendered, so it is unaffected.

---

## 2. Theme the Square card widget

Pass a `style` object to `sq.card({ style })`. Square's Web Payments SDK supports only a fixed subset of properties on the card iframe; stick to officially supported selectors/properties so it renders reliably. Confirm the exact supported list against Square's Web Payments SDK docs during implementation.

Target values (from `src/styles/theme.css`):

- **Input text:** charcoal `#2E2A26`, brand font family
- **Placeholder:** muted `#6b5d52`
- **Border radius:** `4px` (`--pp-radius`)
- **Focus state:** terracotta border `#A8502F`
- **Error state:** a sensible red (e.g. `#b3261e`)
- **Background:** white `#fff` (matches the name/email inputs)

If any of these targets fall outside Square's supported style API, apply the supported subset inside the iframe and use surrounding CSS (the `#card-container` wrapper) for the rest (border, radius, background) so the field visually matches the other inputs.

---

## 3. Confirmation page + redirect

### Route

New page: `src/app/(frontend)/classes/[slug]/confirmed/page.tsx`

- Server component. Reads `slug` from the route and `ref` (booking reference) from `searchParams`.
- Fetches the **class** (public data, safe) by slug to display its title.
- Does **not** fetch the booking — no PII, no enumeration risk.

### Content

```
✅ Payment successful!

You're booked for
  <Class Title>

A confirmation has been sent to your email.

Reference: #<bookingId>

[ Browse more classes ]  → /classes
```

Styled with existing `.pp-*` classes / theme tokens.

### Redirect from the form

- `BookingForm` gains a `slug` prop (passed from `classes/[slug]/page.tsx`, which already knows it).
- On a successful `POST /api/bookings` response, instead of `setMsg('Booked!...')`, call `router.push(\`/classes/${slug}/confirmed?ref=${bookingId}\`)` (Next `useRouter`).
- The form unmounts on navigation, so there is no lingering interactive Book button and the back button does not resubmit.
- The existing `busyRef` double-submit guard remains as a safety net during the in-flight window before navigation.

The API response already includes `bookingId` (`route.ts:26`) — no API change needed.

---

## Files touched

| File | Change |
|------|--------|
| `src/app/(frontend)/classes/[slug]/BookingForm.tsx` | Gate full payment area; split init effects; add card `style`; add `slug` prop; redirect on success |
| `src/app/(frontend)/classes/[slug]/page.tsx` | Pass `slug` prop to `BookingForm` |
| `src/app/(frontend)/classes/[slug]/confirmed/page.tsx` | **New** — confirmation page |
| `src/styles/globals.css` | Card container border/radius/background to match inputs; minor spacing if needed |

## Risks / edge cases

- **Card iframe in a conditionally-rendered container:** addressed by the split-effect lifecycle (Effect B runs only once the container exists).
- **Square style API limits:** mitigated by confirming supported properties and falling back to wrapper CSS for anything unsupported.
- **Reference number format:** `bookingId` shown as-is (e.g. `#1042`); cosmetic only.
- **User clears name/email after the card mounts:** payment block hides again; `cardRef` cleanup runs on unmount of the block. Re-entering identity re-mounts and re-inits the card (Effect B re-runs because the container remounts). Verify no duplicate card instances accumulate.

## Testing

- Manual: empty form shows prompt only; filling name+email reveals wallets + themed card; card fields match theme; successful sandbox payment redirects to `/classes/<slug>/confirmed?ref=<id>` showing class title + reference; back button does not resubmit.
- Confirm no console errors from Square SDK about attach/zero-size iframe.

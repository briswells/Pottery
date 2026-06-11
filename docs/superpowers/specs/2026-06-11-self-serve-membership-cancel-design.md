# Self-Serve Membership Cancellation (Email Magic Link) — Design

**Date:** 2026-06-11
**Scope:** Let a member cancel their own membership without a login — they enter the email on their membership, get a one-time link, and confirm cancellation on a page. No passwords, no member portal.

## Problem

Members can't log in (we disabled member auth), and Square has no buyer-facing self-cancel. Today cancellation is staff-only (admin sets status → Cancelled). The owner wants a passwordless, self-serve cancel: enter your email → get a one-time link → click → confirm → it cancels your Square subscription.

## Decisions (from brainstorming)

- **DB-stored, single-use, expiring token** (not stateless) — a leaked/old link can't be reused.
- **Confirmation page** after the link (not cancel-on-click) — prevents email scanners/link-preview bots from silently cancelling; gives the member an explicit confirm.

## Flow

1. **`/membership/cancel`** (public page): a single email field + submit.
2. **`POST /api/membership/cancel/request`** `{ email }`:
   - Find a member by email **with a cancelable Square subscription** (has `squareSubscriptionId` and status not already `cancelled`).
   - If found: generate a 32-byte random token, store **its SHA-256 hash** + a 30-minute expiry on the member, and email a link to `/membership/cancel/confirm?token=<raw token>`.
   - **Always** return the same generic `{ ok: true }` with message "If a membership matches that email, we've sent a cancellation link." — regardless of whether a member was found (no enumeration). Email-send failures are logged, not surfaced.
3. **`/membership/cancel/confirm?token=…`** (public page, server component):
   - Validate the token: hash it, find the member whose `cancelTokenHash` matches, check `cancelTokenExpiresAt` is in the future. **GET never cancels.**
   - Valid → show the member's membership (plan name + "Active") and a **"Yes, cancel my membership"** button (a form POST carrying the token).
   - Invalid/expired/used → a friendly "this link is invalid or has expired" page with a link back to `/membership/cancel` to request a new one.
4. **`POST /api/membership/cancel/confirm`** `{ token }`:
   - Re-validate the token (hash match + not expired).
   - `payload.update(member, { status: 'cancelled', cancelTokenHash: null, cancelTokenExpiresAt: null })` — the existing `cancelSquareSubscription` afterChange hook fires (status → cancelled, has `squareSubscriptionId`) and cancels the Square subscription (effective end of billing period). Clearing the token makes it single-use.
   - Send a "your membership is cancelled" confirmation email (failure logged, not fatal).
   - Respond success → confirm page shows "Cancelled — effective at the end of your current billing period."

## Token

- `raw = randomBytes(32).toString('base64url')` → goes only in the emailed link.
- Stored: `cancelTokenHash = sha256(raw)` (hex), `cancelTokenExpiresAt = now + 30 min`.
- Lookup is by hash; the raw token never touches the DB.
- Single active token per member (a new request overwrites the previous hash/expiry).
- Consumed (set both to `null`) on successful cancel.

## Data model — `src/collections/Members.ts`

Two new fields, hidden from the admin UI (internal plumbing):

- `cancelTokenHash` — text, `admin: { hidden: true }`.
- `cancelTokenExpiresAt` — date, `admin: { hidden: true }`.

Requires a generated migration (new columns). No other schema change.

## Components / files

| File | Responsibility |
|------|----------------|
| `src/collections/Members.ts` | Add the two hidden token fields |
| `src/services/membership-cancel.ts` | **New** — `requestMembershipCancel(deps, email)` and `confirmMembershipCancel(deps, token)`; pure logic over injected `payload` + `sendEmail` (unit-testable, no Square code of its own) |
| `src/app/api/membership/cancel/request/route.ts` | **New** — POST: parse email, call `requestMembershipCancel`, always return generic success |
| `src/app/api/membership/cancel/confirm/route.ts` | **New** — POST: parse token, call `confirmMembershipCancel`, return result |
| `src/app/(frontend)/membership/cancel/page.tsx` | **New** — email-entry form (client component posting to the request route) |
| `src/app/(frontend)/membership/cancel/confirm/page.tsx` | **New** — server page: validate token, show membership + confirm button, or invalid/expired message |
| `src/app/(frontend)/membership/page.tsx` | Add a "Cancel my membership" link to `/membership/cancel` |
| `src/lib/email.ts` (or inline) | The cancellation-link email + the cancelled-confirmation email |
| `src/migrations/*` | **New** generated migration for the two columns |

### Service shape

```
requestMembershipCancel({ payload, sendEmail, baseUrl }, email): Promise<void>
  // find cancelable member by email; if found, set hash+expiry, email link; always resolve quietly.

confirmMembershipCancel({ payload }, token): Promise<{ ok: boolean; reason?: 'invalid' | 'expired' }>
  // validate by hash + expiry; on success set status 'cancelled' + clear token; else return reason.
```

`baseUrl` for the link comes from a server env (e.g. `NEXT_PUBLIC_SERVER_URL` / the request origin).

## Security

- **No enumeration:** the request route's response and timing don't depend on whether the email matched (do the member lookup either way; always return the same body).
- **Token:** 32 random bytes; only the SHA-256 hash stored; 30-min expiry; single-use (cleared on cancel).
- **No destructive GET:** the confirm page only reads; cancellation is a POST behind the button.
- **Cancelable only:** links are issued only for members with a `squareSubscriptionId` and a non-cancelled status. Free members (no subscription) get the generic response and no link.
- **Reuses the vetted cancel path** (`status → cancelled` → `cancelSquareSubscription` hook); no new Square calls, so no new cancel-failure modes.

## Edge cases

- Email not found / Free member / already cancelled → generic success, no email sent.
- Token invalid / expired / already used (cleared) → confirm page shows "invalid or expired," with a link to request a new one. The confirm POST returns `{ ok: false, reason }` and changes nothing.
- Square cancel fails inside the hook → the existing hook logs and doesn't crash the save; the member is marked cancelled locally. (Matches current admin-cancel behavior.) The webhook later reconciles status.
- Re-requesting overwrites the prior token (only the latest link works).

## Testing

- **`requestMembershipCancel`** (fake payload + fake sendEmail): emails a link + stores a hash/expiry when a cancelable member exists; sends nothing and stores nothing for an unknown email or a Free/cancelled member; **never throws and returns nothing either way** (no enumeration). Assert the stored value is a hash, not the raw token, and that the emailed link contains the raw token.
- **`confirmMembershipCancel`** (fake payload): valid token → updates member to `status: 'cancelled'` and clears the token fields; expired token → `{ ok: false, reason: 'expired' }`, no update; unknown/used token → `{ ok: false, reason: 'invalid' }`, no update.
- **Hashing**: confirming with the raw token matches the stored hash; a wrong token doesn't.
- **Manual:** request on the page → receive email → confirm page shows membership + button → confirm → Square subscription shows canceled in the sandbox; expired/reused link shows the invalid page.

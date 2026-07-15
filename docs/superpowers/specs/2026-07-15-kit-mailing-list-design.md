# Kit Mailing List Integration — Design

**Date:** 2026-07-15
**Status:** Approved

## Goal

A mailing list for the studio, powered by Kit (formerly ConvertKit) on its free
plan. Visitors join from the website; admins manage subscribers and compose &
send newsletters from the Payload admin UI. Kit is the single source of truth
for the subscriber list — we store no local copy.

## Decisions (settled during brainstorming)

- **Kit is the list.** Signups, unsubscribes, and the subscriber roster live in
  Kit. The admin UI reads and writes Kit live over the v4 API. No mirror
  collection, no sync jobs, no drift.
- **Single opt-in.** Public signups become active subscribers immediately (no
  confirmation email). Bot defense compensates (see Public signup).
- **Free plan, plain API key.** Confirmed against Kit's docs: v4 API keys are
  available on every plan including free ("creators on any plan can generate
  API keys"), and the Broadcasts API creates and sends email broadcasts with
  HTML `content` and a `send_at` timestamp. No OAuth app needed. Kit appends
  its own unsubscribe footer to every broadcast — compliance is handled by Kit.
- **Compose in Payload, branded shell.** Admins write newsletters in the
  Lexical rich-text editor (with images) inside the admin. On send we render to
  email-safe HTML and wrap it in one hardcoded Portside-branded template.
- **Testing on the dev droplet (brianwells.org) with a separate free Kit dev
  account.** Prod (portsidepottery.com) is live; its own `KIT_API_KEY` lands
  only at rollout. Test sends physically cannot reach real subscribers.

## Architecture

```
Frontend footer form ─┐
Booking checkout ─────┼→ /api/newsletter → services/newsletter.ts ─┐
Contact form opt-in ──┘                                            │
                                                                   ├→ lib/kit.ts → Kit v4 API
Admin Subscribers view (live list / add / unsubscribe) ────────────┤
Admin Newsletters collection → send endpoint → Lexical→HTML→shell ─┘
```

### 1. Kit client — `src/lib/kit.ts`

Small typed fetch wrapper over the v4 endpoints we use, authenticated with
`KIT_API_KEY` (server-only env, never `NEXT_PUBLIC`):

- create/upsert subscriber (single opt-in; Kit upserts on duplicate email)
- list subscribers (cursor pagination, email search)
- unsubscribe subscriber
- create broadcast (`subject`, HTML `content`, `send_at: now` to send
  immediately; omit `subscriber_filter` to reach the whole list)

Missing/blank `KIT_API_KEY` degrades gracefully: public signup returns a
friendly "not available right now" error; the admin view renders a setup
notice instead of a list. Exact auth header and endpoint shapes verified
against developers.kit.com at implementation time.

### 2. Public signup

- `NewsletterSignup` component in the site footer (every page): email field +
  button. On success the form is replaced with "You're on the list!"
- `POST /api/newsletter` route → `src/services/newsletter.ts` →
  `subscribeToNewsletter()`.
- Bot defense mirrors the contact form exactly (`src/services/contact.ts`):
  honeypot field + minimum-fill-time check, both returning **silent success**
  so bots get no signal; then email-shape validation; then the Kit call.
- Duplicate signups are harmless — Kit upserts by email.

### 3. Auto-subscribe in existing flows

An unchecked-by-default **"Email me studio news"** checkbox on:

- the booking checkout form
- the contact form

When checked, the server subscribes the person **after** the primary action
succeeds, best-effort: a Kit failure is logged but never fails the booking or
the contact message.

### 4. Admin — `newsletters` collection (compose & send)

New collection, access admin/editor only (create/update/read); group Studio.

Fields:

- `subject` (text, required)
- `body` (Lexical rich text; image uploads via the existing R2-backed `media`
  collection)
- Sidebar, stamped on send: `status` (`draft` → `sent`), `sentAt`,
  `kitBroadcastId`, `recipientCount`

Edit view gets two custom actions:

- **Send test to me** — renders the newsletter (same pipeline as a real send)
  and emails it to the logged-in admin via the existing Resend email adapter.
  Proof in a real inbox without touching Kit.
- **Send to subscribers** — confirm dialog showing the live Kit subscriber
  count, then a custom collection endpoint (`POST /api/newsletters/:id/send`):
  1. Lexical → HTML via Payload's `convertLexicalToHTML`
  2. wrap in the branded shell (`src/lib/newsletter-template.ts`): logo
     header, studio colors, footer; image URLs made absolute
  3. `POST /v4/broadcasts` with `send_at: now`
  4. single doc update: `status: sent`, `sentAt`, `kitBroadcastId`,
     `recipientCount`

Guards: the endpoint refuses when `status = sent` **or** `kitBroadcastId` is
already set; a hook rejects edits to sent newsletters so history stays intact.

Supported formatting (the email-safe subset): headings, paragraphs,
bold/italic, links, lists, images. No arbitrary layout — that's what keeps
rendering correct in Gmail/Outlook/Apple Mail.

### 5. Admin — Subscribers view

Custom admin view + nav link (same pattern as the Members view /
`MembersNavLink`): lists Kit subscribers live — email, name, status, signup
date — with email search, a small add-subscriber form, and per-row
Unsubscribe. Kit cursor pagination behind next/prev. Nothing stored locally.

## Error handling

- **Kit API down:** signup → friendly error; admin views → error state; sends
  fail loudly and the doc stays `draft`.
- **Broadcast created but doc update fails:** minimized by writing
  `kitBroadcastId` + `status` in one update immediately after the API call;
  the send guard (refuse when `kitBroadcastId` set) prevents double-send on
  retry. Residual risk window is one failed DB write, logged loudly.
- **Booking/contact flows:** auto-subscribe errors are swallowed (logged) —
  never block the primary action.

## Testing

- Unit/int tests (existing vitest setup, `tests/int`) with a mocked Kit
  client: subscribe validation + silent bot drops; send flow state
  transitions and double-send guard; rendered-HTML snapshot of the branded
  template.
- Manual E2E on the **brianwells.org dev droplet** against the **separate
  free Kit dev account**: footer signup, booking/contact opt-in, admin
  subscriber list, test-send, real broadcast to the dev list.
- Prod rollout: create prod Kit account key, add `KIT_API_KEY` to the prod
  droplet env, deploy, smoke-test signup + subscriber view.

## Out of scope (YAGNI)

- Sequences/automations, tags/segments, scheduled sends (Kit dashboard can do
  these later; `send_at` makes scheduling an easy future add)
- Double opt-in
- Mirroring subscribers into Payload or linking them to People
- Custom email template editing in the admin (the shell is code)

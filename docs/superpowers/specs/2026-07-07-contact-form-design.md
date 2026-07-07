# Contact Form — Design Spec

**Date:** 2026-07-07
**Status:** Approved (design), pending implementation plan

## Goal

A public `/contact` page with a simple form (name, email, message) that emails
the studio's notify address with `Reply-To` set to the visitor's email, so staff
reply directly from their inbox. Nothing is stored in the database.

## Non-goals (YAGNI)

- No DB record of submissions (pure email relay, per request).
- No CAPTCHA — honeypot + minimum-time check only.
- No phone/subject fields.
- No attachment support.

## Components

### `sendEmail` gains `replyTo`
`src/lib/email.ts`: add optional `replyTo?: string` to `EmailInput`, passed to
Resend's `replyTo`. Backward-compatible; existing callers unchanged.

### API route: `POST /api/contact` (`src/app/api/contact/route.ts`)
- Body (form or JSON): `name`, `email`, `message`, plus anti-spam fields below.
- Validation: all three required, trimmed non-empty; `email` must match a basic
  email shape; `message` capped (e.g. 5,000 chars) to bound abuse.
- **Anti-spam (silent):**
  - Honeypot: a hidden field named `website`. If non-empty → respond
    `{ ok: true }` WITHOUT sending (bots see success; no signal to adapt).
  - Minimum-time: the form includes a `startedAt` timestamp rendered at page
    load; if submit arrives < 3 seconds later → same silent success. (The
    timestamp is client-provided and spoofable — acceptable; this only filters
    dumb bots, which is the stated goal.)
- On pass: `sendEmail({ to: <notify email>, replyTo: <visitor email>,
  subject: "New message from <name> — website contact form",
  html: <name, email, message with line breaks preserved, HTML-escaped> })`.
  The notify address resolves via the existing `getNotifyEmail(payload)`
  (Site Settings email, `STAFF_NOTIFY_EMAIL` fallback).
- Errors: send failure → 500 with a friendly "couldn't send, email us directly
  at <address>" message; validation failure → 400 with the field problem.
- **HTML-escape** the user-supplied values before interpolating into the email
  body (this is the one injection surface).

### Page: `/contact` (`src/app/(frontend)/contact/page.tsx` + `ContactForm.tsx`)
- Server page (title, intro copy, the studio email as a fallback link) +
  `'use client'` form component, styled like `FiringRequestForm` (existing
  public-form pattern: pp-btn, field styles, success/error states).
- Success state replaces the form with "Thanks — we'll get back to you soon."
- The honeypot field is visually hidden (CSS, not `display:none` inline where
  some bots skip it — use the established off-screen technique) and excluded
  from tab order (`tabIndex={-1}`, `autoComplete="off"`).

### Navigation
- Header desktop nav + MobileNav: add "Contact" (before "Visit Us").
- Footer "Explore" column: add Contact link.

## Testing (integration, `tests/int/`)
- Valid submission → sendEmail called with notify address, visitor replyTo,
  escaped body (unit-test the route handler with a mocked sendEmail).
- Honeypot filled → ok:true, sendEmail NOT called.
- Too-fast submit → ok:true, sendEmail NOT called.
- Missing/invalid fields → 400, sendEmail NOT called.
- HTML in message → escaped in the produced body.

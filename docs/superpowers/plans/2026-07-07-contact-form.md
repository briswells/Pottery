# Contact Form Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A public `/contact` page whose form emails the studio's notify address with Reply-To set to the visitor, storing nothing in the DB.

**Architecture:** A `submitContactMessage` service (dependency-injected `sendEmail`, mirroring `createPaidBooking`'s testable style) holds validation + anti-spam + escaping; a thin `POST /api/contact` route wires real deps; a small client form component renders on a new server page. Spec: `docs/superpowers/specs/2026-07-07-contact-form-design.md`.

**Tech Stack:** Payload 3.85 local API (only for notify-email lookup), Next.js 16 route handlers + server components, Resend via `src/lib/email.ts`, Vitest integration tests.

## Global Constraints

- Anti-spam is SILENT: honeypot filled or submit < 3000 ms after `startedAt` → return success WITHOUT sending (no signal to bots).
- User-supplied values are HTML-escaped before interpolation into the email body.
- Recipient resolves via the existing `getNotifyEmail(payload)` (Site Settings email, `STAFF_NOTIFY_EMAIL` fallback) — never hard-code an address.
- Email subject: `New message from <name> — website contact form`.
- Tests: `tests/int/<name>.int.spec.ts`, run with `pnpm test:int tests/int/<file>`; boot Payload via `getTestPayload()` from `./helpers`. NODE_ENV=test skips onInit; the Postgres adapter `push` builds the schema (no schema changes in this plan, so no test-DB recreate and no migration).
- Follow existing form styling (`pp-input`, `pp-btn`) and the thin-route pattern of `src/app/api/bookings/route.ts`.

---

### Task 1: `sendEmail` gains `replyTo`

**Files:**
- Modify: `src/lib/email.ts`
- Test: `tests/int/email-replyto.int.spec.ts`

**Interfaces:**
- Produces: `EmailInput` gains `replyTo?: string`; `sendEmail` forwards it to Resend as `replyTo`. All existing callers unchanged.

- [ ] **Step 1: Write the failing test**

```ts
// tests/int/email-replyto.int.spec.ts
import { describe, it, expect, vi } from 'vitest'

const send = vi.hoisted(() => vi.fn(async () => ({ data: { id: 'em_1' }, error: null })))
vi.mock('resend', () => ({
  Resend: class {
    emails = { send }
  },
}))

import { sendEmail } from '../../src/lib/email'

describe('sendEmail replyTo', () => {
  it('forwards replyTo to Resend when provided', async () => {
    await sendEmail({ to: 'a@b.co', subject: 's', html: '<p>x</p>', replyTo: 'visitor@x.co' })
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ replyTo: 'visitor@x.co' }))
  })

  it('omits replyTo when not provided', async () => {
    send.mockClear()
    await sendEmail({ to: 'a@b.co', subject: 's', html: '<p>x</p>' })
    expect(send.mock.calls[0][0]).not.toHaveProperty('replyTo')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:int tests/int/email-replyto.int.spec.ts`
Expected: FAIL — first test's `expect.objectContaining({ replyTo: ... })` unmatched (sendEmail drops the unknown field).

- [ ] **Step 3: Implement**

In `src/lib/email.ts`, add `replyTo?: string` to `EmailInput` and forward it:

```ts
export interface EmailInput {
  to: string
  subject: string
  html: string
  attachments?: EmailAttachment[]
  /** Sets the Reply-To header — e.g. a contact-form visitor's address. */
  replyTo?: string
}
```

and in `sendEmail`, destructure `replyTo` and add to the send call:

```ts
export async function sendEmail({ to, subject, html, attachments, replyTo }: EmailInput): Promise<void> {
  const { error } = await getResend().emails.send({
    from: process.env.EMAIL_FROM!,
    to,
    subject,
    html,
    ...(attachments ? { attachments } : {}),
    ...(replyTo ? { replyTo } : {}),
  })
  if (error) throw new Error(`Email send failed: ${error.message}`)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:int tests/int/email-replyto.int.spec.ts`
Expected: PASS (both).

- [ ] **Step 5: Commit**

```bash
git add src/lib/email.ts tests/int/email-replyto.int.spec.ts
git commit -m "feat(email): optional replyTo on sendEmail"
```

---

### Task 2: `submitContactMessage` service

**Files:**
- Create: `src/services/contact.ts`
- Test: `tests/int/contact-service.int.spec.ts`

**Interfaces:**
- Consumes: `sendEmail` (Task 1 signature), `getNotifyEmail(payload)` from `src/lib/notify-email.ts`.
- Produces:
  ```ts
  interface ContactDeps { payload: Payload; sendEmail: (input: EmailInput) => Promise<void> }
  interface ContactInput { name: string; email: string; message: string; website?: string; startedAt?: number }
  type ContactResult = { ok: true } | { ok: false; status: 400 | 500; error: string }
  function submitContactMessage(deps: ContactDeps, input: ContactInput): Promise<ContactResult>
  ```
  Silent spam drops return `{ ok: true }` without sending.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/int/contact-service.int.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getTestPayload } from './helpers'
import { submitContactMessage } from '../../src/services/contact'

const OLD_ENV = process.env.STAFF_NOTIFY_EMAIL

function deps(sendEmail = vi.fn(async () => {})) {
  return { sendEmail }
}
const VALID = { name: 'Jo Potter', email: 'jo@example.com', message: 'Hi there!\n<b>Do you fire?</b>', startedAt: Date.now() - 10_000 }

describe('submitContactMessage', () => {
  beforeEach(() => {
    process.env.STAFF_NOTIFY_EMAIL = OLD_ENV || 'staff@test.local'
  })

  it('sends to the notify address with visitor replyTo and escaped body', async () => {
    const payload = await getTestPayload()
    const d = deps()
    const res = await submitContactMessage({ payload, ...d }, VALID)
    expect(res).toEqual({ ok: true })
    expect(d.sendEmail).toHaveBeenCalledTimes(1)
    const arg: any = d.sendEmail.mock.calls[0][0]
    expect(arg.to).toBeTruthy() // site-settings email or STAFF_NOTIFY_EMAIL fallback
    expect(arg.replyTo).toBe('jo@example.com')
    expect(arg.subject).toBe('New message from Jo Potter — website contact form')
    expect(arg.html).toContain('&lt;b&gt;Do you fire?&lt;/b&gt;') // escaped
    expect(arg.html).not.toContain('<b>Do you fire?</b>')
    expect(arg.html).toContain('<br') // newline preserved as line break
  })

  it('silently succeeds without sending when the honeypot is filled', async () => {
    const payload = await getTestPayload()
    const d = deps()
    const res = await submitContactMessage({ payload, ...d }, { ...VALID, website: 'http://spam.example' })
    expect(res).toEqual({ ok: true })
    expect(d.sendEmail).not.toHaveBeenCalled()
  })

  it('silently succeeds without sending when submitted too fast', async () => {
    const payload = await getTestPayload()
    const d = deps()
    const res = await submitContactMessage({ payload, ...d }, { ...VALID, startedAt: Date.now() - 500 })
    expect(res).toEqual({ ok: true })
    expect(d.sendEmail).not.toHaveBeenCalled()
  })

  it('rejects missing fields and a bad email with 400', async () => {
    const payload = await getTestPayload()
    const d = deps()
    expect(await submitContactMessage({ payload, ...d }, { ...VALID, name: '  ' })).toMatchObject({ ok: false, status: 400 })
    expect(await submitContactMessage({ payload, ...d }, { ...VALID, message: '' })).toMatchObject({ ok: false, status: 400 })
    expect(await submitContactMessage({ payload, ...d }, { ...VALID, email: 'not-an-email' })).toMatchObject({ ok: false, status: 400 })
    expect(d.sendEmail).not.toHaveBeenCalled()
  })

  it('caps message length with 400', async () => {
    const payload = await getTestPayload()
    const d = deps()
    const res = await submitContactMessage({ payload, ...d }, { ...VALID, message: 'x'.repeat(5001) })
    expect(res).toMatchObject({ ok: false, status: 400 })
  })

  it('returns 500 with a friendly message when send fails', async () => {
    const payload = await getTestPayload()
    const d = deps(vi.fn(async () => { throw new Error('resend down') }))
    const res = await submitContactMessage({ payload, ...d }, VALID)
    expect(res).toMatchObject({ ok: false, status: 500 })
    expect((res as any).error).toMatch(/email us directly/i)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test:int tests/int/contact-service.int.spec.ts`
Expected: FAIL — module `../../src/services/contact` not found.

- [ ] **Step 3: Implement the service**

```ts
// src/services/contact.ts
import type { Payload } from 'payload'
import type { EmailInput } from '../lib/email'
import { getNotifyEmail } from '../lib/notify-email'

export interface ContactDeps {
  payload: Payload
  sendEmail: (input: EmailInput) => Promise<void>
}

export interface ContactInput {
  name: string
  email: string
  message: string
  /** Honeypot — real users never fill this; any value means a bot. */
  website?: string
  /** Client render timestamp (ms). Submits < MIN_FILL_MS later are bots. */
  startedAt?: number
}

export type ContactResult = { ok: true } | { ok: false; status: 400 | 500; error: string }

const MAX_MESSAGE_CHARS = 5000
const MIN_FILL_MS = 3000
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/**
 * Relay a contact-form message to the studio's notify address with Reply-To set
 * to the visitor. Nothing is stored. Honeypot/too-fast submissions return
 * success WITHOUT sending so bots get no signal.
 */
export async function submitContactMessage(deps: ContactDeps, input: ContactInput): Promise<ContactResult> {
  const name = (input.name ?? '').trim()
  const email = (input.email ?? '').trim()
  const message = (input.message ?? '').trim()

  // Silent bot drops FIRST (before validation, so bots can't probe the rules).
  if (input.website) return { ok: true }
  if (typeof input.startedAt === 'number' && Date.now() - input.startedAt < MIN_FILL_MS) return { ok: true }

  if (!name || !email || !message) return { ok: false, status: 400, error: 'Please fill in your name, email, and message.' }
  if (!EMAIL_SHAPE.test(email)) return { ok: false, status: 400, error: 'Please enter a valid email address.' }
  if (message.length > MAX_MESSAGE_CHARS) return { ok: false, status: 400, error: 'Message is too long.' }

  const to = await getNotifyEmail(deps.payload)
  const fallbackNote = to ? ` at ${to}` : ''
  if (!to) return { ok: false, status: 500, error: 'The contact form is unavailable right now — please email us directly.' }

  try {
    await deps.sendEmail({
      to,
      replyTo: email,
      subject: `New message from ${name} — website contact form`,
      html: `<p><strong>${escapeHtml(name)}</strong> (${escapeHtml(email)}) wrote:</p><p>${escapeHtml(message).replaceAll('\n', '<br/>')}</p>`,
    })
    return { ok: true }
  } catch (e) {
    console.error('Contact form send failed:', e)
    return { ok: false, status: 500, error: `We couldn't send your message — please email us directly${fallbackNote}.` }
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test:int tests/int/contact-service.int.spec.ts`
Expected: PASS (all 6). Note: the first test asserts `arg.to` is truthy rather than a fixed address because the test DB's Site Settings may or may not carry an email — the resolution chain itself is already covered by notify-email usage elsewhere.

- [ ] **Step 5: Commit**

```bash
git add src/services/contact.ts tests/int/contact-service.int.spec.ts
git commit -m "feat(contact): contact message service with silent spam drops"
```

---

### Task 3: Route, page, form, and nav links

**Files:**
- Create: `src/app/api/contact/route.ts`
- Create: `src/app/(frontend)/contact/page.tsx`
- Create: `src/app/(frontend)/contact/ContactForm.tsx`
- Modify: `src/app/(frontend)/components/Header.tsx` (desktop nav — add Contact before Visit Us)
- Modify: `src/app/(frontend)/components/MobileNav.tsx` (same)
- Modify: `src/app/(frontend)/components/Footer.tsx` (Explore list — add Contact)

**Interfaces:**
- Consumes: `submitContactMessage(deps, input): Promise<ContactResult>` (Task 2).
- Produces: public `POST /api/contact` accepting JSON `{ name, email, message, website?, startedAt? }` → `{ ok: true }` or `{ error }` with the service's status.

- [ ] **Step 1: Create the route (thin, mirrors bookings route style)**

```ts
// src/app/api/contact/route.ts
import { getPayload } from 'payload'
import config from '@payload-config'
import { sendEmail } from '../../../lib/email'
import { submitContactMessage } from '../../../services/contact'

export async function POST(req: Request) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const payload = await getPayload({ config: await config })
  const result = await submitContactMessage(
    { payload, sendEmail },
    {
      name: String(body?.name ?? ''),
      email: String(body?.email ?? ''),
      message: String(body?.message ?? ''),
      website: body?.website ? String(body.website) : undefined,
      startedAt: typeof body?.startedAt === 'number' ? body.startedAt : undefined,
    },
  )
  if (result.ok) return Response.json({ ok: true })
  return Response.json({ error: result.error }, { status: result.status })
}
```

- [ ] **Step 2: Create the client form**

```tsx
// src/app/(frontend)/contact/ContactForm.tsx
'use client'
import { useRef, useState } from 'react'

export function ContactForm() {
  // Captured once at mount; the server rejects submits arriving too soon after.
  const startedAt = useRef(Date.now())
  const [form, setForm] = useState({ name: '', email: '', message: '', website: '' })
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, startedAt: startedAt.current }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Something went wrong.')
      setSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setBusy(false)
    }
  }

  if (sent) return <p style={{ marginTop: 24, fontWeight: 600 }}>Thanks — we&apos;ll get back to you soon.</p>

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 10, marginTop: 24, maxWidth: 480 }}>
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
      <textarea
        required
        className="pp-input"
        aria-label="Message"
        placeholder="How can we help?"
        rows={6}
        value={form.message}
        onChange={(e) => setForm({ ...form, message: e.target.value })}
      />
      {/* Honeypot: hidden off-screen, excluded from tab order; bots fill it, people can't. */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        style={{ position: 'absolute', left: '-9999px', height: 0, width: 0, opacity: 0 }}
        value={form.website}
        onChange={(e) => setForm({ ...form, website: e.target.value })}
      />
      <button className="pp-btn" type="submit" disabled={busy}>
        {busy ? 'Sending…' : 'Send message'}
      </button>
      {error && <p style={{ color: '#b3261e' }}>{error}</p>}
    </form>
  )
}
```

- [ ] **Step 3: Create the page**

```tsx
// src/app/(frontend)/contact/page.tsx
import { getPayload } from 'payload'
import config from '@payload-config'
import { resolveNotifyEmail } from '../../../lib/notify-email'
import { ContactForm } from './ContactForm'

export const metadata = {
  title: 'Contact',
  description: 'Get in touch with Portside Pottery — questions, classes, visits.',
}

export const dynamic = 'force-dynamic'

export default async function ContactPage() {
  const payload = await getPayload({ config: await config })
  const settings = await payload.findGlobal({ slug: 'site-settings' })
  const email = resolveNotifyEmail(settings.email)

  return (
    <div style={{ padding: '40px 0', maxWidth: 680 }}>
      <h1>Contact us</h1>
      <p style={{ color: 'var(--pp-muted)', lineHeight: 1.7, maxWidth: 560 }}>
        Questions about classes, membership, or visiting the studio? Send us a note and
        we&apos;ll get back to you{email ? <> — or email us directly at <a href={`mailto:${email}`}>{email}</a></> : null}.
      </p>
      <ContactForm />
    </div>
  )
}
```

- [ ] **Step 4: Add nav links**

In `src/app/(frontend)/components/Header.tsx`, the desktop nav currently reads:
```tsx
          <Link href="/staff">Meet the Staff</Link>
          <Link href="/visit">Visit Us</Link>
```
Insert Contact between Staff and Visit Us:
```tsx
          <Link href="/staff">Meet the Staff</Link>
          <Link href="/contact">Contact</Link>
          <Link href="/visit">Visit Us</Link>
```
Make the same insertion in `src/app/(frontend)/components/MobileNav.tsx` (its links carry `onClick={() => setOpen(false)}`):
```tsx
        <Link href="/contact" onClick={() => setOpen(false)}>Contact</Link>
```
In `src/app/(frontend)/components/Footer.tsx`, the Explore `<ul>` currently ends with:
```tsx
            <li><Link href="/visit">Visit Us</Link></li>
```
Add before it:
```tsx
            <li><Link href="/contact">Contact</Link></li>
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit -p tsconfig.json` → exit 0.
Run: `npx eslint "src/app/api/contact/route.ts" "src/app/(frontend)/contact/page.tsx" "src/app/(frontend)/contact/ContactForm.tsx"` → no errors.
Run: `pnpm test:int tests/int/contact-service.int.spec.ts` → still PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/contact src/app/\(frontend\)/contact src/app/\(frontend\)/components/Header.tsx src/app/\(frontend\)/components/MobileNav.tsx src/app/\(frontend\)/components/Footer.tsx
git commit -m "feat(contact): /contact page, form, API route, nav links"
```

---

## Deployment (after all tasks)

Standard loop (no migration — no schema change): build `linux/amd64` → `docker save | ssh docker load` → recreate app. Verify live: `/contact` renders, a real submission arrives at the notify inbox with Reply-To set, and a submission with the honeypot filled sends nothing.

## Self-Review notes
- Spec coverage: replyTo (T1), validation/honeypot/min-time/escaping/notify-address/subject/error copy (T2), route/page/form/hidden-honeypot/nav (T3). No DB storage anywhere — matches spec.
- The honeypot uses off-screen positioning (not `display:none`) and `tabIndex={-1}`/`aria-hidden`, per spec.

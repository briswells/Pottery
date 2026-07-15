# Kit Mailing List Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Newsletter powered by Kit (ConvertKit) free plan — public signup on the site, opt-in checkboxes in booking/contact flows, and an admin UI to manage subscribers and compose & send branded broadcasts. Kit is the sole source of truth for the list.

**Architecture:** A thin typed Kit v4 client (`src/lib/kit.ts`) is the only place that talks to Kit. Services take the client's functions as injected deps (same DI style as `src/services/contact.ts`) so tests never touch the network. A new `newsletters` Payload collection holds drafts/history; its custom endpoints render Lexical → email-safe HTML inside a hardcoded branded shell and create a Kit broadcast. A custom admin view lists Kit subscribers live.

**Tech Stack:** Next.js 16 App Router, Payload CMS 3.85 (Postgres/drizzle), `@payloadcms/richtext-lexical` 3.85 (`convertLexicalToHTML`), Kit v4 REST API, Resend (test-sends only), vitest int tests.

**Spec:** `docs/superpowers/specs/2026-07-15-kit-mailing-list-design.md`

## Global Constraints

- Kit v4 API: base `https://api.kit.com/v4`, auth header `X-Kit-Api-Key`, key from env `KIT_API_KEY` (server-only — never `NEXT_PUBLIC_*`, never committed).
- Missing `KIT_API_KEY` must degrade gracefully everywhere (friendly errors / setup notice), never crash.
- Single opt-in. Bot defense on the public form mirrors `src/services/contact.ts` exactly: honeypot field named `website` + `startedAt` min-fill-time of 3000ms, both returning **silent success**.
- Auto-subscribe from booking/contact is best-effort: a Kit failure is logged and swallowed, never fails the primary action.
- The running production system uses migrations (`push` is off when `NODE_ENV=production`) — the new collection REQUIRES a committed Payload migration (Task 11).
- Commit messages: conventional style (`feat:`, `fix:`, `test:`), NO AI attribution/Co-Authored-By lines.
- Package manager is `pnpm`. Int tests: `pnpm run test:int` (needs local Postgres with `portside_test` DB; `DATABASE_URL_TEST` in `.env`). Run a single file with `pnpm run test:int tests/int/<file>.int.spec.ts`.
- Deploy target for testing is the **brianwells.org dev droplet (root@206.189.255.28)** with the dev Kit account key. Production (portsidepottery.com, root@138.197.232.44) is LIVE — do not deploy there in this plan.
- Roles gate for everything admin-side: user from the `users` collection with role `admin` or `editor`.

---

### Task 1: Kit v4 API client

**Files:**
- Create: `src/lib/kit.ts`
- Modify: `.env.example` (append `KIT_API_KEY=`)
- Test: `tests/int/kit-client.int.spec.ts`

**Interfaces:**
- Consumes: nothing (leaf module; `fetch`, `process.env.KIT_API_KEY`)
- Produces (used by Tasks 2, 5, 8, 10):
  - `kitEnabled(): boolean`
  - `class KitError extends Error { status: number }`
  - `interface KitSubscriber { id: number; email_address: string; first_name: string | null; state: string; created_at: string }`
  - `createKitSubscriber(input: { email: string; firstName?: string }): Promise<KitSubscriber>`
  - `interface KitSubscriberPage { subscribers: KitSubscriber[]; startCursor: string | null; endCursor: string | null; hasNextPage: boolean; hasPrevPage: boolean; totalCount: number | null }`
  - `listKitSubscribers(opts?: { after?: string; before?: string; emailSearch?: string }): Promise<KitSubscriberPage>`
  - `countKitSubscribers(): Promise<number | null>`
  - `unsubscribeKitSubscriber(id: number): Promise<void>`
  - `createKitBroadcast(input: { subject: string; contentHtml: string; sendAt: Date }): Promise<{ id: number }>`

- [ ] **Step 1: Write the failing test**

```ts
// tests/int/kit-client.int.spec.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  kitEnabled,
  KitError,
  createKitSubscriber,
  listKitSubscribers,
  unsubscribeKitSubscriber,
  createKitBroadcast,
} from '../../src/lib/kit'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const OLD_KEY = process.env.KIT_API_KEY

describe('kit client', () => {
  beforeEach(() => {
    process.env.KIT_API_KEY = 'kit_test_key'
  })
  afterEach(() => {
    process.env.KIT_API_KEY = OLD_KEY
    vi.unstubAllGlobals()
  })

  it('kitEnabled reflects the env var', () => {
    expect(kitEnabled()).toBe(true)
    delete process.env.KIT_API_KEY
    expect(kitEnabled()).toBe(false)
  })

  it('createKitSubscriber posts email/first_name with the auth header and unwraps subscriber', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ subscriber: { id: 7, email_address: 'jo@example.com', first_name: 'Jo', state: 'active', created_at: 'x' } }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const sub = await createKitSubscriber({ email: 'jo@example.com', firstName: 'Jo' })
    expect(sub.id).toBe(7)
    const [url, init]: any[] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.kit.com/v4/subscribers')
    expect(init.method).toBe('POST')
    expect(init.headers['X-Kit-Api-Key']).toBe('kit_test_key')
    expect(JSON.parse(init.body)).toEqual({ email_address: 'jo@example.com', first_name: 'Jo' })
  })

  it('listKitSubscribers maps cursors, flags, and total count', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        subscribers: [{ id: 1, email_address: 'a@b.co', first_name: null, state: 'active', created_at: 'x' }],
        pagination: { has_previous_page: false, has_next_page: true, start_cursor: 'S', end_cursor: 'E', total_count: 41 },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const page = await listKitSubscribers({ after: 'CUR', emailSearch: 'a@b.co' })
    expect(page.subscribers).toHaveLength(1)
    expect(page).toMatchObject({ startCursor: 'S', endCursor: 'E', hasNextPage: true, hasPrevPage: false, totalCount: 41 })
    const url: string = (fetchMock.mock.calls as any[])[0][0]
    expect(url).toContain('include_total_count=true')
    expect(url).toContain('after=CUR')
    expect(url).toContain(encodeURIComponent('a@b.co'))
  })

  it('unsubscribeKitSubscriber handles a 204 empty response', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(unsubscribeKitSubscriber(9)).resolves.toBeUndefined()
    expect((fetchMock.mock.calls as any[])[0][0]).toBe('https://api.kit.com/v4/subscribers/9/unsubscribe')
  })

  it('createKitBroadcast sends subject/content/send_at/public:false and returns the id', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ broadcast: { id: 55 } }, 201))
    vi.stubGlobal('fetch', fetchMock)
    const when = new Date('2026-07-16T17:00:00.000Z')
    const res = await createKitBroadcast({ subject: 'Hi', contentHtml: '<p>Yo</p>', sendAt: when })
    expect(res).toEqual({ id: 55 })
    const body = JSON.parse((fetchMock.mock.calls as any[])[0][1].body)
    expect(body).toEqual({ subject: 'Hi', content: '<p>Yo</p>', send_at: '2026-07-16T17:00:00.000Z', public: false })
  })

  it('throws KitError with status on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })))
    await expect(createKitSubscriber({ email: 'a@b.co' })).rejects.toMatchObject({ status: 401 })
    await expect(createKitSubscriber({ email: 'a@b.co' })).rejects.toBeInstanceOf(KitError)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test:int tests/int/kit-client.int.spec.ts`
Expected: FAIL — `Cannot find module '../../src/lib/kit'`

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/kit.ts
/**
 * Minimal typed client for the Kit (ConvertKit) v4 API. Kit is the source of
 * truth for the mailing list — nothing here is mirrored locally. Free-plan
 * API-key auth; rate limit is 120 req/rolling minute, far above studio volume.
 */

const KIT_BASE = 'https://api.kit.com/v4'

export class KitError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** True when a Kit API key is configured — the whole feature is off without one. */
export function kitEnabled(): boolean {
  return Boolean(process.env.KIT_API_KEY)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function kitFetch(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${KIT_BASE}${path}`, {
    ...init,
    headers: {
      'X-Kit-Api-Key': process.env.KIT_API_KEY ?? '',
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new KitError(res.status, `Kit API ${res.status} on ${path}: ${text.slice(0, 300)}`)
  }
  if (res.status === 204) return null
  return res.json()
}

export interface KitSubscriber {
  id: number
  email_address: string
  first_name: string | null
  state: string
  created_at: string
}

/** Create (or upsert — Kit dedupes by email) an active subscriber. Single opt-in. */
export async function createKitSubscriber(input: { email: string; firstName?: string }): Promise<KitSubscriber> {
  const data = await kitFetch('/subscribers', {
    method: 'POST',
    body: JSON.stringify({
      email_address: input.email,
      ...(input.firstName ? { first_name: input.firstName } : {}),
    }),
  })
  return data.subscriber
}

export interface KitSubscriberPage {
  subscribers: KitSubscriber[]
  startCursor: string | null
  endCursor: string | null
  hasNextPage: boolean
  hasPrevPage: boolean
  totalCount: number | null
}

export async function listKitSubscribers(
  opts: { after?: string; before?: string; emailSearch?: string } = {},
): Promise<KitSubscriberPage> {
  const params = new URLSearchParams({ include_total_count: 'true' })
  if (opts.after) params.set('after', opts.after)
  if (opts.before) params.set('before', opts.before)
  if (opts.emailSearch) params.set('email_address', opts.emailSearch)
  const data = await kitFetch(`/subscribers?${params}`)
  return {
    subscribers: data.subscribers ?? [],
    startCursor: data.pagination?.start_cursor ?? null,
    endCursor: data.pagination?.end_cursor ?? null,
    hasNextPage: Boolean(data.pagination?.has_next_page),
    hasPrevPage: Boolean(data.pagination?.has_previous_page),
    totalCount: data.pagination?.total_count ?? data.total_count ?? null,
  }
}

/** Active-subscriber total, used for the send-confirm dialog and the sent stamp. */
export async function countKitSubscribers(): Promise<number | null> {
  const page = await listKitSubscribers()
  return page.totalCount
}

export async function unsubscribeKitSubscriber(id: number): Promise<void> {
  await kitFetch(`/subscribers/${id}/unsubscribe`, { method: 'POST' })
}

/** Create a broadcast that Kit sends at `sendAt` (pass "now" to send immediately).
 *  Kit appends its own unsubscribe footer. `public: false` keeps it email-only. */
export async function createKitBroadcast(input: {
  subject: string
  contentHtml: string
  sendAt: Date
}): Promise<{ id: number }> {
  const data = await kitFetch('/broadcasts', {
    method: 'POST',
    body: JSON.stringify({
      subject: input.subject,
      content: input.contentHtml,
      send_at: input.sendAt.toISOString(),
      public: false,
    }),
  })
  return { id: data.broadcast.id }
}
```

Also append to `.env.example`:

```
# Kit (ConvertKit) mailing list — v4 API key from Settings → Developer. Optional; feature is off without it.
KIT_API_KEY=
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run test:int tests/int/kit-client.int.spec.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/kit.ts tests/int/kit-client.int.spec.ts .env.example
git commit -m "feat(newsletter): Kit v4 API client"
```

---

### Task 2: Public subscribe service + `/api/newsletter` route

**Files:**
- Create: `src/services/newsletter.ts`
- Create: `src/app/api/newsletter/route.ts`
- Test: `tests/int/newsletter-subscribe.int.spec.ts`

**Interfaces:**
- Consumes: `kitEnabled`, `createKitSubscriber` from `src/lib/kit` (route only — the service takes an injected `createSubscriber`)
- Produces (used by Tasks 3, 4):
  - `interface NewsletterSubscribeDeps { createSubscriber: (input: { email: string; firstName?: string }) => Promise<unknown> }`
  - `interface NewsletterSignupInput { email: string; firstName?: string; website?: string; startedAt?: number }`
  - `type NewsletterResult = { ok: true } | { ok: false; status: 400 | 500; error: string }`
  - `subscribeToNewsletter(deps, input): Promise<NewsletterResult>`
  - HTTP: `POST /api/newsletter` body `{ email, firstName?, website?, startedAt? }` → `{ ok: true }` | `{ error }` (400/500/503)

- [ ] **Step 1: Write the failing test**

```ts
// tests/int/newsletter-subscribe.int.spec.ts
import { describe, it, expect, vi } from 'vitest'
import { subscribeToNewsletter } from '../../src/services/newsletter'

const VALID = { email: 'jo@example.com', startedAt: Date.now() - 10_000 }

function deps(createSubscriber = vi.fn(async () => ({}))) {
  return { createSubscriber }
}

describe('subscribeToNewsletter', () => {
  it('subscribes a valid email', async () => {
    const d = deps()
    const res = await subscribeToNewsletter(d, VALID)
    expect(res).toEqual({ ok: true })
    expect(d.createSubscriber).toHaveBeenCalledWith({ email: 'jo@example.com' })
  })

  it('passes a trimmed first name through', async () => {
    const d = deps()
    await subscribeToNewsletter(d, { ...VALID, firstName: '  Jo\r\nPotter  ' })
    expect(d.createSubscriber).toHaveBeenCalledWith({ email: 'jo@example.com', firstName: 'Jo Potter' })
  })

  it('silently succeeds without subscribing when the honeypot is filled', async () => {
    const d = deps()
    const res = await subscribeToNewsletter(d, { ...VALID, website: 'http://spam.example' })
    expect(res).toEqual({ ok: true })
    expect(d.createSubscriber).not.toHaveBeenCalled()
  })

  it('silently succeeds without subscribing when submitted too fast', async () => {
    const d = deps()
    const res = await subscribeToNewsletter(d, { ...VALID, startedAt: Date.now() - 500 })
    expect(res).toEqual({ ok: true })
    expect(d.createSubscriber).not.toHaveBeenCalled()
  })

  it('rejects a malformed email with 400', async () => {
    const d = deps()
    const res = await subscribeToNewsletter(d, { ...VALID, email: 'not-an-email' })
    expect(res).toMatchObject({ ok: false, status: 400 })
    expect(d.createSubscriber).not.toHaveBeenCalled()
  })

  it('returns a friendly 500 when Kit fails', async () => {
    const d = deps(vi.fn(async () => { throw new Error('kit down') }))
    const res = await subscribeToNewsletter(d, VALID)
    expect(res).toMatchObject({ ok: false, status: 500 })
    expect((res as any).error).toMatch(/try again/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test:int tests/int/newsletter-subscribe.int.spec.ts`
Expected: FAIL — `Cannot find module '../../src/services/newsletter'`

- [ ] **Step 3: Write the service**

```ts
// src/services/newsletter.ts
/**
 * Newsletter signups. Kit (ConvertKit) is the source of truth for the list —
 * this service only validates + bot-filters and forwards to the injected Kit
 * client. Bot defense mirrors services/contact.ts: honeypot + min fill time,
 * both returning silent success so bots get no signal.
 */

export interface NewsletterSubscribeDeps {
  createSubscriber: (input: { email: string; firstName?: string }) => Promise<unknown>
}

export interface NewsletterSignupInput {
  email: string
  firstName?: string
  /** Honeypot — real users never fill this; any value means a bot. */
  website?: string
  /** Client render timestamp (ms). Submits < MIN_FILL_MS later are bots. */
  startedAt?: number
}

export type NewsletterResult = { ok: true } | { ok: false; status: 400 | 500; error: string }

const MIN_FILL_MS = 3000
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function subscribeToNewsletter(
  deps: NewsletterSubscribeDeps,
  input: NewsletterSignupInput,
): Promise<NewsletterResult> {
  const email = (input.email ?? '').trim()
  const firstName = (input.firstName ?? '').replace(/[\r\n\t\v\f  ]+/g, ' ').trim().slice(0, 100)

  // Silent bot drops FIRST (before validation, so bots can't probe the rules).
  if (input.website) return { ok: true }
  if (typeof input.startedAt === 'number' && Date.now() - input.startedAt < MIN_FILL_MS) return { ok: true }

  if (!EMAIL_SHAPE.test(email)) return { ok: false, status: 400, error: 'Please enter a valid email address.' }

  try {
    await deps.createSubscriber({ email, ...(firstName ? { firstName } : {}) })
    return { ok: true }
  } catch (e) {
    console.error('Newsletter signup failed:', e)
    return { ok: false, status: 500, error: "We couldn't add you right now — please try again later." }
  }
}
```

- [ ] **Step 4: Write the route**

```ts
// src/app/api/newsletter/route.ts
import { kitEnabled, createKitSubscriber } from '../../../lib/kit'
import { subscribeToNewsletter } from '../../../services/newsletter'

export async function POST(req: Request) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!kitEnabled()) {
    return Response.json({ error: 'Newsletter signup is unavailable right now.' }, { status: 503 })
  }

  const result = await subscribeToNewsletter(
    { createSubscriber: createKitSubscriber },
    {
      email: String(body?.email ?? ''),
      firstName: body?.firstName ? String(body.firstName) : undefined,
      website: body?.website ? String(body.website) : undefined,
      startedAt: typeof body?.startedAt === 'number' ? body.startedAt : undefined,
    },
  )
  if (result.ok) return Response.json({ ok: true })
  return Response.json({ error: result.error }, { status: result.status })
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm run test:int tests/int/newsletter-subscribe.int.spec.ts && pnpm exec tsc --noEmit`
Expected: PASS (6 tests), tsc clean

- [ ] **Step 6: Commit**

```bash
git add src/services/newsletter.ts src/app/api/newsletter/route.ts tests/int/newsletter-subscribe.int.spec.ts
git commit -m "feat(newsletter): public subscribe service and /api/newsletter route"
```

---

### Task 3: Footer signup component

**Files:**
- Create: `src/app/(frontend)/components/NewsletterSignup.tsx`
- Modify: `src/app/(frontend)/components/Footer.tsx` (brand column, after the tagline `<p>`)

**Interfaces:**
- Consumes: `POST /api/newsletter` (Task 2)
- Produces: `<NewsletterSignup startedAt={number} />` client component

- [ ] **Step 1: Write the component**

```tsx
// src/app/(frontend)/components/NewsletterSignup.tsx
'use client'
import { useState } from 'react'

export function NewsletterSignup({ startedAt }: { startedAt: number }) {
  const [email, setEmail] = useState('')
  const [website, setWebsite] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/newsletter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, website, startedAt }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Something went wrong.')
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setBusy(false)
    }
  }

  if (done) {
    return (
      <p role="status" style={{ marginTop: 14, fontWeight: 600 }}>
        You&apos;re on the list!
      </p>
    )
  }

  return (
    <form onSubmit={submit} style={{ marginTop: 14 }} aria-label="Newsletter signup">
      <label htmlFor="pp-newsletter-email" style={{ display: 'block', fontSize: 14, marginBottom: 6 }}>
        Get studio news &amp; new classes
      </label>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          id="pp-newsletter-email"
          className="pp-input"
          type="email"
          required
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ flex: 1, minWidth: 0 }}
        />
        <button className="pp-btn" type="submit" disabled={busy}>
          {busy ? 'Joining…' : 'Join'}
        </button>
      </div>
      {/* Honeypot: hidden off-screen, excluded from tab order; bots fill it, people can't. */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        style={{ position: 'absolute', left: '-9999px', height: 0, width: 0, opacity: 0 }}
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
      />
      {error && (
        <p role="alert" style={{ color: '#ffb4a8', fontSize: 13, marginTop: 6 }}>
          {error}
        </p>
      )}
    </form>
  )
}
```

- [ ] **Step 2: Wire into the footer**

In `src/app/(frontend)/components/Footer.tsx`, add the import at the top:

```tsx
import { NewsletterSignup } from './NewsletterSignup'
```

and inside the brand column, directly after the `<p className="pp-footer-tagline">…</p>` element, add:

```tsx
          <NewsletterSignup startedAt={Date.now()} />
```

(`Footer` is server-rendered per request, so `Date.now()` is the render timestamp — same bot-timing semantics as the contact page.)

- [ ] **Step 3: Verify locally**

Run: `pnpm exec tsc --noEmit && pnpm run lint`
Expected: clean. Then `pnpm run dev`, load `http://localhost:3000`, scroll to the footer: form renders in the brand column; without `KIT_API_KEY` in `.env`, submitting shows "Newsletter signup is unavailable right now." (that's the graceful-degrade path working). With the dev key in `.env`, a real email shows "You're on the list!" — verify it appears in the Kit dashboard.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(frontend)/components/NewsletterSignup.tsx" "src/app/(frontend)/components/Footer.tsx"
git commit -m "feat(newsletter): footer signup form"
```

---

### Task 4: Contact-form opt-in

**Files:**
- Modify: `src/services/contact.ts` (add optional `subscribe` dep + input flag)
- Modify: `src/app/api/contact/route.ts` (wire the Kit client)
- Modify: `src/app/(frontend)/contact/ContactForm.tsx` (checkbox)
- Test: `tests/int/contact-service.int.spec.ts` (extend)

**Interfaces:**
- Consumes: `subscribeToNewsletter` (Task 2), `kitEnabled`/`createKitSubscriber` (Task 1)
- Produces: `ContactInput.subscribe?: boolean`; `ContactDeps.subscribe?: (input: { email: string; name: string }) => Promise<unknown>`

- [ ] **Step 1: Write the failing tests** (append inside the existing `describe` in `tests/int/contact-service.int.spec.ts`)

```ts
  it('opts the sender into the newsletter when subscribe is checked', async () => {
    const payload = await getTestPayload()
    const subscribe = vi.fn(async () => ({}))
    const d = { ...deps(), subscribe }
    const res = await submitContactMessage({ payload, ...d }, { ...VALID, subscribe: true })
    expect(res).toEqual({ ok: true })
    expect(subscribe).toHaveBeenCalledWith({ email: 'jo@example.com', name: 'Jo Potter' })
  })

  it('does not subscribe when the box is unchecked', async () => {
    const payload = await getTestPayload()
    const subscribe = vi.fn(async () => ({}))
    const res = await submitContactMessage({ payload, ...deps(), subscribe }, VALID)
    expect(res).toEqual({ ok: true })
    expect(subscribe).not.toHaveBeenCalled()
  })

  it('still succeeds when the newsletter opt-in fails', async () => {
    const payload = await getTestPayload()
    const subscribe = vi.fn(async () => { throw new Error('kit down') })
    const res = await submitContactMessage({ payload, ...deps(), subscribe }, { ...VALID, subscribe: true })
    expect(res).toEqual({ ok: true })
  })
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm run test:int tests/int/contact-service.int.spec.ts`
Expected: FAIL — the three new tests (subscribe is never called / TS error on unknown property)

- [ ] **Step 3: Implement the service change**

In `src/services/contact.ts`:

```ts
export interface ContactDeps {
  payload: Payload
  sendEmail: (input: EmailInput) => Promise<void>
  /** Optional newsletter opt-in — best-effort, never fails the message. */
  subscribe?: (input: { email: string; name: string }) => Promise<unknown>
}
```

Add to `ContactInput`:

```ts
  /** Newsletter opt-in checkbox state. */
  subscribe?: boolean
```

Inside the `try` block, after the `await deps.sendEmail({...})` call and before `return { ok: true }`:

```ts
    if (input.subscribe && deps.subscribe) {
      try {
        await deps.subscribe({ email, name })
      } catch (err) {
        console.error('Contact newsletter opt-in failed:', err)
      }
    }
```

- [ ] **Step 4: Wire the route**

In `src/app/api/contact/route.ts`, add imports and the dep:

```ts
import { kitEnabled, createKitSubscriber } from '../../../lib/kit'
```

Change the `submitContactMessage` call to pass the dep and flag:

```ts
  const result = await submitContactMessage(
    {
      payload,
      sendEmail,
      ...(kitEnabled()
        ? { subscribe: ({ email, name }: { email: string; name: string }) => createKitSubscriber({ email, firstName: name }) }
        : {}),
    },
    {
      name: String(body?.name ?? ''),
      email: String(body?.email ?? ''),
      message: String(body?.message ?? ''),
      website: body?.website ? String(body.website) : undefined,
      startedAt: typeof body?.startedAt === 'number' ? body.startedAt : undefined,
      subscribe: body?.subscribe === true,
    },
  )
```

- [ ] **Step 5: Add the checkbox to the form**

In `src/app/(frontend)/contact/ContactForm.tsx`, extend the state initializer:

```tsx
  const [form, setForm] = useState({ name: '', email: '', message: '', website: '', subscribe: false })
```

Add between the `</textarea>` and the honeypot input:

```tsx
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
        <input
          type="checkbox"
          checked={form.subscribe}
          onChange={(e) => setForm({ ...form, subscribe: e.target.checked })}
        />
        Email me studio news &amp; new classes
      </label>
```

(The existing `body: JSON.stringify({ ...form, startedAt })` already picks the flag up.)

- [ ] **Step 6: Run tests to verify pass**

Run: `pnpm run test:int tests/int/contact-service.int.spec.ts && pnpm exec tsc --noEmit`
Expected: PASS (11 tests), tsc clean

- [ ] **Step 7: Commit**

```bash
git add src/services/contact.ts src/app/api/contact/route.ts "src/app/(frontend)/contact/ContactForm.tsx" tests/int/contact-service.int.spec.ts
git commit -m "feat(newsletter): contact-form opt-in checkbox"
```

---

### Task 5: Booking-checkout opt-in

**Files:**
- Modify: `src/app/api/bookings/route.ts` (best-effort subscribe after a successful booking)
- Modify: `src/app/(frontend)/classes/[slug]/BookingForm.tsx` (checkbox + POST field)

**Interfaces:**
- Consumes: `kitEnabled`, `createKitSubscriber` (Task 1)
- Produces: `POST /api/bookings` accepts optional `subscribe: boolean`

The booking service (`createPaidBooking`) is deliberately untouched — the opt-in is a side effect of the HTTP request, not part of the payment domain.

- [ ] **Step 1: Modify the route**

In `src/app/api/bookings/route.ts`, add the import:

```ts
import { kitEnabled, createKitSubscriber } from '../../../lib/kit'
```

Inside the `try`, after `const booking = await createPaidBooking(...)` and before `return Response.json({ ok: true, bookingId: booking.id })`:

```ts
    // Newsletter opt-in is best-effort: the booking is already paid, so a Kit
    // failure is logged and swallowed — it must never turn a success into an error.
    if (body?.subscribe === true && kitEnabled()) {
      try {
        await createKitSubscriber({ email: customerEmail, firstName: customerName })
      } catch (err) {
        payload.logger.error(`Booking newsletter opt-in failed for ${customerEmail}: ${err instanceof Error ? err.message : err}`)
      }
    }
```

- [ ] **Step 2: Add the checkbox to BookingForm**

In `src/app/(frontend)/classes/[slug]/BookingForm.tsx`:

Add state next to the existing `form` state (around line 55):

```tsx
  const [subscribe, setSubscribe] = useState(false)
```

In the identity section (after the phone input, around line 250), add:

```tsx
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
          <input type="checkbox" checked={subscribe} onChange={(e) => setSubscribe(e.target.checked)} />
          Email me studio news &amp; new classes
        </label>
```

In the `fetch('/api/bookings', ...)` call (around line 117), add `subscribe` to the `JSON.stringify({ ... })` payload object.

- [ ] **Step 3: Verify**

Run: `pnpm exec tsc --noEmit && pnpm run lint && pnpm run test:int tests/int/booking-service.int.spec.ts`
Expected: all clean/pass (existing booking tests prove the service path is untouched).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/bookings/route.ts "src/app/(frontend)/classes/[slug]/BookingForm.tsx"
git commit -m "feat(newsletter): booking-checkout opt-in checkbox"
```

---

### Task 6: Lexical → branded email HTML renderer

**Files:**
- Create: `src/lib/newsletter-render.ts`
- Test: `tests/int/newsletter-render.int.spec.ts`

**Interfaces:**
- Consumes: `convertLexicalToHTML` from `@payloadcms/richtext-lexical/html` (already a dependency at 3.85.0)
- Produces (used by Task 8):
  - `interface NewsletterRenderInput { body: SerializedEditorState; baseUrl: string; studioName: string; logoUrl?: string | null }`
  - `renderNewsletterHtml(input: NewsletterRenderInput): string` — full HTML document

- [ ] **Step 1: Write the failing test**

```ts
// tests/int/newsletter-render.int.spec.ts
import { describe, it, expect } from 'vitest'
import { renderNewsletterHtml } from '../../src/lib/newsletter-render'
import type { SerializedEditorState } from '@payloadcms/richtext-lexical/lexical'

function text(t: string) {
  return { type: 'text', text: t, version: 1, detail: 0, format: 0, mode: 'normal', style: '' }
}

const BODY = {
  root: {
    type: 'root',
    format: '',
    indent: 0,
    version: 1,
    direction: 'ltr',
    children: [
      { type: 'heading', tag: 'h2', version: 1, format: '', indent: 0, direction: 'ltr', children: [text('Kiln news')] },
      { type: 'paragraph', version: 1, format: '', indent: 0, direction: 'ltr', textFormat: 0, children: [text('The cone 10 firing is Friday.')] },
    ],
  },
} as unknown as SerializedEditorState

describe('renderNewsletterHtml', () => {
  it('renders the body inside the branded shell', () => {
    const html = renderNewsletterHtml({ body: BODY, baseUrl: 'https://example.com', studioName: 'Portside Pottery' })
    expect(html).toContain('Kiln news')
    expect(html).toContain('The cone 10 firing is Friday.')
    expect(html).toContain('Portside Pottery')
    expect(html).toContain('<!doctype html>')
  })

  it('rewrites relative src/href to absolute site URLs', () => {
    const html = renderNewsletterHtml({ body: BODY, baseUrl: 'https://example.com/', studioName: 'P' })
    // The shell footer links home with an absolute URL and no double slash.
    expect(html).toContain('href="https://example.com"')
    expect(html).not.toContain('https://example.com//')
  })

  it('uses the logo when given (absolutized) and falls back to the studio name', () => {
    const withLogo = renderNewsletterHtml({ body: BODY, baseUrl: 'https://example.com', studioName: 'P', logoUrl: '/api/media/file/logo.png' })
    expect(withLogo).toContain('src="https://example.com/api/media/file/logo.png"')
    const noLogo = renderNewsletterHtml({ body: BODY, baseUrl: 'https://example.com', studioName: 'Portside Pottery' })
    expect(noLogo).toMatch(/Portside Pottery<\/div>/)
  })

  it('escapes the studio name', () => {
    const html = renderNewsletterHtml({ body: BODY, baseUrl: 'https://example.com', studioName: '<script>x</script>' })
    expect(html).not.toContain('<script>x</script>')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test:int tests/int/newsletter-render.int.spec.ts`
Expected: FAIL — `Cannot find module '../../src/lib/newsletter-render'`

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/newsletter-render.ts
import { convertLexicalToHTML } from '@payloadcms/richtext-lexical/html'
import type { SerializedEditorState } from '@payloadcms/richtext-lexical/lexical'

export interface NewsletterRenderInput {
  body: SerializedEditorState
  /** Site origin used to absolutize relative media/link URLs, e.g. https://portsidepottery.com */
  baseUrl: string
  studioName: string
  logoUrl?: string | null
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/**
 * Render a newsletter body (Lexical state, uploads populated via depth) to a
 * complete email HTML document: converted rich text inside one fixed
 * Portside-branded, table-based shell. Email clients don't load external CSS,
 * so everything is inline; Kit appends its own unsubscribe footer on send.
 */
export function renderNewsletterHtml({ body, baseUrl, studioName, logoUrl }: NewsletterRenderInput): string {
  const origin = baseUrl.replace(/\/+$/, '')
  let content = convertLexicalToHTML({ data: body })
  // Media uploads and internal links come out site-relative; email needs absolute.
  content = content.replaceAll('src="/', `src="${origin}/`).replaceAll('href="/', `href="${origin}/`)

  const logo = logoUrl ? (logoUrl.startsWith('/') ? `${origin}${logoUrl}` : logoUrl) : null
  const name = escapeHtml(studioName)

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f5f1ec;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f1ec;">
      <tr><td align="center" style="padding:24px 12px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#ffffff;border-radius:8px;">
          <tr><td align="center" style="padding:28px 32px 12px;">
            ${logo ? `<img src="${logo}" alt="${name}" height="56" style="height:56px;border:0;">` : `<div style="font-size:22px;font-weight:700;color:#3b2f2a;font-family:Georgia,'Times New Roman',serif;">${name}</div>`}
          </td></tr>
          <tr><td style="padding:8px 32px 32px;font-family:Georgia,'Times New Roman',serif;font-size:16px;line-height:1.6;color:#33302c;">
            ${content}
          </td></tr>
          <tr><td align="center" style="padding:16px 32px 28px;border-top:1px solid #eee7de;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#8a8378;">
            ${name} · <a href="${origin}" style="color:#8a8378;">${escapeHtml(origin.replace(/^https?:\/\//, ''))}</a>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run test:int tests/int/newsletter-render.int.spec.ts`
Expected: PASS (4 tests). If `convertLexicalToHTML` rejects the fixture shape, adjust the fixture node props (it accepts default editor nodes: heading/paragraph/text) — do not change the renderer API.

- [ ] **Step 5: Commit**

```bash
git add src/lib/newsletter-render.ts tests/int/newsletter-render.int.spec.ts
git commit -m "feat(newsletter): lexical-to-branded-email HTML renderer"
```

---

### Task 7: `newsletters` collection

**Files:**
- Create: `src/collections/Newsletters.ts`
- Modify: `src/payload.config.ts` (import + add to `collections` array, after `Coupons`)
- Test: `tests/int/newsletters-collection.int.spec.ts`

**Interfaces:**
- Consumes: `isAdminOrEditor` from `src/access/isAdminOrEditor`
- Produces: collection slug `newsletters` with fields `subject` (text), `body` (richText), `status` (`'draft' | 'sent'`), `sentAt` (date), `kitBroadcastId` (text), `recipientCount` (number). Generated type `Newsletter` in `src/payload-types.ts`. Edit-lock: any update where the stored doc is already `sent` throws.

- [ ] **Step 1: Write the failing test**

```ts
// tests/int/newsletters-collection.int.spec.ts
import { describe, it, expect } from 'vitest'
import { getTestPayload } from './helpers'

const BODY = {
  root: {
    type: 'root', format: '', indent: 0, version: 1, direction: 'ltr' as const,
    children: [{
      type: 'paragraph', version: 1, format: '', indent: 0, direction: 'ltr' as const, textFormat: 0,
      children: [{ type: 'text', text: 'Hello potters!', version: 1, detail: 0, format: 0, mode: 'normal', style: '' }],
    }],
  },
}

describe('newsletters collection', () => {
  it('creates a draft and allows editing drafts', async () => {
    const payload = await getTestPayload()
    const doc = await payload.create({
      collection: 'newsletters',
      overrideAccess: true,
      data: { subject: 'July at the studio', body: BODY },
    })
    expect(doc.status).toBe('draft')
    const updated = await payload.update({
      collection: 'newsletters', id: doc.id, overrideAccess: true,
      data: { subject: 'July at Portside' },
    })
    expect(updated.subject).toBe('July at Portside')
  })

  it('locks a newsletter once sent', async () => {
    const payload = await getTestPayload()
    const doc = await payload.create({
      collection: 'newsletters', overrideAccess: true,
      data: { subject: 'Lockme', body: BODY },
    })
    // The draft→sent transition (what the send endpoint does) is allowed…
    await payload.update({
      collection: 'newsletters', id: doc.id, overrideAccess: true,
      data: { status: 'sent', sentAt: new Date().toISOString(), kitBroadcastId: '123', recipientCount: 5 },
    })
    // …but any edit after that is rejected.
    await expect(
      payload.update({ collection: 'newsletters', id: doc.id, overrideAccess: true, data: { subject: 'Changed' } }),
    ).rejects.toThrow(/already been sent/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test:int tests/int/newsletters-collection.int.spec.ts`
Expected: FAIL — unknown collection `newsletters`

- [ ] **Step 3: Write the collection**

```ts
// src/collections/Newsletters.ts
import type { CollectionConfig } from 'payload'
import { APIError } from 'payload'
import { isAdminOrEditor } from '../access/isAdminOrEditor'

/**
 * Studio newsletters composed in the admin and sent to the Kit mailing list
 * as broadcasts. Kit owns the subscriber list; this collection is the compose
 * surface and the send history. Sent newsletters are immutable.
 */
export const Newsletters: CollectionConfig = {
  slug: 'newsletters',
  admin: {
    useAsTitle: 'subject',
    group: 'Studio',
    defaultColumns: ['subject', 'status', 'sentAt', 'recipientCount'],
    description: 'Compose a newsletter, proof it with “Send test to me”, then send it to the mailing list.',
  },
  access: {
    read: isAdminOrEditor,
    create: isAdminOrEditor,
    update: isAdminOrEditor,
    delete: isAdminOrEditor,
  },
  hooks: {
    beforeChange: [
      ({ originalDoc }) => {
        if (originalDoc?.status === 'sent') {
          throw new APIError('This newsletter has already been sent and can no longer be edited.', 400)
        }
      },
    ],
  },
  fields: [
    { name: 'subject', type: 'text', required: true, admin: { description: 'The email subject line.' } },
    {
      name: 'body', type: 'richText', required: true,
      admin: { description: 'Headings, text, links, lists, and images all render inside the studio email template.' },
    },
    {
      name: 'status', type: 'select', defaultValue: 'draft',
      options: [
        { label: 'Draft', value: 'draft' },
        { label: 'Sent', value: 'sent' },
      ],
      admin: { position: 'sidebar', readOnly: true },
    },
    { name: 'sentAt', type: 'date', admin: { position: 'sidebar', readOnly: true, date: { displayFormat: 'MMM d, yyyy h:mm a' } } },
    { name: 'kitBroadcastId', type: 'text', admin: { position: 'sidebar', readOnly: true } },
    { name: 'recipientCount', type: 'number', admin: { position: 'sidebar', readOnly: true } },
  ],
}
```

- [ ] **Step 4: Register and regenerate types**

In `src/payload.config.ts`: add `import { Newsletters } from './collections/Newsletters'` with the other collection imports, and append `Newsletters` to the `collections` array:

```ts
  collections: [Users, People, MembershipPlans, Media, Classes, ClassInstances, Bookings, Payments, FiringRequests, ShelfTags, Shelves, Coupons, Newsletters],
```

Run: `pnpm run generate:types`
Expected: `src/payload-types.ts` gains a `Newsletter` interface.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm run test:int tests/int/newsletters-collection.int.spec.ts`
Expected: PASS (2 tests). NOTE: the test DB uses drizzle push (`NODE_ENV=test`) which adds the new table automatically. If vitest hangs on an interactive push prompt, recreate the test DB first:

```bash
docker run --rm --add-host=host.docker.internal:host-gateway postgres:16-alpine psql "postgres://portside:portside@host.docker.internal:5432/postgres" -c "DROP DATABASE IF EXISTS portside_test;" -c "CREATE DATABASE portside_test;"
```

- [ ] **Step 6: Commit**

```bash
git add src/collections/Newsletters.ts src/payload.config.ts src/payload-types.ts tests/int/newsletters-collection.int.spec.ts
git commit -m "feat(newsletter): newsletters collection with sent-lock"
```

---

### Task 8: Send service + collection endpoints

**Files:**
- Modify: `src/services/newsletter.ts` (add send + test-send)
- Create: `src/endpoints/newsletters.ts`
- Modify: `src/collections/Newsletters.ts` (attach `endpoints`)
- Test: `tests/int/newsletter-send.int.spec.ts`

**Interfaces:**
- Consumes: `renderNewsletterHtml` (Task 6), `Newsletter` type (Task 7), `countKitSubscribers`/`createKitBroadcast`/`kitEnabled` (Task 1), `sendEmail`/`EmailInput` from `src/lib/email`
- Produces:
  - `interface NewsletterSendDeps { payload: Payload; countSubscribers: () => Promise<number | null>; createBroadcast: (input: { subject: string; contentHtml: string; sendAt: Date }) => Promise<{ id: number }> }`
  - `type SendNewsletterResult = { ok: true; recipientCount: number | null } | { ok: false; status: 404 | 409 | 500; error: string }`
  - `sendNewsletter(deps, args: { id: string | number; now?: Date }): Promise<SendNewsletterResult>`
  - `sendNewsletterTest(deps: { payload: Payload; sendEmail: (i: EmailInput) => Promise<void> }, args: { id: string | number; to: string }): Promise<{ ok: true } | { ok: false; status: 404 | 500; error: string }>`
  - HTTP (staff-only, mounted by Payload under the collection): `POST /api/newsletters/:id/send`, `POST /api/newsletters/:id/test`, `GET /api/newsletters/subscriber-count` → `{ total: number | null }`

- [ ] **Step 1: Write the failing test**

```ts
// tests/int/newsletter-send.int.spec.ts
import { describe, it, expect, vi } from 'vitest'
import { getTestPayload } from './helpers'
import { sendNewsletter, sendNewsletterTest } from '../../src/services/newsletter'

const BODY = {
  root: {
    type: 'root', format: '', indent: 0, version: 1, direction: 'ltr' as const,
    children: [{
      type: 'paragraph', version: 1, format: '', indent: 0, direction: 'ltr' as const, textFormat: 0,
      children: [{ type: 'text', text: 'Fresh glazes are in.', version: 1, detail: 0, format: 0, mode: 'normal', style: '' }],
    }],
  },
}

async function makeDraft(subject = 'Glaze day') {
  const payload = await getTestPayload()
  return payload.create({ collection: 'newsletters', overrideAccess: true, data: { subject, body: BODY } })
}

function kitDeps(overrides: Partial<{ count: any; broadcast: any }> = {}) {
  return {
    countSubscribers: overrides.count ?? vi.fn(async () => 42),
    createBroadcast: overrides.broadcast ?? vi.fn(async () => ({ id: 900 })),
  }
}

describe('sendNewsletter', () => {
  it('renders, creates the broadcast, and stamps the doc sent in one update', async () => {
    const payload = await getTestPayload()
    const doc = await makeDraft()
    const deps = { payload, ...kitDeps() }
    const now = new Date('2026-07-16T18:00:00.000Z')

    const res = await sendNewsletter(deps, { id: doc.id, now })
    expect(res).toEqual({ ok: true, recipientCount: 42 })

    const call: any = (deps.createBroadcast as any).mock.calls[0][0]
    expect(call.subject).toBe('Glaze day')
    expect(call.contentHtml).toContain('Fresh glazes are in.')
    expect(call.sendAt).toEqual(now)

    const after = await payload.findByID({ collection: 'newsletters', id: doc.id, overrideAccess: true })
    expect(after.status).toBe('sent')
    expect(after.kitBroadcastId).toBe('900')
    expect(after.recipientCount).toBe(42)
    expect(after.sentAt).toBeTruthy()
  })

  it('refuses to send twice with 409', async () => {
    const payload = await getTestPayload()
    const doc = await makeDraft('Once only')
    const deps = { payload, ...kitDeps() }
    await sendNewsletter(deps, { id: doc.id })
    const again = await sendNewsletter(deps, { id: doc.id })
    expect(again).toMatchObject({ ok: false, status: 409 })
    expect(deps.createBroadcast).toHaveBeenCalledTimes(1)
  })

  it('returns 404 for a missing newsletter', async () => {
    const payload = await getTestPayload()
    const res = await sendNewsletter({ payload, ...kitDeps() }, { id: 999999 })
    expect(res).toMatchObject({ ok: false, status: 404 })
  })

  it('leaves the doc a draft when the broadcast fails', async () => {
    const payload = await getTestPayload()
    const doc = await makeDraft('Fails')
    const deps = { payload, ...kitDeps({ broadcast: vi.fn(async () => { throw new Error('kit 500') }) }) }
    const res = await sendNewsletter(deps, { id: doc.id })
    expect(res).toMatchObject({ ok: false, status: 500 })
    const after = await payload.findByID({ collection: 'newsletters', id: doc.id, overrideAccess: true })
    expect(after.status).toBe('draft')
    expect(after.kitBroadcastId ?? null).toBeNull()
  })

  it('still sends when the subscriber count is unavailable', async () => {
    const payload = await getTestPayload()
    const doc = await makeDraft('No count')
    const deps = { payload, ...kitDeps({ count: vi.fn(async () => { throw new Error('kit list down') }) }) }
    const res = await sendNewsletter(deps, { id: doc.id })
    expect(res).toEqual({ ok: true, recipientCount: null })
  })
})

describe('sendNewsletterTest', () => {
  it('emails the rendered newsletter to the given address with a [Test] subject', async () => {
    const payload = await getTestPayload()
    const doc = await makeDraft('Proof me')
    const sendEmail = vi.fn(async () => {})
    const res = await sendNewsletterTest({ payload, sendEmail }, { id: doc.id, to: 'admin@studio.test' })
    expect(res).toEqual({ ok: true })
    const arg: any = sendEmail.mock.calls[0][0]
    expect(arg.to).toBe('admin@studio.test')
    expect(arg.subject).toBe('[Test] Proof me')
    expect(arg.html).toContain('Fresh glazes are in.')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test:int tests/int/newsletter-send.int.spec.ts`
Expected: FAIL — `sendNewsletter` is not exported

- [ ] **Step 3: Extend the service**

Append to `src/services/newsletter.ts`:

```ts
import type { Payload } from 'payload'
import type { SerializedEditorState } from '@payloadcms/richtext-lexical/lexical'
import type { EmailInput } from '../lib/email'
import type { Newsletter } from '../payload-types'
import { renderNewsletterHtml } from '../lib/newsletter-render'
```

(imports go at the top of the file) and:

```ts
export interface NewsletterSendDeps {
  payload: Payload
  countSubscribers: () => Promise<number | null>
  createBroadcast: (input: { subject: string; contentHtml: string; sendAt: Date }) => Promise<{ id: number }>
}

export type SendNewsletterResult =
  | { ok: true; recipientCount: number | null }
  | { ok: false; status: 404 | 409 | 500; error: string }

/** Load the doc (depth 2 so richText upload nodes are populated) and render
 *  it in the branded shell with site-settings branding. */
async function renderForSend(payload: Payload, id: string | number): Promise<{ doc: Newsletter; html: string } | null> {
  const doc = (await payload
    .findByID({ collection: 'newsletters', id, depth: 2, overrideAccess: true })
    .catch(() => null)) as Newsletter | null
  if (!doc) return null
  const settings = await payload.findGlobal({ slug: 'site-settings', depth: 1 })
  const logoUrl = settings.logo && typeof settings.logo === 'object' ? (settings.logo.url ?? null) : null
  const html = renderNewsletterHtml({
    body: doc.body as unknown as SerializedEditorState,
    baseUrl: process.env.PUBLIC_BASE_URL ?? '',
    studioName: settings.studioName ?? 'Portside Pottery',
    logoUrl,
  })
  return { doc, html }
}

/** Send a draft newsletter to the whole Kit list as a broadcast, then stamp it
 *  sent (status/sentAt/kitBroadcastId/recipientCount in a single update). */
export async function sendNewsletter(
  deps: NewsletterSendDeps,
  args: { id: string | number; now?: Date },
): Promise<SendNewsletterResult> {
  const now = args.now ?? new Date()
  const rendered = await renderForSend(deps.payload, args.id)
  if (!rendered) return { ok: false, status: 404, error: 'Newsletter not found.' }
  const { doc, html } = rendered
  if (doc.status === 'sent' || doc.kitBroadcastId) {
    return { ok: false, status: 409, error: 'This newsletter has already been sent.' }
  }

  // Count is informational (confirm dialog / history) — never blocks a send.
  let recipientCount: number | null = null
  try {
    recipientCount = await deps.countSubscribers()
  } catch {
    recipientCount = null
  }

  let broadcastId: number
  try {
    const b = await deps.createBroadcast({ subject: doc.subject, contentHtml: html, sendAt: now })
    broadcastId = b.id
  } catch (e) {
    deps.payload.logger.error(`Newsletter ${doc.id} broadcast failed: ${e instanceof Error ? e.message : e}`)
    return { ok: false, status: 500, error: 'Kit rejected the broadcast — nothing was sent. Try again in a minute.' }
  }

  try {
    await deps.payload.update({
      collection: 'newsletters',
      id: doc.id,
      overrideAccess: true,
      data: { status: 'sent', sentAt: now.toISOString(), kitBroadcastId: String(broadcastId), recipientCount },
    })
  } catch (e) {
    // The broadcast IS out; losing the stamp must not report failure (a retry
    // would double-send). Log loudly for manual repair instead.
    deps.payload.logger.error(
      `CRITICAL: newsletter ${doc.id} sent as Kit broadcast ${broadcastId} but stamping failed — set status=sent manually. ${e instanceof Error ? e.message : e}`,
    )
  }
  return { ok: true, recipientCount }
}

/** Email the rendered newsletter to one address (the logged-in admin) for proofing. */
export async function sendNewsletterTest(
  deps: { payload: Payload; sendEmail: (input: EmailInput) => Promise<void> },
  args: { id: string | number; to: string },
): Promise<{ ok: true } | { ok: false; status: 404 | 500; error: string }> {
  const rendered = await renderForSend(deps.payload, args.id)
  if (!rendered) return { ok: false, status: 404, error: 'Newsletter not found.' }
  try {
    await deps.sendEmail({ to: args.to, subject: `[Test] ${rendered.doc.subject}`, html: rendered.html })
    return { ok: true }
  } catch (e) {
    deps.payload.logger.error(`Newsletter test-send failed: ${e instanceof Error ? e.message : e}`)
    return { ok: false, status: 500, error: 'The test email failed to send.' }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run test:int tests/int/newsletter-send.int.spec.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Write the endpoints**

```ts
// src/endpoints/newsletters.ts
import type { Endpoint, PayloadRequest } from 'payload'
import { countKitSubscribers, createKitBroadcast, kitEnabled } from '../lib/kit'
import { sendEmail } from '../lib/email'
import { sendNewsletter, sendNewsletterTest } from '../services/newsletter'

/** Staff = admin or editor from the users collection (matches isAdminOrEditor). */
function isStaff(req: PayloadRequest): boolean {
  const user = req.user
  return Boolean(
    user && user.collection === 'users' && user.roles?.some((r: string) => r === 'admin' || r === 'editor'),
  )
}

/**
 * Custom REST endpoints mounted under /api/newsletters by Payload, so req.user
 * arrives authenticated for free. All are staff-only.
 */
export const newsletterEndpoints: Endpoint[] = [
  {
    path: '/subscriber-count',
    method: 'get',
    handler: async (req) => {
      if (!isStaff(req)) return Response.json({ error: 'Forbidden' }, { status: 403 })
      if (!kitEnabled()) return Response.json({ error: 'Kit is not configured (KIT_API_KEY).' }, { status: 503 })
      try {
        return Response.json({ total: await countKitSubscribers() })
      } catch {
        return Response.json({ error: "Couldn't reach Kit." }, { status: 502 })
      }
    },
  },
  {
    path: '/:id/send',
    method: 'post',
    handler: async (req) => {
      if (!isStaff(req)) return Response.json({ error: 'Forbidden' }, { status: 403 })
      if (!kitEnabled()) return Response.json({ error: 'Kit is not configured (KIT_API_KEY).' }, { status: 503 })
      const result = await sendNewsletter(
        { payload: req.payload, countSubscribers: countKitSubscribers, createBroadcast: createKitBroadcast },
        { id: String(req.routeParams?.id ?? '') },
      )
      if (result.ok) return Response.json(result)
      return Response.json({ error: result.error }, { status: result.status })
    },
  },
  {
    path: '/:id/test',
    method: 'post',
    handler: async (req) => {
      if (!isStaff(req) || !req.user?.email) return Response.json({ error: 'Forbidden' }, { status: 403 })
      const result = await sendNewsletterTest(
        { payload: req.payload, sendEmail },
        { id: String(req.routeParams?.id ?? ''), to: req.user.email },
      )
      if (result.ok) return Response.json(result)
      return Response.json({ error: result.error }, { status: result.status })
    },
  },
]
```

Attach in `src/collections/Newsletters.ts`:

```ts
import { newsletterEndpoints } from '../endpoints/newsletters'
```

and inside the config object (top level, next to `hooks`):

```ts
  endpoints: newsletterEndpoints,
```

- [ ] **Step 6: Typecheck + full-file tests**

Run: `pnpm exec tsc --noEmit && pnpm run test:int tests/int/newsletter-send.int.spec.ts tests/int/newsletters-collection.int.spec.ts`
Expected: clean + PASS. If `routeParams` typing complains, use `(req.routeParams as { id?: string } | undefined)?.id`.

- [ ] **Step 7: Commit**

```bash
git add src/services/newsletter.ts src/endpoints/newsletters.ts src/collections/Newsletters.ts tests/int/newsletter-send.int.spec.ts
git commit -m "feat(newsletter): send service and staff-only send/test/count endpoints"
```

---

### Task 9: Send buttons in the admin edit view

**Files:**
- Create: `src/admin/NewsletterSend.tsx`
- Modify: `src/collections/Newsletters.ts` (add the `ui` field)

**Interfaces:**
- Consumes: `POST /api/newsletters/:id/send`, `POST /api/newsletters/:id/test`, `GET /api/newsletters/subscriber-count` (Task 8)
- Produces: sidebar UI field component (Payload import-map path `/admin/NewsletterSend#default`)

- [ ] **Step 1: Write the component**

```tsx
// src/admin/NewsletterSend.tsx
'use client'

import { useState } from 'react'
import { Button, toast, useDocumentInfo, useForm, useFormFields } from '@payloadcms/ui'

/**
 * Sidebar panel on the newsletter edit view: "Send test to me" (Resend to the
 * logged-in admin) and "Send to subscribers" (Kit broadcast, confirm dialog
 * with the live subscriber count). Buttons hit the collection's custom
 * endpoints; the page reloads after a real send so the sent-lock shows.
 */
export default function NewsletterSend() {
  const { id } = useDocumentInfo()
  const { modified } = useForm()
  const status = useFormFields(([fields]) => fields?.status?.value as string | undefined)
  const subject = useFormFields(([fields]) => fields?.subject?.value as string | undefined)
  const sentAt = useFormFields(([fields]) => fields?.sentAt?.value as string | undefined)
  const recipientCount = useFormFields(([fields]) => fields?.recipientCount?.value as number | undefined)
  const [busy, setBusy] = useState(false)

  if (!id) {
    return <p style={{ fontSize: 13, color: 'var(--theme-elevation-500)' }}>Save the draft first to enable sending.</p>
  }

  if (status === 'sent') {
    const when = sentAt ? new Date(sentAt).toLocaleString() : 'earlier'
    return (
      <p style={{ fontSize: 13, color: 'var(--theme-elevation-500)' }}>
        Sent {when}
        {typeof recipientCount === 'number' ? ` to ${recipientCount} subscriber${recipientCount === 1 ? '' : 's'}` : ''}.
      </p>
    )
  }

  const saved = (): boolean => {
    if (modified) {
      toast.error('You have unsaved changes — save first so what you send is what you see.')
      return false
    }
    return true
  }

  const sendTest = async () => {
    if (!saved()) return
    setBusy(true)
    try {
      const res = await fetch(`/api/newsletters/${id}/test`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Test send failed.')
      toast.success('Test email sent to your inbox.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Test send failed.')
    }
    setBusy(false)
  }

  const send = async () => {
    if (!saved()) return
    setBusy(true)
    try {
      const countRes = await fetch('/api/newsletters/subscriber-count')
      const countData = await countRes.json().catch(() => ({}))
      const total: number | null = countRes.ok ? (countData.total ?? null) : null
      const who = total == null ? 'all subscribers' : `${total} subscriber${total === 1 ? '' : 's'}`
      if (!window.confirm(`Send “${subject ?? 'this newsletter'}” to ${who}? This cannot be undone.`)) {
        setBusy(false)
        return
      }
      const res = await fetch(`/api/newsletters/${id}/send`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Send failed.')
      toast.success('Newsletter sent!')
      window.location.reload()
      return
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Send failed.')
    }
    setBusy(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
      <Button buttonStyle="secondary" size="small" onClick={sendTest} disabled={busy}>
        Send test to me
      </Button>
      <Button size="small" onClick={send} disabled={busy}>
        Send to subscribers
      </Button>
    </div>
  )
}
```

- [ ] **Step 2: Add the UI field to the collection**

In `src/collections/Newsletters.ts`, add this as the first entry of the `fields` array — `position: 'sidebar'` places it above the status fields in the sidebar (`ui` fields have no DB column, so no migration impact):

```ts
    {
      name: 'sendPanel', type: 'ui',
      admin: { position: 'sidebar', components: { Field: '/admin/NewsletterSend#default' } },
    },
```

- [ ] **Step 3: Regenerate the import map and verify**

Run: `pnpm run generate:importmap && pnpm exec tsc --noEmit && pnpm run lint`
Expected: import map regenerated without errors (`src/app/(payload)/admin/importMap.js` updated), tsc + lint clean.

- [ ] **Step 4: Manual smoke (local dev)**

`pnpm run dev` → `/admin` → Studio → Newsletters → create a draft with a heading, a paragraph, and an uploaded image → Save. Confirm: sidebar shows both buttons; clicking with unsaved changes shows the save-first toast; "Send test to me" delivers a styled email (needs `RESEND_API_KEY` in `.env`); "Send to subscribers" against the dev Kit key sends a broadcast and the doc reloads locked ("Sent … to N subscribers").

- [ ] **Step 5: Commit**

```bash
git add src/admin/NewsletterSend.tsx src/collections/Newsletters.ts "src/app/(payload)/admin/importMap.js"
git commit -m "feat(newsletter): admin send/test buttons on the newsletter edit view"
```

---

### Task 10: Subscribers admin view, nav link, and manage endpoints

**Files:**
- Create: `src/endpoints/newsletter-subscribers.ts`
- Create: `src/admin/views/Subscribers.tsx`
- Create: `src/admin/views/SubscribersClient.tsx`
- Create: `src/admin/NewsletterNavLink.tsx`
- Modify: `src/payload.config.ts` (root `endpoints`, `admin.components.views`, `beforeNavLinks`)

**Interfaces:**
- Consumes: `kitEnabled`, `listKitSubscribers`, `createKitSubscriber`, `unsubscribeKitSubscriber` (Task 1)
- Produces:
  - HTTP (staff-only): `POST /api/newsletter-subscribers` body `{ email, firstName? }`; `POST /api/newsletter-subscribers/unsubscribe` body `{ id: number }`
  - Admin view at `/admin/newsletter-subscribers` (query params `q`, `after`, `before`)

- [ ] **Step 1: Write the manage endpoints**

```ts
// src/endpoints/newsletter-subscribers.ts
import type { Endpoint, PayloadRequest } from 'payload'
import { createKitSubscriber, kitEnabled, unsubscribeKitSubscriber } from '../lib/kit'

function isStaff(req: PayloadRequest): boolean {
  const user = req.user
  return Boolean(
    user && user.collection === 'users' && user.roles?.some((r: string) => r === 'admin' || r === 'editor'),
  )
}

/** Root-level endpoints (mounted at /api/…) for managing Kit subscribers from
 *  the admin Subscribers view. Staff-only; Kit remains the source of truth. */
export const newsletterSubscriberEndpoints: Endpoint[] = [
  {
    path: '/newsletter-subscribers',
    method: 'post',
    handler: async (req) => {
      if (!isStaff(req)) return Response.json({ error: 'Forbidden' }, { status: 403 })
      if (!kitEnabled()) return Response.json({ error: 'Kit is not configured (KIT_API_KEY).' }, { status: 503 })
      const body = req.json ? await req.json().catch(() => null) : null
      const email = String(body?.email ?? '').trim()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return Response.json({ error: 'Please enter a valid email address.' }, { status: 400 })
      }
      try {
        const sub = await createKitSubscriber({
          email,
          ...(body?.firstName ? { firstName: String(body.firstName).slice(0, 100) } : {}),
        })
        return Response.json({ ok: true, id: sub.id })
      } catch (e) {
        req.payload.logger.error(`Admin subscriber add failed: ${e instanceof Error ? e.message : e}`)
        return Response.json({ error: "Couldn't add the subscriber — Kit API error." }, { status: 502 })
      }
    },
  },
  {
    path: '/newsletter-subscribers/unsubscribe',
    method: 'post',
    handler: async (req) => {
      if (!isStaff(req)) return Response.json({ error: 'Forbidden' }, { status: 403 })
      if (!kitEnabled()) return Response.json({ error: 'Kit is not configured (KIT_API_KEY).' }, { status: 503 })
      const body = req.json ? await req.json().catch(() => null) : null
      const id = Number(body?.id)
      if (!Number.isInteger(id) || id <= 0) return Response.json({ error: 'Invalid subscriber id.' }, { status: 400 })
      try {
        await unsubscribeKitSubscriber(id)
        return Response.json({ ok: true })
      } catch (e) {
        req.payload.logger.error(`Admin unsubscribe failed for ${id}: ${e instanceof Error ? e.message : e}`)
        return Response.json({ error: "Couldn't unsubscribe — Kit API error." }, { status: 502 })
      }
    },
  },
]
```

- [ ] **Step 2: Write the client toolbar/buttons**

```tsx
// src/admin/views/SubscribersClient.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, toast } from '@payloadcms/ui'

export function SubscribersToolbar({ initialSearch }: { initialSearch?: string }) {
  const router = useRouter()
  const [q, setQ] = useState(initialSearch ?? '')
  const [email, setEmail] = useState('')
  const [firstName, setFirstName] = useState('')
  const [busy, setBusy] = useState(false)

  const search = (e: React.FormEvent) => {
    e.preventDefault()
    router.push(q ? `/admin/newsletter-subscribers?q=${encodeURIComponent(q)}` : '/admin/newsletter-subscribers')
  }

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const res = await fetch('/api/newsletter-subscribers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, firstName }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Add failed.')
      toast.success(`${email} added to the list.`)
      setEmail('')
      setFirstName('')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Add failed.')
    }
    setBusy(false)
  }

  const row: React.CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }
  const input: React.CSSProperties = {
    padding: '8px 10px',
    border: '1px solid var(--theme-elevation-150)',
    borderRadius: 4,
    background: 'var(--theme-input-bg)',
    color: 'var(--theme-text)',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
      <form onSubmit={search} style={row}>
        <input style={input} type="search" placeholder="Search by email" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button size="small" buttonStyle="secondary" onClick={search}>Search</Button>
      </form>
      <form onSubmit={add} style={row}>
        <input style={input} type="email" required placeholder="new@subscriber.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input style={input} type="text" placeholder="First name (optional)" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        <Button size="small" onClick={add} disabled={busy}>Add subscriber</Button>
      </form>
    </div>
  )
}

export function UnsubscribeButton({ id, email }: { id: number; email: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  const unsubscribe = async () => {
    if (!window.confirm(`Unsubscribe ${email}? They'll stop receiving newsletters.`)) return
    setBusy(true)
    try {
      const res = await fetch('/api/newsletter-subscribers/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Unsubscribe failed.')
      toast.success(`${email} unsubscribed.`)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unsubscribe failed.')
    }
    setBusy(false)
  }

  return (
    <Button size="small" buttonStyle="secondary" onClick={unsubscribe} disabled={busy}>
      Unsubscribe
    </Button>
  )
}
```

- [ ] **Step 3: Write the server view**

```tsx
// src/admin/views/Subscribers.tsx
import type { AdminViewServerProps } from 'payload'
import { DefaultTemplate } from '@payloadcms/next/templates'
import { Gutter, Link } from '@payloadcms/ui'
import { redirect } from 'next/navigation'

import { kitEnabled, listKitSubscribers, type KitSubscriberPage } from '../../lib/kit'
import { SubscribersToolbar, UnsubscribeButton } from './SubscribersClient'

const cell: React.CSSProperties = {
  padding: '10px 12px',
  borderBottom: '1px solid var(--theme-elevation-100)',
  textAlign: 'left',
  fontSize: 14,
}

function param(searchParams: AdminViewServerProps['searchParams'], key: string): string | undefined {
  const v = searchParams?.[key]
  return typeof v === 'string' && v ? v : undefined
}

export default async function Subscribers({ initPageResult, params, searchParams }: AdminViewServerProps) {
  const { req, permissions, visibleEntities, locale } = initPageResult
  const { user, payload } = req
  const staff =
    user && user.collection === 'users' && user.roles?.some((r) => r === 'admin' || r === 'editor')
  if (!staff) redirect('/admin')

  const q = param(searchParams, 'q')
  const after = param(searchParams, 'after')
  const before = param(searchParams, 'before')

  let content: React.ReactNode
  if (!kitEnabled()) {
    content = (
      <p style={{ color: 'var(--theme-elevation-500)' }}>
        The mailing list isn&apos;t configured yet — set <code>KIT_API_KEY</code> in the server environment.
      </p>
    )
  } else {
    let page: KitSubscriberPage | null = null
    try {
      page = await listKitSubscribers({ after, before, emailSearch: q })
    } catch {
      content = <p style={{ color: 'var(--theme-error-500)' }}>Couldn&apos;t reach Kit — try again in a minute.</p>
    }
    if (page) {
      const qs = q ? `&q=${encodeURIComponent(q)}` : ''
      content = (
        <>
          {typeof page.totalCount === 'number' && (
            <p style={{ color: 'var(--theme-elevation-500)', marginBottom: 8 }}>
              {page.totalCount} subscriber{page.totalCount === 1 ? '' : 's'}
            </p>
          )}
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={cell}>Email</th>
                <th style={cell}>Name</th>
                <th style={cell}>Status</th>
                <th style={cell}>Joined</th>
                <th style={cell} />
              </tr>
            </thead>
            <tbody>
              {page.subscribers.map((s) => (
                <tr key={s.id}>
                  <td style={cell}>{s.email_address}</td>
                  <td style={cell}>{s.first_name ?? '—'}</td>
                  <td style={cell}>{s.state}</td>
                  <td style={cell}>{s.created_at ? new Date(s.created_at).toLocaleDateString() : '—'}</td>
                  <td style={cell}>
                    {s.state === 'active' ? <UnsubscribeButton id={s.id} email={s.email_address} /> : null}
                  </td>
                </tr>
              ))}
              {page.subscribers.length === 0 && (
                <tr>
                  <td style={cell} colSpan={5}>
                    {q ? `No subscribers match “${q}”.` : 'No subscribers yet.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <div style={{ display: 'flex', gap: 16, marginTop: 14 }}>
            {page.hasPrevPage && page.startCursor && (
              <Link href={`/admin/newsletter-subscribers?before=${encodeURIComponent(page.startCursor)}${qs}`} prefetch={false}>
                ← Previous
              </Link>
            )}
            {page.hasNextPage && page.endCursor && (
              <Link href={`/admin/newsletter-subscribers?after=${encodeURIComponent(page.endCursor)}${qs}`} prefetch={false}>
                Next →
              </Link>
            )}
          </div>
        </>
      )
    }
  }

  return (
    <DefaultTemplate
      i18n={req.i18n}
      locale={locale}
      params={params}
      payload={payload}
      permissions={permissions}
      searchParams={searchParams}
      user={user}
      visibleEntities={visibleEntities}
    >
      <Gutter>
        <h1 style={{ marginBottom: 'var(--base)' }}>Newsletter subscribers</h1>
        {kitEnabled() && <SubscribersToolbar initialSearch={q} />}
        {content}
      </Gutter>
    </DefaultTemplate>
  )
}
```

- [ ] **Step 4: Write the nav link**

```tsx
// src/admin/NewsletterNavLink.tsx
'use client'

import { Link, useAuth } from '@payloadcms/ui'
import type { User } from '../payload-types'

/** "Newsletter" link to the live Kit subscriber list — staff only. */
export default function NewsletterNavLink() {
  const { user } = useAuth<User>()
  if (!user?.roles?.some((r) => r === 'admin' || r === 'editor')) return null
  return (
    <Link className="nav__link" href="/admin/newsletter-subscribers" id="nav-newsletter-subscribers" prefetch={false}>
      <span className="nav__link-label">Newsletter subscribers</span>
    </Link>
  )
}
```

- [ ] **Step 5: Register everything in `src/payload.config.ts`**

Add imports:

```ts
import { newsletterSubscriberEndpoints } from './endpoints/newsletter-subscribers'
```

Extend `admin.components`:

```ts
      beforeNavLinks: ['/admin/MembersNavLink#default', '/admin/MyClassesNavLink#default', '/admin/NewsletterNavLink#default'],
      views: {
        myClasses: { Component: '/admin/views/MyClasses#default', path: '/my-classes', exact: true },
        myClassRoster: { Component: '/admin/views/MyClassRoster#default', path: '/my-classes/:id' },
        newsletterSubscribers: { Component: '/admin/views/Subscribers#default', path: '/newsletter-subscribers', exact: true },
      },
```

Add root endpoints (top level of `buildConfig`, next to `collections`):

```ts
  endpoints: [...newsletterSubscriberEndpoints],
```

- [ ] **Step 6: Regenerate import map, typecheck, lint**

Run: `pnpm run generate:importmap && pnpm exec tsc --noEmit && pnpm run lint`
Expected: all clean.

- [ ] **Step 7: Manual smoke (local dev)**

`pnpm run dev` with the dev `KIT_API_KEY` in `.env` → `/admin` → "Newsletter subscribers" nav link visible for admin, view lists the dev-account subscribers, search filters, add creates (visible in Kit dashboard), unsubscribe flips state after refresh. Log in as an instructor-only user (if one exists locally): link hidden, direct URL redirects to `/admin`.

- [ ] **Step 8: Commit**

```bash
git add src/endpoints/newsletter-subscribers.ts src/admin/views/Subscribers.tsx src/admin/views/SubscribersClient.tsx src/admin/NewsletterNavLink.tsx src/payload.config.ts "src/app/(payload)/admin/importMap.js"
git commit -m "feat(newsletter): live Kit subscribers admin view with add/unsubscribe"
```

---

### Task 11: Migration, full test run, dev-droplet deploy

**Files:**
- Create: `src/migrations/<timestamp>_newsletters.ts` + `.json` (generated)
- Modify: `src/migrations/index.ts` (generated)

**Interfaces:**
- Consumes: everything above
- Produces: deployable image on brianwells.org with `KIT_API_KEY` set

- [ ] **Step 1: Generate the migration** (prod runs `NODE_ENV=production` with push off — the new table needs a migration)

Use the throwaway-Postgres flow (Payload needs a DB at the current migrated state):

```bash
docker run -d --name portside-migdev -e POSTGRES_USER=portside -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=portside_dev -p 5433:5432 postgres:16-alpine
sleep 3
DATABASE_URL=postgres://portside:dev@localhost:5433/portside_dev PAYLOAD_SECRET=dev NODE_ENV=development pnpm payload migrate
DATABASE_URL=postgres://portside:dev@localhost:5433/portside_dev PAYLOAD_SECRET=dev NODE_ENV=development pnpm run migrate:create newsletters
docker rm -f portside-migdev
```

Expected: a new `src/migrations/<ts>_newsletters.ts` creating the `newsletters` table (+ enum for status). If prompted create-vs-rename, choose **create** (it's a pure add). Hand-check the generated `down()`: table drops should be `DROP TABLE IF EXISTS ... CASCADE`.

- [ ] **Step 2: Full verification suite**

```bash
pnpm run test:int && pnpm exec tsc --noEmit && pnpm run lint && pnpm run build
```

Expected: everything green. (If int tests hang on a push prompt, recreate `portside_test` — command in Task 7 Step 5.)

- [ ] **Step 3: Commit the migration**

```bash
git add src/migrations
git commit -m "chore(db): migration for newsletters collection"
```

- [ ] **Step 4: Add the dev Kit key to the dev droplet** (key is provided by Brian in the session — NOT in this doc or the repo)

```bash
ssh root@206.189.255.28 'grep -q KIT_API_KEY /opt/portside/.env.production || echo "KIT_API_KEY=<DEV_KIT_API_KEY>" >> /opt/portside/.env.production'
```

- [ ] **Step 5: Build and ship to the dev droplet** (brianwells.org deploy loop — sandbox Square build args, from the repo `.env`)

```bash
docker build --platform linux/amd64 --build-arg NEXT_PUBLIC_SQUARE_ENVIRONMENT=sandbox --build-arg NEXT_PUBLIC_SQUARE_APP_ID=sandbox-sq0idb-BxeQOCwSZKHugBsZoIUXZA --build-arg NEXT_PUBLIC_SQUARE_LOCATION_ID=LMDEFJRFBWN3E -t portside:test .
docker save portside:test | gzip -1 | ssh root@206.189.255.28 'gunzip | docker load'
ssh root@206.189.255.28 'cd /opt/portside && docker compose run --rm app pnpm payload migrate'
ssh root@206.189.255.28 'cd /opt/portside && docker compose up -d --force-recreate app'
```

Expected: migrate applies `newsletters`; app boots clean (`docker compose logs app | tail -50` — no errors).

- [ ] **Step 6: E2E checklist on https://brianwells.org** (dev Kit account — safe to send real broadcasts)

- [ ] Footer signup with a real email → "You're on the list!" → appears in Kit dashboard
- [ ] Footer signup with garbage email → friendly 400 error
- [ ] Contact form with opt-in checked → message received AND subscriber added
- [ ] Booking flow (sandbox card `4111 1111 1111 1111`) with opt-in checked → booking succeeds AND subscriber added
- [ ] Admin → Newsletter subscribers: list matches Kit; search; add; unsubscribe
- [ ] Admin → Newsletters: draft with heading/text/image → "Send test to me" lands styled in inbox (images load)
- [ ] "Send to subscribers" → confirm shows count → broadcast arrives at dev-list emails → doc locks (`sent`, count, timestamp; edits rejected)
- [ ] Second send attempt on the same doc → refused

- [ ] **Step 7: Commit any fixes found during E2E, then push**

```bash
git push
```

Production rollout (separate, later, on Brian's go): create the prod Kit account under getcreative@portsidepottery.com (verify the sending address!), add its `KIT_API_KEY` to `/opt/portside/.env.production` on **138.197.232.44**, deploy with the production build args per the prod deploy runbook, run migrate, smoke-test signup + subscriber view.

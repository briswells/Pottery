# Self-Serve Membership Cancellation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a member cancel their membership without a login: enter their email → get a one-time, single-use, expiring link → confirm on a page → their Square subscription is cancelled.

**Architecture:** A public page posts an email to a request route, which (only for a member with a cancelable Square subscription) stores a hashed, 30-min, single-use token on the member and emails a link. The link opens a confirm page (read-only validation, no cancel on GET) with a button that POSTs the token; the confirm route sets the member's `status: 'cancelled'` — reusing the existing `cancelSquareSubscription` hook — and consumes the token. Responses never reveal whether an email matches (no enumeration).

**Tech Stack:** Next.js (App Router routes + pages), Payload CMS, Node `crypto` (token + SHA-256 hash), existing `sendEmail` (Resend), vitest.

**Spec:** `docs/superpowers/specs/2026-06-11-self-serve-membership-cancel-design.md`

**Test hermeticity:** the service is pure logic over an injected `payload` + `sendEmail` (no Square, no real email) — unit-tested with fakes. Setting `status: 'cancelled'` in the confirm flow is only exercised against a **fake payload** in tests, so the real `cancelSquareSubscription` hook (which calls Square) never runs in CI.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/collections/Members.ts` | Add hidden `cancelTokenHash` + `cancelTokenExpiresAt` fields |
| `src/services/membership-cancel.ts` | **New** — `hashToken`, `requestMembershipCancel`, `validateCancelToken` (read-only), `confirmMembershipCancel` (mutating) |
| `src/app/api/membership/cancel/request/route.ts` | **New** — POST email → request; always generic response |
| `src/app/api/membership/cancel/confirm/route.ts` | **New** — POST token → confirm cancel |
| `src/app/(frontend)/membership/cancel/page.tsx` | **New** — email-entry form (client) |
| `src/app/(frontend)/membership/cancel/confirm/page.tsx` | **New** — server page: validate token, show membership + confirm button |
| `src/app/(frontend)/membership/cancel/ConfirmCancelButton.tsx` | **New** — client button that POSTs the token + shows result |
| `src/app/(frontend)/membership/page.tsx` | Add a "Cancel my membership" link |
| `src/migrations/*` | **New** generated migration for the two columns |
| `tests/int/membership-cancel.int.spec.ts` | **New** — service unit tests |
| `tests/int/membership-cancel-routes.int.spec.ts` | **New** — route tests (mocked service) |

---

## Task 1: Member token fields + migration

**Files:** Modify `src/collections/Members.ts`; Test `tests/int/membership-cancel-fields.int.spec.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `tests/int/membership-cancel-fields.int.spec.ts`:

```ts
import { describe, it, expect, afterAll } from 'vitest'
import { getTestPayload } from './helpers'

describe('member cancel-token fields', () => {
  it('stores and reads cancelTokenHash + cancelTokenExpiresAt', async () => {
    const payload = await getTestPayload()
    const m = await payload.create({
      collection: 'members',
      overrideAccess: true,
      data: { name: 'TokenFields', email: `tok-${Date.now()}@test.local`, status: 'paused' },
    })
    const exp = new Date(Date.now() + 60_000).toISOString()
    const updated = await payload.update({
      collection: 'members', id: m.id, overrideAccess: true,
      data: { cancelTokenHash: 'abc123', cancelTokenExpiresAt: exp },
    })
    expect(updated.cancelTokenHash).toBe('abc123')
    expect(updated.cancelTokenExpiresAt).toBeTruthy()
  })
})

afterAll(async () => {
  const payload = await getTestPayload()
  await payload.delete({ collection: 'members', where: { email: { contains: '@test.local' } }, overrideAccess: true })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run --config ./vitest.config.mts tests/int/membership-cancel-fields.int.spec.ts`
Expected: FAIL — fields don't exist (Payload rejects unknown fields).

- [ ] **Step 3: Add the fields**

In `src/collections/Members.ts`, add to the end of the `fields` array (after the existing readonly Square fields):

```ts
    // Internal: single-use, expiring token for passwordless self-serve cancellation.
    { name: 'cancelTokenHash', type: 'text', admin: { hidden: true } },
    { name: 'cancelTokenExpiresAt', type: 'date', admin: { hidden: true } },
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run --config ./vitest.config.mts tests/int/membership-cancel-fields.int.spec.ts`
Expected: PASS (dev push syncs the test DB).

- [ ] **Step 5: Generate the migration**

Run: `pnpm payload migrate:create membership_cancel_token`
Expected: a new `src/migrations/<timestamp>_membership_cancel_token.ts/.json` adding `members.cancel_token_hash` (text) + `members.cancel_token_expires_at` (timestamp). Open the `.ts` and confirm both columns are added. Report what it generated.

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm exec tsc --noEmit` (expect clean)
```bash
git add src/collections/Members.ts src/migrations tests/int/membership-cancel-fields.int.spec.ts
git commit -m "Add hidden member cancel-token fields + migration"
```

---

## Task 2: membership-cancel service

**Files:** Create `src/services/membership-cancel.ts`; Test `tests/int/membership-cancel.int.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/int/membership-cancel.int.spec.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import {
  hashToken,
  requestMembershipCancel,
  validateCancelToken,
  confirmMembershipCancel,
} from '../../src/services/membership-cancel'

const future = () => new Date(Date.now() + 30 * 60_000).toISOString()
const past = () => new Date(Date.now() - 60_000).toISOString()

function fakePayload(members: any[]) {
  const update = vi.fn(async ({ id, data }: any) => {
    const m = members.find((x) => x.id === id)
    if (m) Object.assign(m, data)
    return { id, ...data }
  })
  const find = vi.fn(async ({ where }: any) => {
    if (where?.email?.equals) return { docs: members.filter((m) => m.email === where.email.equals) }
    if (where?.cancelTokenHash?.equals) return { docs: members.filter((m) => m.cancelTokenHash === where.cancelTokenHash.equals) }
    return { docs: [] }
  })
  return { update, find } as any
}

describe('requestMembershipCancel', () => {
  it('emails a single-use link and stores a hash for a cancelable member', async () => {
    const member = { id: 1, email: 'm@test.local', status: 'active', squareSubscriptionId: 'sub_1' }
    const payload = fakePayload([member])
    const sendEmail = vi.fn(async () => {})
    await requestMembershipCancel({ payload, sendEmail, baseUrl: 'https://x.test' }, 'm@test.local')

    expect(sendEmail).toHaveBeenCalledTimes(1)
    const html: string = sendEmail.mock.calls[0][0].html
    const m = html.match(/cancel\/confirm\?token=([A-Za-z0-9_-]+)/)
    expect(m).toBeTruthy()
    const rawToken = m![1]
    // stored value is the HASH of the raw token, plus a future expiry
    expect(member.cancelTokenHash).toBe(hashToken(rawToken))
    expect(new Date(member.cancelTokenExpiresAt).getTime()).toBeGreaterThan(Date.now())
  })

  it('does nothing (no email, no throw) for an unknown email', async () => {
    const payload = fakePayload([])
    const sendEmail = vi.fn(async () => {})
    await expect(requestMembershipCancel({ payload, sendEmail, baseUrl: 'https://x.test' }, 'nobody@test.local')).resolves.toBeUndefined()
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('does nothing for a member with no Square subscription (Free)', async () => {
    const payload = fakePayload([{ id: 2, email: 'free@test.local', status: 'active', squareSubscriptionId: null }])
    const sendEmail = vi.fn(async () => {})
    await requestMembershipCancel({ payload, sendEmail, baseUrl: 'https://x.test' }, 'free@test.local')
    expect(sendEmail).not.toHaveBeenCalled()
  })
})

describe('validateCancelToken (read-only)', () => {
  it('returns ok + member for a valid token and does NOT mutate', async () => {
    const member = { id: 1, name: 'Mae', email: 'm@test.local', status: 'active', squareSubscriptionId: 'sub_1', cancelTokenHash: hashToken('raw'), cancelTokenExpiresAt: future() }
    const payload = fakePayload([member])
    const res = await validateCancelToken({ payload }, 'raw')
    expect(res.ok).toBe(true)
    expect(res.member?.name).toBe('Mae')
    expect(payload.update).not.toHaveBeenCalled()
    expect(member.status).toBe('active')
  })

  it('returns expired for an expired token', async () => {
    const payload = fakePayload([{ id: 1, cancelTokenHash: hashToken('raw'), cancelTokenExpiresAt: past() }])
    expect(await validateCancelToken({ payload }, 'raw')).toEqual({ ok: false, reason: 'expired' })
  })

  it('returns invalid for an unknown token', async () => {
    const payload = fakePayload([])
    expect(await validateCancelToken({ payload }, 'nope')).toEqual({ ok: false, reason: 'invalid' })
  })
})

describe('confirmMembershipCancel (mutating)', () => {
  it('cancels and clears the token for a valid token', async () => {
    const member = { id: 1, status: 'active', squareSubscriptionId: 'sub_1', cancelTokenHash: hashToken('raw'), cancelTokenExpiresAt: future() }
    const payload = fakePayload([member])
    const res = await confirmMembershipCancel({ payload }, 'raw')
    expect(res).toEqual({ ok: true })
    expect(payload.update).toHaveBeenCalledWith(
      expect.objectContaining({ collection: 'members', id: 1, data: expect.objectContaining({ status: 'cancelled', cancelTokenHash: null, cancelTokenExpiresAt: null }) }),
    )
  })

  it('does not cancel an expired token', async () => {
    const member = { id: 1, status: 'active', cancelTokenHash: hashToken('raw'), cancelTokenExpiresAt: past() }
    const payload = fakePayload([member])
    expect(await confirmMembershipCancel({ payload }, 'raw')).toEqual({ ok: false, reason: 'expired' })
    expect(payload.update).not.toHaveBeenCalled()
  })

  it('does not cancel an unknown token', async () => {
    const payload = fakePayload([])
    expect(await confirmMembershipCancel({ payload }, 'nope')).toEqual({ ok: false, reason: 'invalid' })
    expect(payload.update).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run --config ./vitest.config.mts tests/int/membership-cancel.int.spec.ts`
Expected: FAIL — module/functions don't exist.

- [ ] **Step 3: Implement the service**

Create `src/services/membership-cancel.ts`:

```ts
import { createHash, randomBytes } from 'crypto'
import type { Payload } from 'payload'
import type { EmailInput } from '../lib/email'

const TOKEN_TTL_MS = 30 * 60_000

export const hashToken = (raw: string): string => createHash('sha256').update(raw).digest('hex')

export interface CancelRequestDeps {
  payload: Payload
  sendEmail: (input: EmailInput) => Promise<void>
  baseUrl: string
}
export interface CancelConfirmDeps {
  payload: Payload
}

type CancelResult = { ok: boolean; reason?: 'invalid' | 'expired' }

/**
 * Issue a single-use cancellation link to a member with a cancelable Square
 * subscription. Always resolves quietly (no throw, no signal) so the caller can
 * return an identical response regardless of whether the email matched.
 */
export async function requestMembershipCancel(deps: CancelRequestDeps, email: string): Promise<void> {
  const { payload, sendEmail, baseUrl } = deps
  if (!email) return
  const { docs } = await payload.find({
    collection: 'members',
    where: { email: { equals: email } },
    limit: 1,
    overrideAccess: true,
  })
  const member: any = docs[0]
  // Only members with an active Square subscription have something to cancel.
  if (!member || !member.squareSubscriptionId || member.status === 'cancelled') return

  const raw = randomBytes(32).toString('base64url')
  await payload.update({
    collection: 'members',
    id: member.id,
    overrideAccess: true,
    data: { cancelTokenHash: hashToken(raw), cancelTokenExpiresAt: new Date(Date.now() + TOKEN_TTL_MS).toISOString() },
  })

  const link = `${baseUrl.replace(/\/$/, '')}/membership/cancel/confirm?token=${raw}`
  try {
    await sendEmail({
      to: member.email,
      subject: 'Cancel your Portside Pottery membership',
      html: `<p>Click the link below to cancel your membership. It expires in 30 minutes and can be used once.</p>
<p><a href="${link}">${link}</a></p>
<p>If you didn't request this, you can ignore this email — nothing will change.</p>`,
    })
  } catch (e) {
    console.error(`Cancel link email failed for member ${member.id}:`, e)
  }
}

async function findByToken(payload: Payload, token: string): Promise<any | null> {
  if (!token) return null
  const { docs } = await payload.find({
    collection: 'members',
    where: { cancelTokenHash: { equals: hashToken(token) } },
    limit: 1,
    overrideAccess: true,
  })
  return docs[0] ?? null
}

function tokenState(member: any | null): CancelResult {
  if (!member) return { ok: false, reason: 'invalid' }
  const exp = member.cancelTokenExpiresAt ? new Date(member.cancelTokenExpiresAt).getTime() : 0
  if (!exp || exp < Date.now()) return { ok: false, reason: 'expired' }
  return { ok: true }
}

/** Read-only: validate a token for rendering the confirm page. Never mutates. */
export async function validateCancelToken(
  deps: CancelConfirmDeps,
  token: string,
): Promise<CancelResult & { member?: { id: string | number; name: string } }> {
  const member = await findByToken(deps.payload, token)
  const state = tokenState(member)
  if (!state.ok) return state
  return { ok: true, member: { id: member.id, name: member.name } }
}

/** Mutating: cancel the membership and consume the token. */
export async function confirmMembershipCancel(deps: CancelConfirmDeps, token: string): Promise<CancelResult> {
  const member = await findByToken(deps.payload, token)
  const state = tokenState(member)
  if (!state.ok) return state
  // status -> cancelled fires the existing cancelSquareSubscription hook (Square
  // cancel at period end). Clearing the token makes it single-use.
  await deps.payload.update({
    collection: 'members',
    id: member.id,
    overrideAccess: true,
    data: { status: 'cancelled', cancelTokenHash: null, cancelTokenExpiresAt: null },
  })
  return { ok: true }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run --config ./vitest.config.mts tests/int/membership-cancel.int.spec.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm exec tsc --noEmit` (expect clean)
```bash
git add src/services/membership-cancel.ts tests/int/membership-cancel.int.spec.ts
git commit -m "Add membership-cancel service (request/validate/confirm, hashed single-use token)"
```

---

## Task 3: API routes

**Files:** Create both route files; Test `tests/int/membership-cancel-routes.int.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/int/membership-cancel-routes.int.spec.ts` (mock the service so no payload/Square/email is touched):

```ts
import { describe, it, expect, vi } from 'vitest'

const requestMock = vi.hoisted(() => vi.fn(async () => undefined))
const confirmMock = vi.hoisted(() => vi.fn(async () => ({ ok: true })))
vi.mock('../../src/services/membership-cancel', () => ({
  requestMembershipCancel: requestMock,
  confirmMembershipCancel: confirmMock,
}))
// Avoid booting Payload in the route under test.
vi.mock('payload', () => ({ getPayload: vi.fn(async () => ({})) }))
vi.mock('@payload-config', () => ({ default: {} }))

import { POST as requestPOST } from '../../src/app/api/membership/cancel/request/route'
import { POST as confirmPOST } from '../../src/app/api/membership/cancel/confirm/route'

const jsonReq = (body: any) =>
  new Request('https://x.test/api/membership/cancel/x', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })

describe('cancel request route', () => {
  it('returns a generic ok regardless of input (no enumeration)', async () => {
    const res = await requestPOST(jsonReq({ email: 'a@test.local' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(data.message).toMatch(/if a membership/i)
    expect(requestMock).toHaveBeenCalled()
  })

  it('still returns generic ok when no email is given', async () => {
    requestMock.mockClear()
    const res = await requestPOST(jsonReq({}))
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
  })
})

describe('cancel confirm route', () => {
  it('returns the service result', async () => {
    confirmMock.mockResolvedValueOnce({ ok: false, reason: 'expired' })
    const res = await confirmPOST(jsonReq({ token: 'x' }))
    expect(await res.json()).toEqual({ ok: false, reason: 'expired' })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run --config ./vitest.config.mts tests/int/membership-cancel-routes.int.spec.ts`
Expected: FAIL — route modules don't exist.

- [ ] **Step 3: Create the request route**

Create `src/app/api/membership/cancel/request/route.ts`:

```ts
import { getPayload } from 'payload'
import config from '@payload-config'
import { sendEmail } from '../../../../../lib/email'
import { requestMembershipCancel } from '../../../../../services/membership-cancel'

const GENERIC = { ok: true, message: 'If a membership matches that email, we’ve sent a cancellation link.' }

export async function POST(req: Request) {
  let email = ''
  try {
    email = String((await req.json())?.email ?? '').trim()
  } catch {
    // ignore — still return the generic response below
  }
  const payload = await getPayload({ config: await config })
  const baseUrl = process.env.PUBLIC_BASE_URL ?? new URL(req.url).origin
  // Never reveal whether the email matched. Run the request, always reply generic.
  try {
    if (email) await requestMembershipCancel({ payload, sendEmail, baseUrl }, email)
  } catch (e) {
    console.error('cancel request failed:', e)
  }
  return Response.json(GENERIC)
}
```

(Verify the relative depth `../../../../../lib/email` resolves to `src/lib/email` — this file is 5 levels under `src/app`. Adjust if your editor flags it; `@payload-config` is the configured alias used by every route.)

- [ ] **Step 4: Create the confirm route**

Create `src/app/api/membership/cancel/confirm/route.ts`:

```ts
import { getPayload } from 'payload'
import config from '@payload-config'
import { confirmMembershipCancel } from '../../../../../services/membership-cancel'

export async function POST(req: Request) {
  let token = ''
  try {
    token = String((await req.json())?.token ?? '')
  } catch {
    return Response.json({ ok: false, reason: 'invalid' }, { status: 400 })
  }
  const payload = await getPayload({ config: await config })
  const result = await confirmMembershipCancel({ payload }, token)
  return Response.json(result)
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm exec vitest run --config ./vitest.config.mts tests/int/membership-cancel-routes.int.spec.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm exec tsc --noEmit` (expect clean)
```bash
git add "src/app/api/membership/cancel/request/route.ts" "src/app/api/membership/cancel/confirm/route.ts" tests/int/membership-cancel-routes.int.spec.ts
git commit -m "Add membership cancel request/confirm API routes (generic response, no enumeration)"
```

---

## Task 4: Pages + membership link

**Files:** Create the two pages + the confirm button component; modify `src/app/(frontend)/membership/page.tsx`. (No automated test — UI over the tested routes/service; verified manually in Task 5.)

- [ ] **Step 1: Create the email-entry page**

Create `src/app/(frontend)/membership/cancel/page.tsx`:

```tsx
'use client'
import { useState } from 'react'

export default function CancelRequestPage() {
  const [email, setEmail] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/membership/cancel/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json()
      setMsg(data.message ?? 'If a membership matches that email, we’ve sent a cancellation link.')
    } catch {
      setMsg('Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ padding: '40px 0', maxWidth: 480 }}>
      <h1>Cancel your membership</h1>
      <p style={{ color: 'var(--pp-muted)' }}>
        Enter the email on your membership and we’ll send you a one-time link to confirm cancellation.
      </p>
      <form onSubmit={submit} style={{ display: 'grid', gap: 10, marginTop: 16 }}>
        <input
          required
          type="email"
          className="pp-input"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button className="pp-btn" type="submit" disabled={busy}>
          {busy ? 'Sending…' : 'Send cancellation link'}
        </button>
      </form>
      {msg && <p style={{ marginTop: 16 }}>{msg}</p>}
    </div>
  )
}
```

- [ ] **Step 2: Create the confirm button (client component)**

Create `src/app/(frontend)/membership/cancel/ConfirmCancelButton.tsx`:

```tsx
'use client'
import { useState } from 'react'

export function ConfirmCancelButton({ token }: { token: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')

  async function cancel() {
    setState('busy')
    try {
      const res = await fetch('/api/membership/cancel/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const data = await res.json()
      setState(data.ok ? 'done' : 'error')
    } catch {
      setState('error')
    }
  }

  if (state === 'done')
    return <p style={{ marginTop: 16 }}>Your membership has been cancelled, effective at the end of your current billing period.</p>
  if (state === 'error')
    return <p style={{ marginTop: 16 }}>That link is no longer valid. Please request a new one.</p>

  return (
    <button className="pp-btn" onClick={cancel} disabled={state === 'busy'} style={{ marginTop: 16 }}>
      {state === 'busy' ? 'Cancelling…' : 'Yes, cancel my membership'}
    </button>
  )
}
```

- [ ] **Step 3: Create the confirm page (server)**

Create `src/app/(frontend)/membership/cancel/confirm/page.tsx`:

```tsx
import { getPayload } from 'payload'
import config from '@payload-config'
import Link from 'next/link'
import { validateCancelToken } from '../../../../../services/membership-cancel'
import { ConfirmCancelButton } from '../ConfirmCancelButton'

export const dynamic = 'force-dynamic'

export default async function CancelConfirmPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams
  const payload = await getPayload({ config: await config })
  const result = await validateCancelToken({ payload }, token ?? '')

  return (
    <div style={{ padding: '40px 0', maxWidth: 480 }}>
      <h1>Cancel your membership</h1>
      {result.ok ? (
        <>
          <p>
            Hi {result.member?.name}, click below to cancel your Portside Pottery membership. This takes effect at the
            end of your current billing period.
          </p>
          <ConfirmCancelButton token={token ?? ''} />
        </>
      ) : (
        <p style={{ marginTop: 8 }}>
          This cancellation link is invalid or has expired. You can{' '}
          <Link href="/membership/cancel">request a new one</Link>.
        </p>
      )}
    </div>
  )
}
```

(Verify `../../../../../services/membership-cancel` resolves to `src/services/membership-cancel` — this page is 5 levels under `src/app`.)

- [ ] **Step 4: Add a link on the membership page**

In `src/app/(frontend)/membership/page.tsx`, add near the existing "Ask about membership" link:

```tsx
      <p style={{ marginTop: 16 }}>
        <Link href="/membership/cancel" style={{ color: 'var(--pp-muted)', fontSize: 14 }}>
          Cancel my membership
        </Link>
      </p>
```

(If `Link` from `next/link` isn't already imported in that file, add `import Link from 'next/link'`.)

- [ ] **Step 5: Typecheck + boot check + commit**

Run: `pnpm exec tsc --noEmit` (expect clean)
Run: `pnpm exec playwright test tests/e2e/public-pages.e2e.spec.ts -g "home shows hero headline"`
Expected: PASS (the app compiles with the new pages/routes; a broken import would fail the build).

```bash
git add "src/app/(frontend)/membership/cancel/page.tsx" "src/app/(frontend)/membership/cancel/ConfirmCancelButton.tsx" "src/app/(frontend)/membership/cancel/confirm/page.tsx" "src/app/(frontend)/membership/page.tsx"
git commit -m "Add self-serve membership cancellation pages + link"
```

---

## Task 5: Manual verification

**Files:** none (verification only)

- [ ] **Step 1:** `pnpm dev`. Ensure `PUBLIC_BASE_URL` is set (used for the email link); `RESEND_API_KEY`/`EMAIL_FROM` set so the email actually sends.
- [ ] **Step 2:** Create (admin) an Active member on the Square plan so they have a `squareSubscriptionId` (or use an existing one). Note their email.
- [ ] **Step 3:** Go to `/membership/cancel`, enter that email → confirm you get the generic "if a membership matches…" message and an email arrives with a link.
- [ ] **Step 4:** Enter a **non-member** email → same generic message, **no** email (no enumeration).
- [ ] **Step 5:** Click the link → confirm page shows the member's name + a "Yes, cancel my membership" button. Click it → success message; in the Square sandbox the subscription shows a scheduled cancel; the member's status is now `cancelled`.
- [ ] **Step 6:** Reload/click the same link again → "invalid or has expired" (single-use consumed). Also confirm an old link past 30 min shows the same.

---

## Self-Review Notes

- **Spec coverage:** email-entry page → Task 4. request route (generic, no enumeration) → Task 3 + route test. hashed single-use 30-min token stored on member → Task 1 (fields/migration) + Task 2 (`hashToken`, request/confirm). confirm page validates read-only, no cancel on GET → Task 2 `validateCancelToken` + Task 4 confirm page; cancel only via POST button → Task 3 confirm route + Task 4 button. cancel reuses `status:'cancelled'` hook → Task 2 `confirmMembershipCancel`. single-use (token cleared) → Task 2. cancelable-only / Free excluded → Task 2 guard. confirmation email — note: the spec mentioned a "cancelled" confirmation email; this plan omits it as non-essential (the page already confirms). Add it later if wanted.
- **Type consistency:** `hashToken(raw): string`, `requestMembershipCancel(CancelRequestDeps, email)`, `validateCancelToken(CancelConfirmDeps, token)`, `confirmMembershipCancel(CancelConfirmDeps, token): { ok, reason? }` — used identically in routes (Task 3), pages (Task 4), and tests (Task 2). Field names `cancelTokenHash`/`cancelTokenExpiresAt` consistent across Task 1 fields, Task 2 service, and the migration.
- **Hermeticity:** service tests use a fake payload + fake sendEmail; route tests mock the service AND `payload`/`@payload-config`. No real Square/email/DB writes; the `status:'cancelled'` hook never runs in CI.
- **No placeholders:** every step has concrete code/commands/expected output.
- **Deviation noted:** the spec's optional "cancelled" confirmation email is intentionally out of scope here (page confirms instead); flagged above.

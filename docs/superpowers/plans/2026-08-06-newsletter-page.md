# Public Newsletter Page + Nav Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A public `/newsletter` page rendering the latest sent newsletter + signup form, with a Site Settings toggle that swaps the nav's "Classes" link for "Newsletter".

**Architecture:** A `newsletterInNav` checkbox on the SiteSettings global flows through the frontend layout into Header/MobileNav (link swap only — the Book-a-class CTA never changes). A small service helper fetches the latest sent newsletter server-side; the page renders its body through the existing Lexical→HTML converter inside site typography (`.pp-prose`), not the email shell.

**Tech Stack:** Payload CMS 3.85 (globals, generated migration), Next.js 16 App Router, `convertLexicalToHTML` from `@payloadcms/richtext-lexical/html`, vitest int tests.

**Spec:** `docs/superpowers/specs/2026-08-06-newsletter-page-design.md`

## Global Constraints

- Toggle default **off**; off = nav byte-identical to today. `settings.newsletterInNav ?? false` coercion in the layout (pre-migration docs).
- The "Book a class" CTA (`pp-nav-cta`, `/classes`) is untouched in BOTH navs; the footer Explore list is untouched.
- The page exists at `/newsletter` regardless of the toggle; it may expose ONLY `status: 'sent'` newsletters (its query is a deliberate server-side `overrideAccess: true` on an admin-read collection).
- Schema change (one checkbox on `site_settings`) requires a committed migration — prod runs push-off. Generate via the throwaway-Postgres flow.
- Test fixtures must clean up in `afterAll` (no cross-file pollution of the int suite).
- Commit messages: conventional style, NO AI attribution. Package manager `pnpm`. Deploy target: dev droplet (root@206.189.255.28) ONLY.

---

### Task 1: Toggle field + latest-sent helper (+ migration)

**Files:**
- Modify: `src/globals/SiteSettings.ts` (add checkbox after the `favicon` field)
- Modify: `src/services/newsletter.ts` (append helper)
- Create: `src/migrations/<ts>_newsletter_in_nav.ts` + `.json` (generated)
- Test: `tests/int/newsletter-page.int.spec.ts`

**Interfaces:**
- Produces (used by Tasks 2, 3): `SiteSettings.newsletterInNav?: boolean | null` (generated type); `getLatestSentNewsletter(payload: Payload): Promise<Newsletter | null>` in `src/services/newsletter.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/int/newsletter-page.int.spec.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Payload } from 'payload'
import { getTestPayload } from './helpers'
import { getLatestSentNewsletter } from '../../src/services/newsletter'

let payload: Payload
const madeIds: number[] = []

const BODY = {
  root: {
    type: 'root', format: '' as const, indent: 0, version: 1, direction: 'ltr' as const,
    children: [{
      type: 'paragraph', version: 1, format: '', indent: 0, direction: 'ltr' as const, textFormat: 0,
      children: [{ type: 'text', text: 'Web issue body', version: 1, detail: 0, format: 0, mode: 'normal', style: '' }],
    }],
  },
}

async function makeNewsletter(subject: string, sent: string | null) {
  const doc = await payload.create({
    collection: 'newsletters', overrideAccess: true,
    data: { subject, body: BODY },
  })
  madeIds.push(doc.id as number)
  if (sent) {
    await payload.update({
      collection: 'newsletters', id: doc.id, overrideAccess: true,
      data: { status: 'sent', sentAt: sent, kitBroadcastId: `test-${doc.id}`, recipientCount: 1 },
    })
  }
  return doc
}

beforeAll(async () => {
  payload = await getTestPayload()
})

afterAll(async () => {
  // Sent newsletters are edit-locked but deletable; remove everything we made
  // so this file can't pollute the rest of the int suite.
  try {
    for (const id of madeIds) {
      await payload.delete({ collection: 'newsletters', id, overrideAccess: true })
    }
  } catch (e) {
    payload.logger.error(`newsletter-page test cleanup failed: ${e instanceof Error ? e.message : e}`)
  }
})

describe('getLatestSentNewsletter', () => {
  // Other int files (newsletter-send) create sent newsletters with sentAt=now
  // in the same shared DB, so these tests are written interference-proof:
  // drafts are proven excluded by subject, and this file's sent fixtures use
  // far-future dates so they're strictly newest no matter what else ran.
  it('never returns a draft', async () => {
    await makeNewsletter('Draft only', null)
    const latest = await getLatestSentNewsletter(payload)
    expect(latest?.subject ?? null).not.toBe('Draft only')
    if (latest) expect(latest.status).toBe('sent')
  })

  it('returns the most recently sent issue', async () => {
    await makeNewsletter('Older issue', '2031-07-01T18:00:00.000Z')
    await makeNewsletter('Newest issue', '2031-08-01T18:00:00.000Z')
    await makeNewsletter('Middle issue', '2031-07-15T18:00:00.000Z')
    const latest = await getLatestSentNewsletter(payload)
    expect(latest?.subject).toBe('Newest issue')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test:int tests/int/newsletter-page.int.spec.ts`
Expected: FAIL — `getLatestSentNewsletter` is not exported

(The tests are deliberately interference-proof — see the comment inside the describe block. Do not "simplify" them to a strict null assertion; `newsletter-send.int.spec.ts` leaves sent docs in the shared test DB.)

- [ ] **Step 3: Add the checkbox to `src/globals/SiteSettings.ts`**

After the `favicon` field entry, add:

```ts
    {
      name: 'newsletterInNav', type: 'checkbox', defaultValue: false,
      admin: {
        position: 'sidebar',
        description: 'Show “Newsletter” in the site menu instead of the “Classes” link. The “Book a class” button is unaffected.',
      },
    },
```

- [ ] **Step 4: Append the helper to `src/services/newsletter.ts`**

(`Payload` and `Newsletter` are already imported in this file from the send task.)

```ts
/** The most recently sent newsletter, or null. Server-side only: this
 *  deliberately bypasses the collection's admin-only read access, and can
 *  expose nothing beyond already-sent issues. */
export async function getLatestSentNewsletter(payload: Payload): Promise<Newsletter | null> {
  const { docs } = await payload.find({
    collection: 'newsletters',
    where: { status: { equals: 'sent' } },
    sort: '-sentAt',
    limit: 1,
    depth: 2, // populate upload nodes inside the rich-text body for rendering
    overrideAccess: true,
  })
  return (docs[0] as Newsletter | undefined) ?? null
}
```

- [ ] **Step 5: Regenerate types, run the test**

Run: `pnpm run generate:types && pnpm run test:int tests/int/newsletter-page.int.spec.ts && pnpm exec tsc --noEmit`
Expected: types gain `newsletterInNav`; 2 tests PASS; tsc clean

- [ ] **Step 6: Generate the migration** (throwaway PG; port 5434 if 5433 busy)

```bash
docker rm -f portside-migdev 2>/dev/null; docker run -d --name portside-migdev -e POSTGRES_USER=portside -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=portside_dev -p 5434:5432 postgres:16-alpine
until docker exec portside-migdev pg_isready -U portside >/dev/null 2>&1; do sleep 1; done
DATABASE_URL=postgres://portside:dev@localhost:5434/portside_dev PAYLOAD_SECRET=dev NODE_ENV=development pnpm payload migrate
DATABASE_URL=postgres://portside:dev@localhost:5434/portside_dev PAYLOAD_SECRET=dev NODE_ENV=development pnpm run migrate:create newsletter_in_nav
docker rm -f portside-migdev
```

Expected: a purely additive migration (`ALTER TABLE "site_settings" ADD COLUMN "newsletter_in_nav" boolean DEFAULT false`). Hand-edit `down()` to use `DROP COLUMN IF EXISTS` (house convention). If the migration touches anything else, STOP and report BLOCKED.

- [ ] **Step 7: Commit**

```bash
git add src/globals/SiteSettings.ts src/services/newsletter.ts src/payload-types.ts src/migrations tests/int/newsletter-page.int.spec.ts
git commit -m "feat(newsletter): nav toggle setting and latest-sent helper"
```

---

### Task 2: Nav swap in Header and MobileNav

**Files:**
- Modify: `src/app/(frontend)/layout.tsx` (pass the prop to `<Header …>`)
- Modify: `src/app/(frontend)/components/Header.tsx`
- Modify: `src/app/(frontend)/components/MobileNav.tsx`

**Interfaces:**
- Consumes: `settings.newsletterInNav` (Task 1 type)
- Produces: `Header` prop `newsletterInNav?: boolean`; `MobileNav` prop `newsletterInNav?: boolean`

- [ ] **Step 1: Layout**

In `src/app/(frontend)/layout.tsx`, add to the `<Header … />` props (NOT to Footer):

```tsx
          newsletterInNav={settings.newsletterInNav ?? false}
```

- [ ] **Step 2: Header**

In `src/app/(frontend)/components/Header.tsx`:

- Add `newsletterInNav` to the destructured props and the props type:

```tsx
export function Header({
  studioName,
  logoUrl,
  phone,
  email,
  hours,
  socials,
  newsletterInNav,
}: {
  studioName: string
  logoUrl: string | null
  phone?: string | null
  email?: string | null
  hours?: { days?: string | null; time?: string | null }[] | null
  socials?: Socials | null
  newsletterInNav?: boolean
}) {
```

- Replace the desktop nav's Classes line (`<Link href="/classes">Classes</Link>`) with:

```tsx
          {newsletterInNav ? (
            <Link href="/newsletter">Newsletter</Link>
          ) : (
            <Link href="/classes">Classes</Link>
          )}
```

(The `pp-nav-cta` "Book a class" link stays exactly as-is.)

- Pass the prop through to the mobile nav: change `<MobileNav />` to `<MobileNav newsletterInNav={newsletterInNav} />`.

- [ ] **Step 3: MobileNav**

In `src/app/(frontend)/components/MobileNav.tsx`, accept the prop:

```tsx
export function MobileNav({ newsletterInNav }: { newsletterInNav?: boolean }) {
```

and replace its Classes line (`<Link href="/classes" onClick={() => setOpen(false)}>Classes</Link>`) with:

```tsx
        {newsletterInNav ? (
          <Link href="/newsletter" onClick={() => setOpen(false)}>Newsletter</Link>
        ) : (
          <Link href="/classes" onClick={() => setOpen(false)}>Classes</Link>
        )}
```

(The mobile `pp-nav-cta` "Book a class" link stays exactly as-is.)

- [ ] **Step 4: Verify**

Run: `pnpm exec tsc --noEmit && pnpm run lint`
Expected: tsc clean; lint has only the known pre-existing `src/admin/PriceField.tsx` error.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(frontend)/layout.tsx" "src/app/(frontend)/components/Header.tsx" "src/app/(frontend)/components/MobileNav.tsx"
git commit -m "feat(newsletter): toggleable Newsletter nav link replacing Classes"
```

---

### Task 3: The /newsletter page + prose styles

**Files:**
- Create: `src/app/(frontend)/newsletter/page.tsx`
- Modify: `src/styles/globals.css` (append `.pp-prose` block before the MULTI-COLUMN FOOTER section)

**Interfaces:**
- Consumes: `getLatestSentNewsletter` (Task 1); `NewsletterSignup` from `../components/NewsletterSignup` (existing); `convertLexicalToHTML` from `@payloadcms/richtext-lexical/html`

- [ ] **Step 1: Write the page**

```tsx
// src/app/(frontend)/newsletter/page.tsx
import { getPayload } from 'payload'
import config from '@payload-config'
import { convertLexicalToHTML } from '@payloadcms/richtext-lexical/html'
import type { SerializedEditorState } from '@payloadcms/richtext-lexical/lexical'
import { getLatestSentNewsletter } from '../../../services/newsletter'
import { NewsletterSignup } from '../components/NewsletterSignup'

export const metadata = {
  title: 'Newsletter',
  description: 'News from the studio — new classes, kiln openings, and what the community is making.',
}

export const dynamic = 'force-dynamic'

export default async function NewsletterPage() {
  const payload = await getPayload({ config: await config })
  const issue = await getLatestSentNewsletter(payload)

  const sentLabel = issue?.sentAt
    ? new Date(issue.sentAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : null
  const bodyHtml = issue ? convertLexicalToHTML({ data: issue.body as unknown as SerializedEditorState }) : null

  return (
    <div style={{ padding: '40px 0 56px', maxWidth: 680 }}>
      <div className="pp-kicker">From the studio</div>
      {issue ? (
        <>
          <h1 style={{ marginTop: 8 }}>{issue.subject}</h1>
          {sentLabel && <p style={{ color: 'var(--pp-muted)', marginTop: 4 }}>{sentLabel}</p>}
          {/* Trusted content: admin-authored rich text through Payload's escaping converter. */}
          <div className="pp-prose" dangerouslySetInnerHTML={{ __html: bodyHtml! }} />
        </>
      ) : (
        <>
          <h1 style={{ marginTop: 8 }}>Newsletter</h1>
          <p style={{ color: 'var(--pp-muted)', lineHeight: 1.7 }}>
            Our first issue is in the works — sign up and it&apos;ll land in your inbox.
          </p>
        </>
      )}

      <h2 style={{ fontSize: 20, marginTop: 40, marginBottom: 4 }}>Get the next one in your inbox</h2>
      <div style={{ maxWidth: 420 }}>
        <NewsletterSignup startedAt={Date.now()} />
      </div>
    </div>
  )
}
```

NOTE: `NewsletterSignup`'s error text color (`#ffb4a8`) was chosen for the dark footer; on this cream page it's low-contrast but functional — acceptable for now (deferred minor; do not fix in this task).

- [ ] **Step 2: Append prose styles to `src/styles/globals.css`** (directly above the `/* ─── MULTI-COLUMN FOOTER` line)

```css
/* ─── PROSE (rendered newsletter body) ───────────────────────── */
.pp-prose { margin-top: 24px; font-size: 16.5px; line-height: 1.7; color: var(--pp-charcoal); }
.pp-prose h2, .pp-prose h3 { margin: 28px 0 8px; }
.pp-prose p { margin: 0 0 14px; }
.pp-prose ul, .pp-prose ol { margin: 0 0 14px; padding-left: 22px; }
.pp-prose li { margin-bottom: 6px; }
.pp-prose img { max-width: 100%; border-radius: 8px; margin: 10px 0; }
.pp-prose a { color: var(--pp-terracotta); }
```

- [ ] **Step 3: Verify + local smoke**

Run: `pnpm exec tsc --noEmit && pnpm run lint`
Expected: clean (same known pre-existing lint error only). Then `pnpm run dev`: `/newsletter` renders the empty state locally (or an issue, if the local DB has a sent one); toggle `newsletterInNav` in local admin Site Settings → header link swaps, Book a class remains in both navs.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(frontend)/newsletter/page.tsx" src/styles/globals.css
git commit -m "feat(newsletter): public page rendering the latest sent issue"
```

---

### Task 4: Full suite + dev-droplet deploy

**Files:** none new

- [ ] **Step 1: Full verification**

```bash
pnpm run test:int && pnpm exec tsc --noEmit && pnpm run build
```

Expected: all green (recreate `portside_test` via the dockerized psql command if the suite hangs on a drizzle prompt — and note the schema change here means a stale `portside_test` may prompt; recreate preemptively if in doubt).

- [ ] **Step 2: Deploy to the dev droplet** (sequential commands — never run two docker builds concurrently)

```bash
docker build --platform linux/amd64 --build-arg NEXT_PUBLIC_SQUARE_ENVIRONMENT=sandbox --build-arg NEXT_PUBLIC_SQUARE_APP_ID=sandbox-sq0idb-BxeQOCwSZKHugBsZoIUXZA --build-arg NEXT_PUBLIC_SQUARE_LOCATION_ID=LMDEFJRFBWN3E -t portside:test .
docker save portside:test | gzip -1 | ssh root@206.189.255.28 'gunzip | docker load'
ssh root@206.189.255.28 'cd /opt/portside && docker compose run --rm app pnpm payload migrate 2>&1 | tail -3 && docker compose up -d --force-recreate app && docker image prune -f >/dev/null'
```

Expected: migration `newsletter_in_nav` applies; app recreates clean.

- [ ] **Step 3: E2E on https://brianwells.org**

- [ ] `/newsletter` renders the latest sent issue (dev has sent test issues) with site styling and working images, plus the signup form
- [ ] Site Settings → toggle ON → header shows Newsletter (desktop + mobile), Book a class still present in both; toggle OFF → Classes returns
- [ ] Footer Explore list unchanged either way

- [ ] **Step 4: Push**

```bash
git push
```

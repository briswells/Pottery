# Public Newsletter Page + Nav Toggle — Design

**Date:** 2026-08-06
**Status:** Approved

## Goal

A public `/newsletter` page that renders the most recent **sent** newsletter
plus a signup form, and a Site Settings toggle that swaps the header nav's
"Classes" link for a "Newsletter" link. Ships to the dev instance
(brianwells.org) only; prod picks it up at the next prod deploy.

## Decisions (settled during brainstorming)

- **Toggle semantics:** a `newsletterInNav` checkbox on Site Settings
  (default **off**). Off = nav exactly as today. On = the "Classes" nav link
  becomes "Newsletter" → `/newsletter` in BOTH desktop and mobile navs. The
  **"Book a class" CTA button is untouched** in both navs, so `/classes`
  stays reachable. The footer's Explore list keeps its Classes link.
- **Page content:** the latest sent issue + the existing signup form. No
  archive/past-issues list (YAGNI).
- **The page always exists** at `/newsletter` regardless of the toggle — the
  toggle controls only the nav link.
- **Empty state:** with no sent newsletters, the page shows a
  "first issue coming soon" message and the signup form.

## Architecture

```
SiteSettings.newsletterInNav ──▶ layout.tsx ──▶ Header / MobileNav (link swap)
newsletters (status=sent, sort -sentAt, limit 1)
        └─ getLatestSentNewsletter(payload) ──▶ /newsletter page
                                                   ├─ subject + sentAt + Lexical→HTML body (site-styled)
                                                   └─ NewsletterSignup (existing component)
```

### 1. Site Settings toggle — `src/globals/SiteSettings.ts`

```ts
{
  name: 'newsletterInNav', type: 'checkbox', defaultValue: false,
  admin: {
    position: 'sidebar',
    description: 'Show “Newsletter” in the site menu instead of the “Classes” link. The “Book a class” button is unaffected.',
  },
}
```

Schema change → one generated migration (boolean column on `site_settings`)
+ regenerated payload types.

### 2. Nav swap — `src/app/(frontend)/layout.tsx`, `Header.tsx`, `MobileNav.tsx`

- Layout passes `newsletterInNav={settings.newsletterInNav ?? false}` to
  `Header`; `Header` forwards it to `MobileNav`.
- In both navs, the Classes slot renders:
  - off: `<Link href="/classes">Classes</Link>` (unchanged)
  - on: `<Link href="/newsletter">Newsletter</Link>`
- Both "Book a class" CTA links (`pp-nav-cta`) stay pointed at `/classes`.

### 3. Latest-sent helper — `src/services/newsletter.ts` (append)

```ts
/** The most recently sent newsletter, or null. Server-side only: this
 *  deliberately bypasses the collection's admin-only read access, exposing
 *  nothing beyond sent issues. */
export async function getLatestSentNewsletter(payload: Payload): Promise<Newsletter | null>
```

`payload.find({ collection: 'newsletters', where: { status: { equals: 'sent' } },
sort: '-sentAt', limit: 1, depth: 2, overrideAccess: true })` → first doc or null.
Depth 2 populates upload nodes in the rich-text body for rendering.

### 4. The page — `src/app/(frontend)/newsletter/page.tsx`

Server component, `dynamic = 'force-dynamic'` (matches sibling pages), with
metadata (`title: 'Newsletter'`).

- Fetches the helper. When a newsletter exists:
  - `.pp-kicker` "From the studio"
  - `<h1>{subject}</h1>`
  - sent date formatted like other site dates (e.g. "August 5, 2026")
  - body: `convertLexicalToHTML({ data: body })` rendered via
    `dangerouslySetInnerHTML` inside `<div className="pp-prose">` — site
    typography, NOT the email shell (no card, no email footer). Relative
    media URLs are same-origin on the page, so no absolutization needed.
- When none exists: kicker + `<h1>Newsletter</h1>` + "Our first issue is in
  the works — sign up and it'll land in your inbox."
- Both states end with a "Get the next one in your inbox" heading and the
  existing `<NewsletterSignup startedAt={Date.now()} />`.

### 5. Prose styles — `src/styles/globals.css` (append)

A small `.pp-prose` block scoped to converter output: heading margins,
paragraph line-height 1.7, `img { max-width: 100%; border-radius: 8px; }`,
list padding, link color via existing `--pp-terracotta`.

## Error handling

- Helper returns null on empty result; the page renders the empty state (no
  throw). A DB error surfaces as the framework 500 like sibling pages.
- Toggle field absent/undefined (pre-migration doc) coerces to `false` via
  `?? false` in the layout.

## Testing

- `tests/int/newsletter-page.int.spec.ts`: `getLatestSentNewsletter` picks
  the newest sent issue (two sent docs with different `sentAt`), ignores
  drafts, returns null when none are sent. Fixtures cleaned up in `afterAll`
  (the class-series lesson: no cross-file pollution).
- Manual on dev: toggle off → nav unchanged; toggle on → Newsletter link in
  desktop + mobile nav, Book a class still present; `/newsletter` renders a
  sent issue with images; empty-state check against a DB with no sent issues
  (or by eyeballing the conditional).

## Deployment

Dev droplet (brianwells.org) only for now: migration (`newsletterInNav`
column) + normal deploy loop. Prod inherits the migration at the next prod
deploy; the toggle defaults off, so prod's nav is unchanged until Brian
flips it in Site Settings.

## Out of scope (YAGNI)

- Past-issues archive / per-issue pages
- Swapping the footer Explore link
- Open/click tracking on the web page

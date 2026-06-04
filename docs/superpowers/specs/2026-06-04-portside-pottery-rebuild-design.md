# Portside Pottery — Website Rebuild Design

**Date:** 2026-06-04
**Status:** Approved (design phase)
**Author:** Brian Wells

## 1. Summary

Replace Portside Pottery's current GoDaddy Website Builder site with a custom,
self-hosted web application. The new system reproduces today's content and
booking/membership functionality, but is architected so studio **staff can
self-manage all content with zero developer involvement**, and so the planned
roadmap features (news/announcements, member management) are cheap additions
rather than rewrites.

Portside Pottery is a 24/7 community ceramics studio in Vancouver, WA
(2121 St Francis Ln; 360-838-3246; getcreative@portsidepottery.com). It offers
wheel-throwing class series, day camps, raku, and a $200/month studio
membership.

## 2. Goals & non-goals

### Goals (Phase 1)
- Recreate the existing pages with a fresh, professional redesign:
  Home, Classes (+ per-class pages), Membership, Meet the Staff.
- Staff self-serve **all** content creation/editing via an admin UI — no
  dependence on the developer, no GoDaddy.
- Online **class/camp booking with one-time payment** via Square.
- Online **membership signup with recurring $200/mo billing** via Square
  subscriptions (card on file).
- Staff-facing **member management foundation**: track member status, shelf
  assignment, and recent payment status.
- Build an **authentication foundation** that supports a member-facing portal
  soon, even though the member-facing UI is thin in Phase 1.

### Non-goals (Phase 1 — modeled now, built later)
- Member-facing self-service portal (login, view bookings, update card,
  self-cancel) → Phase 2.
- News/announcements (Articles) → Phase 3.
- Visual shelf map, waitlists, gift cards, selling finished pottery → later.
- In-person POS (stays in Square directly; out of scope for the website).

## 3. Decisions (from brainstorming)

| Topic | Decision |
|-------|----------|
| Ops/ownership | Brian develops + hosts/maintains infrastructure. Staff self-serve all content via admin UI. |
| Payment scope | Online: one-time class/camp payments **and** recurring $200/mo membership subscriptions. |
| Accounts | Staff admin built now. Auth foundation built now so a member portal can follow soon; member-facing UI thin in Phase 1. |
| Stack | Recommended: Next.js + Payload CMS + PostgreSQL + Square (custom integration). |
| Visual direction | Fresh, professional redesign — **Direction A "Warm Earthen Studio"** (editorial serif headings; terracotta + cream palette; warm photography). Same pages/content as today. |
| Failed membership payment | Flag member "past due" + notify staff and member. No automatic lockout. Square continues its own retries. |

## 4. Architecture

Single Next.js application, single deployable, with Payload CMS running inside
it (Payload 3.x is a fullstack Next.js framework).

```
Next.js app (one repo, one deploy)
├── Public site (App Router, SSR)  → Home, Classes, Class detail, Membership, Staff
│     reads content via Payload local API (in-process, no network hop)
├── Payload CMS at /admin           → auto-generated admin UI, auth + RBAC,
│                                      custom endpoints (Square webhooks)
└── Server actions / endpoints      → booking + membership payment orchestration

PostgreSQL  → single source of truth (content, members, bookings, payments)
Square APIs → Web Payments SDK (browser tokenization), Payments (one-time),
              Subscriptions + Catalog + Customers + Cards (recurring), Webhooks
S3-compatible bucket → media (images)
Email provider (Resend or Postmark) → confirmations + alerts
```

Key principle: the public website and the staff admin are the **same app**, so
adding a feature means adding a collection + a page — not new infrastructure.

PCI posture: cards are tokenized client-side by Square's Web Payments SDK
(hosted iframe). The server only ever handles a one-time token, never raw card
data → keeps PCI scope at SAQ A.

## 5. Data model (Payload collections & globals)

Legend: **(now)** = Phase 1; **(later)** = modeled now, built in a later phase.

### Content
- **Global `SiteSettings`** (now): address, phone, email, hours, social links.
- **Global `HomePage`** (now): hero tagline, "Our Purpose / Our Studio /
  Our Members" section copy.
- **Global `MembershipPage`** (now): price + benefits list (24hr access, 18
  Shimpo Whisper wheels, slab roller, extruder, shelf, 10+ glazes, onsite
  laundry, raku kiln, cone 6 firing).
- **`Media`** (now): uploaded images (staff photos, class images, gallery).
- **`Articles`** (later): title, slug, body (rich text), cover image,
  publishedAt — news/announcements.

### People
- **`Users`** — staff, auth-enabled (now):
  - `name`, `email`, `roles` (`admin` | `editor`, multi-select, `saveToJWT`,
    role updates admin-only)
  - public-profile fields: `title`, `bio`, `photo` (→ Media), `showOnStaffPage`,
    `order`
  - Doubles as the source for the "Meet the Staff" page (Eric, Naiomi).
- **`Members`** — auth-enabled, member-facing login thin in Phase 1 (now for
  records + auth; portal later):
  - `name`, `email`, `phone`, `status` (active | paused | cancelled),
    `joinedDate`, `shelfLabel` (plain text for now), `notes`
  - Square link fields: `squareCustomerId`, `squareSubscriptionId`,
    `subscriptionStatus`, `lastPaymentDate`, `lastPaymentStatus`

### Commerce
- **`Classes`** (now): each document is one scheduled offering.
  - `title`, `slug`, `description`/`body`, `image` (→ Media),
    `category` (wheel-series | day-camp | raku | daytime-multiweek),
    `skillLevel`, `priceCents`, `capacity`, `startDate`, `scheduleText`,
    `instructor` (→ Users), `status` (active | archived)
  - computed `seatsRemaining`
- **`Bookings`** (now): one per registration.
  - `class` (→ Classes), `customerName`, `email`, `phone`,
    `status` (pending | paid | cancelled | refunded), `amountCents`,
    `squarePaymentId`. Guest checkout in Phase 1; linkable to a Member later.
- **`Payments`** (now): log written by Square webhooks.
  - `type` (booking | membership), `member` (→ Members, optional),
    `amountCents`, `squareId`, `status`, `paidAt`.
  - Powers the "have they paid recently?" view.

### Roadmap mapping
- **News** → ship `Articles` + a `/news` page.
- **Member management** ("new member, where's their shelf, have they paid?") →
  `shelfLabel` + `subscriptionStatus`/`lastPaymentDate` on `Members`, payment
  history in `Payments`, surfaced as a sortable/filterable admin list with
  overdue rows flagged.

## 6. Payment flows (Square)

### Flow 1 — Class/camp booking (one-time)
1. Customer on a class page enters name/email/phone; Square Web Payments SDK
   tokenizes the card in-browser.
2. Browser POSTs `{classId, customer, token}` to a Payload endpoint / server
   action.
3. Server: re-check `seatsRemaining` inside a transaction (no overbooking) →
   `Square CreatePayment` with **amount read from the Class record, never the
   client** + idempotency key.
4. On success: create `Booking(status=paid)`, decrement seats, write a
   `Payments` row, send confirmation email.
5. `payment.updated` webhook reconciles later refunds/disputes.

### Flow 2 — Membership ($200/mo recurring)
1. Visitor on Membership page enters details; card tokenized in-browser.
2. Server: find/create Square `Customer` → save `Card` on file → create
   `Subscription` against the "$200/mo" Catalog plan (idempotency key).
3. Create `Member(status=active, squareCustomerId, squareSubscriptionId,
   joinedDate)`. Staff later set `shelfLabel`.
4. Webhooks drive ongoing truth:
   - `invoice.payment_made` → update `lastPaymentDate`/`lastPaymentStatus`,
     append `Payments` row.
   - `invoice.payment_failed` → flag member **past due**, notify staff +
     member (no auto-lockout).
   - `subscription.updated` → update `subscriptionStatus` (paused/cancelled).
5. Staff can pause/cancel a membership from the admin (calls Square's cancel
   API). Member self-service deferred to Phase 2 portal.

### Guardrails
- Amounts always server-authoritative (read from DB).
- Idempotency keys on all create calls.
- Webhook signatures verified.
- Built and tested against Square Sandbox before live keys.

## 7. Hosting, ops & email
- **Docker Compose on a VPS** (e.g. Hetzner/DigitalOcean): app, PostgreSQL,
  Caddy (auto-HTTPS).
- **Media** in an S3-compatible bucket (survives redeploys; clean backups).
- **Nightly Postgres backups** offsite. Secrets in env, never in repo.
- **Email**: Resend or Postmark for booking confirmations + "past due" alerts.
- **Cutover**: build/verify on a staging subdomain; keep GoDaddy live until
  satisfied; then repoint `portsidepottery.com` DNS to the VPS.

## 8. Migration
- Existing members may already exist as Square customers with active
  subscriptions (in-person POS history). A **one-time import** pulls existing
  Square customers/subscriptions and creates matching `Members` records, rather
  than re-enrolling everyone.
- Re-enter current class offerings and staff bios in the new admin (small,
  manual — current catalog is ~10 offerings, 2 staff).

## 9. Testing
- Payment work developed against **Square Sandbox** first.
- Integration tests: capacity/no-overbooking, webhook signature verification +
  idempotency, failed-payment flagging.
- Playwright E2E happy paths: *book a class*, *become a member*.

## 10. Phased roadmap
- **Phase 1 (now):** Direction-A public site; staff admin (classes, staff bios,
  site content via globals); class booking + one-time payment; membership
  signup + recurring billing; `Members` admin with shelf + payment-status
  tracking; Square webhooks; confirmation/alert emails; existing-member import.
- **Phase 2:** member portal — login, view bookings, update card, self-cancel.
- **Phase 3:** Articles/news.
- **Later (modeled, not built):** visual shelf map, waitlists, gift cards.

## 11. Open questions / risks
- **Square subscription plan setup**: confirm whether the $200/mo plan is
  created in Square Catalog (managed) vs. ad-hoc per subscription. Resolve
  during implementation against Sandbox.
- **Email provider choice** (Resend vs Postmark) — to confirm before build.
- **VPS provider choice** — to confirm before build.
- **Existing-member data quality** in Square — verify field availability for
  the import (emails, active subscription IDs).

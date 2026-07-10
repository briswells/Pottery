# Invoice-Based Membership Sync — Design Spec

**Date:** 2026-07-10
**Status:** Approved (design), pending implementation plan

## Goal

The studio bills members with Square **recurring invoices** (not subscriptions).
Mirror those members into the site read-only: auto-create People from membership
invoices, keep their `active` / `past_due` / `cancelled` status current, and give
them a plan so staff can assign shelves and see them as members. Square stays the
billing system and the ledger.

## Probe findings this design relies on (verified 2026-07-10, production account)

- The Subscriptions API returns **zero** subscriptions — recurring series are NOT
  exposed there. Invoice scanning is the only mechanism.
- Membership invoices carry `title: "Membership"`; other invoices exist (no title).
- Recurring invoices use `invoice_number` format `NNNNNN-R-KKKK` (series `NNNNNN`,
  occurrence `KKKK`). One-off invoices lack `-R-`.
- An active series always has `SCHEDULED` future invoices; cancelling a series
  cancels its remaining scheduled invoices. Statuses observed: SCHEDULED, PAID,
  UNPAID, CANCELED, REFUNDED.
- `primary_recipient` gives `customer_id`, `email_address`, and name fields —
  enough to build a Person without extra Customers API calls.
- Mixed payment modes: `automatic_payment_source` is `CARD_ON_FILE` for some
  members, `NONE` (emailed invoice) for others. Only behavior difference here:
  manual payers are the realistic `past_due` cases.

## Hard constraints

- **READ-ONLY against Square** (standing user rule): `ListInvoices` (GET,
  paginated) only. The sync never creates/updates anything in Square.
- Production credentials do NOT go on any droplet as part of this feature's
  development; deployment happens with the Phase 2 flip, on explicit user go.
- **No emails from this flow at all** — not to members (Square handles their
  dunning) and not to staff. Overdue visibility is in-platform only: the member
  shows as `past_due` in the admin People list.

## Non-goals (YAGNI)

- No payments rows for invoice members (Square is the ledger).
- No self-serve cancel for invoice members (staff cancel the series in Square;
  the sync notices within a cycle, or instantly via webhook).
- No changes to the subscription machinery — it remains for a future migration.
- No writing of invoice detail fields onto People beyond what status needs.

## Data model

- New `MembershipPlan` ensured at boot (like `ensureFreePlan`): name
  **"Membership (invoiced)"**, `kind: 'free'` (unbilled/manual kind — no Square
  plan variation), `active: true`. Idempotent find-or-create by name+kind.
- People: NO new fields. Reuses `name`, `email`, `phone`, `squareCustomerId`,
  `plan`, `status` (`active`/`past_due`/`cancelled`), `joinedDate` (earliest
  membership invoice `created_at`, set only when empty).
- `squareSubscriptionId` stays empty for invoice members — that field remains
  the marker of a real subscription member, so `reconcileMemberSubscription` /
  `cancelSquareSubscription` hooks naturally no-op for invoice members
  (verify in tests: staff editing an invoice member must not trigger Square
  subscription calls).

## Behavior

### Service: `reconcileInvoiceMembers` (`src/services/reconcile-invoice-members.ts`)
1. Page through `ListInvoices` for the location (read-only GET; gateway method
   added to `membership-gateway` following its existing style so tests can fake it).
2. Keep invoices where `title` matches `/membership/i`.
3. Group by `primary_recipient.customer_id`.
4. Per customer, derive status:
   - any `SCHEDULED` invoice → series alive → `active`
   - override to `past_due` if any `UNPAID` invoice is ≥ `MEMBERSHIP_GRACE_DAYS`
     (default 3) past its `payment_requests[0].due_date` (reuse `isInvoicePastDue`)
   - no `SCHEDULED` invoices → `cancelled`
5. Upsert the Person via `upsertPersonByEmail` (email from primary_recipient;
   name from recipient given/family name, fallback "Imported Member"), then set:
   `plan` = the invoiced plan (only if the person has no plan yet, or already has
   the invoiced plan — never overwrite a real subscription member's plan),
   `squareCustomerId`, `status`, `joinedDate` (if empty). Skip + log a warning
   for invoices with no customer_id/email. Context flag `fromSquareWebhook: true`
   on writes so subscription-era People hooks stay inert.
6. Status flips are idempotent — only write on change. No emails are sent on
   any transition (overdue is surfaced purely by the `past_due` status in admin).
7. Return `{ processed, active, pastDue, cancelled, skipped, failed }` for logs.

### Scheduling
- `onInit`: run once at boot (non-blocking, same pattern as
  `reconcileSquareMembers`) and every 6h (share/parallel the existing
  `SQUARE_MEMBER_SYNC_INTERVAL_MINUTES` timer cadence). Runs only when
  `SQUARE_ACCESS_TOKEN` is configured; safe no-op when the account has no
  invoices (dev/sandbox).

### Webhook (live updates)
- `invoice.updated` / `invoice.payment_made` handlers get an additional branch:
  when the event's invoice has NO `subscription_id` but its title matches
  `/membership/i`, resolve the Person by `squareCustomerId` =
  `primary_recipient.customer_id` and re-derive that one customer's status via
  the same rules (fetching just that customer's membership invoices through the
  gateway). Existing subscription-keyed behavior is untouched; the membership
  branch must not interfere with it.

### Ordering / conflicts
- If a person ever has BOTH a real subscription and invoice history, the
  subscription machinery wins: the invoice sync skips People whose
  `squareSubscriptionId` is set.

## Testing (integration, mocked gateway — no real Square calls)
- Grouping/status matrix: scheduled-only → active; scheduled + overdue unpaid →
  past_due; no scheduled → cancelled; new scheduled after cancelled → active.
- Grace window: unpaid due yesterday (grace 3) → still active; due 5 days ago →
  past_due.
- Person creation: fields, invoiced plan assigned, joinedDate from earliest
  invoice, no plan overwrite for a person already on a different plan,
  subscription members (squareSubscriptionId set) skipped.
- No email of any kind is sent by the sync (mock sendEmail, assert uncalled
  across all transitions including into past_due).
- Editing an invoice member in admin triggers no Square subscription calls
  (mock the Square client, assert uncalled).
- Non-membership invoices ignored; missing-customer invoices skipped + counted.
- Webhook branch: membership invoice event with no subscription_id updates the
  right person; subscription-backed invoice events behave exactly as before.

## Deployment note
Ships with the Phase 2 production flip (explicit user authorization required to
put credentials on the droplet). Until then the feature is inert in dev/sandbox
(no membership-titled invoices there).

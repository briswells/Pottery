# Dollar-Based Price Inputs (Admin) — Design

**Date:** 2026-06-07
**Scope:** Payload admin UI only. Replace raw integer-cents entry/display with dollar-formatted inputs and displays. Storage stays in cents; no schema change, no migration, no change to Square/webhook/email/frontend logic.

## Problem

Staff currently type and read prices as integer **cents** in the Payload admin (e.g. `4500` for $45.00), which is error-prone and confusing. The admin list columns also show raw cents.

## Goals

- Anywhere a price is **assigned** in the admin, use a text input with a fixed `$` prefix that accepts dollars-and-cents and only allows numeric input.
- Anywhere a price is **displayed** in the admin, show dollars (e.g. `$45.00`).
- Keep cents as the stored source of truth so nothing downstream changes.

## Non-goals

- No DB schema/field-name changes (fields keep their `*Cents` names and integer-cents values).
- No changes to Square charges/invoices, webhooks, emails, or the customer-facing frontend (it already renders dollars via `usd()`).
- No change to `WalletButtons` `(priceCents/100).toFixed(2)` — that feeds the Square SDK, not a display.
- Membership price (`MembershipPage.priceLabel`) is a free-text label already in dollars — untouched.

## Affected fields (all four cents fields)

| Collection | Field | Required | In default list columns? |
|------------|-------|----------|--------------------------|
| `Classes` | `priceCents` | yes (`required: true, min: 0`) | no |
| `FiringRequests` | `quotedPriceCents` | no (`min: 0`) | yes |
| `Bookings` | `amountCents` | yes (`required: true`) | yes |
| `Payments` | `amountCents` | yes (`required: true`) | yes |

Each gets `admin.components: { Field: PriceField, Cell: PriceCell }`.

## Architecture

### 1. Conversion helpers — `src/lib/format.ts`

Pure, unit-tested functions added next to the existing `usd()`:

```ts
/** Integer cents -> dollars string with 2 decimals, no symbol. 4500 -> "45.00". */
export const centsToDollars = (cents: number): string => (cents / 100).toFixed(2)

/**
 * Parse a user-typed dollars string into integer cents.
 * Strips everything except digits and the first dot; keeps at most 2 decimals;
 * rounds to the nearest cent. Returns null for empty/invalid input.
 *   "45"     -> 4500
 *   "45.1"   -> 4510
 *   "45.5"   -> 4550
 *   "45.999" -> 4600   (rounds)
 *   "$45.00" -> 4500   (symbol stripped)
 *   ""       -> null
 */
export const dollarsToCents = (input: string): number | null => {
  const cleaned = input.replace(/[^0-9.]/g, '')
  if (cleaned === '' || cleaned === '.') return null
  const firstDot = cleaned.indexOf('.')
  const normalized =
    firstDot === -1
      ? cleaned
      : cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '')
  const dollars = Number(normalized)
  if (!Number.isFinite(dollars)) return null
  return Math.round(dollars * 100)
}
```

Rounding note: `Math.round(45.1 * 100)` → `Math.round(4509.9999…)` → `4510`, so float drift is handled.

### 2. `PriceField` — `src/admin/PriceField.tsx` (`'use client'`)

The edit component for all four fields.

- Uses Payload's `useField<number | undefined>({ path })` to read/write the **cents** value.
- Local React state holds the raw text the user is typing (so partial input like `45.` is preserved while editing).
- Initial display: `value == null ? '' : centsToDollars(value)`.
- `onChange`:
  - Filter the keystroke text to digits + at most one dot + at most 2 decimal places (regex guard), so letters/extra dots/negatives never appear.
  - Convert via `dollarsToCents`; `setValue(cents ?? undefined)`.
  - Keep the typed text in local state for display.
- `onBlur`: re-derive display from the stored cents (`value == null ? '' : centsToDollars(value)`) so it always settles to a clean 2-decimal string.
- Renders Payload's `FieldLabel` (with `required`) and `FieldError`, and the field `admin.description` beneath, matching default field chrome. A fixed `$` is rendered to the left of the input (e.g. an absolutely-positioned span or input-group), and is not part of the editable text.
- Honors `readOnly` from field/admin props.
- A11y: input `inputMode="decimal"`, `aria-label` from the field label.

### 3. `PriceCell` — `src/admin/PriceCell.tsx` (`'use client'`)

The list-column display for the same fields.

- Receives the cell value (cents). Renders `usd(cents)` when it's a finite number, otherwise an empty string (e.g. an unset firing price).

### 4. Wiring + import map

- Add `admin.components: { Field: '/admin/PriceField#PriceField', Cell: '/admin/PriceCell#PriceCell' }` (or the path convention the repo's import map expects) to each of the four fields.
- Update each field's `admin.description` from "in cents" wording to dollars wording.
- Run `pnpm generate:importmap` so the components are registered in `src/app/(payload)/admin/importMap.js`.

## Edge cases

- **Empty optional field** (`quotedPriceCents`): empty input → `setValue(undefined)`; no invoice is sent until a price is set (existing service guard already handles `<= 0`).
- **Empty required field** (`priceCents`, `amountCents`): empty → unset → Payload's existing required validation fires on save.
- **Paste** of `"$45.00"` or `"45.00 USD"`: non-numeric stripped by the same filter.
- **Multiple dots** (`"45.1.2"`): only the first dot kept → `"45.12"`.
- **More than 2 decimals** typed: blocked at the keystroke filter; if pasted, `dollarsToCents` rounds.
- **Negative**: `-` is stripped (not in the allowed character set), and `min: 0` remains.

## Testing

- **Unit (vitest, `tests/int/format.int.spec.ts` or a unit spec):** thorough coverage of `dollarsToCents` and `centsToDollars` — the cases in the doc comment above plus `"0"`→0, `".5"`→50, `"45."`→4500, `""`→null, `"abc"`→null, round-trip `centsToDollars(dollarsToCents("45.10")) === "45.10"`.
- **Manual admin verification:** in the running admin, confirm each of the four fields shows a `$`-prefixed input that rejects letters, stores the right cents (spot-check by reading the DB or the value after save), and that the Bookings/Payments/FiringRequests list columns render `$X.XX`. Confirm a firing with a price set then Approved still invoices correctly (cents unchanged end-to-end).

## Files

| File | Change |
|------|--------|
| `src/lib/format.ts` | Add `centsToDollars`, `dollarsToCents` |
| `src/admin/PriceField.tsx` | **New** — `$`-prefixed dollar input, stores cents |
| `src/admin/PriceCell.tsx` | **New** — list-column dollar display |
| `src/collections/Classes.ts` | Wire components on `priceCents`; reword description |
| `src/collections/FiringRequests.ts` | Wire components on `quotedPriceCents`; reword description |
| `src/collections/Bookings.ts` | Wire components on `amountCents` |
| `src/collections/Payments.ts` | Wire components on `amountCents` |
| `src/app/(payload)/admin/importMap.js` | Regenerated via `pnpm generate:importmap` |
| `tests/int/format.int.spec.ts` (or unit) | **New** — conversion-helper tests |

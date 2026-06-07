# Dollar-Based Price Inputs (Admin) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins enter and read every price in dollars (fixed `$`, numeric-only) while the database keeps storing integer cents.

**Architecture:** Two small Payload v3 client components in `src/admin/` — `PriceField` (a `$`-prefixed dollar input that reads/writes cents via `useField`) and `PriceCell` (renders cents as dollars in list columns) — wired onto all four cents fields. All conversion logic lives in two pure helpers in `src/lib/format.ts` so it can be unit-tested. No schema change, no migration; cents stay the source of truth.

**Tech Stack:** Payload CMS 3.85 (`@payloadcms/ui` `useField`/`FieldLabel`/`FieldError`), React client components, Payload import map (`pnpm generate:importmap`), vitest.

**Spec:** `docs/superpowers/specs/2026-06-07-dollar-price-inputs-design.md`

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/lib/format.ts` | Add pure `centsToDollars` / `dollarsToCents` next to `usd()` |
| `tests/int/format.int.spec.ts` | **New** — unit tests for the two helpers |
| `src/admin/PriceField.tsx` | **New** — `$`-prefixed dollar edit input; stores cents |
| `src/admin/PriceCell.tsx` | **New** — list-column dollar display |
| `src/collections/Classes.ts` | Wire components + label/description on `priceCents` |
| `src/collections/FiringRequests.ts` | Wire components + label/description on `quotedPriceCents` |
| `src/collections/Bookings.ts` | Wire components + label on `amountCents` |
| `src/collections/Payments.ts` | Wire components + label on `amountCents` |
| `src/app/(payload)/admin/importMap.js` | Regenerated via `pnpm generate:importmap` |

Component reference convention (verified): `admin.importMap.baseDir` is `src/`, so components are referenced as `/admin/PriceField#PriceField` and `/admin/PriceCell#PriceCell`.

---

## Task 1: Conversion helpers + unit tests

**Files:**
- Modify: `src/lib/format.ts`
- Test: `tests/int/format.int.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/int/format.int.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { centsToDollars, dollarsToCents } from '../../src/lib/format'

describe('centsToDollars', () => {
  it('formats cents as 2-decimal dollars (no symbol)', () => {
    expect(centsToDollars(4500)).toBe('45.00')
    expect(centsToDollars(22000)).toBe('220.00')
    expect(centsToDollars(0)).toBe('0.00')
    expect(centsToDollars(5)).toBe('0.05')
  })
})

describe('dollarsToCents', () => {
  it('parses whole and decimal dollars to cents', () => {
    expect(dollarsToCents('45')).toBe(4500)
    expect(dollarsToCents('45.1')).toBe(4510)
    expect(dollarsToCents('45.5')).toBe(4550)
    expect(dollarsToCents('45.50')).toBe(4550)
    expect(dollarsToCents('0')).toBe(0)
    expect(dollarsToCents('.5')).toBe(50)
    expect(dollarsToCents('45.')).toBe(4500)
  })
  it('rounds to the nearest cent', () => {
    expect(dollarsToCents('45.999')).toBe(4600)
  })
  it('strips symbols and stray characters', () => {
    expect(dollarsToCents('$45.00')).toBe(4500)
    expect(dollarsToCents('45.00 USD')).toBe(4500)
    expect(dollarsToCents('1,234.50')).toBe(123450)
  })
  it('keeps only the first dot', () => {
    expect(dollarsToCents('45.1.2')).toBe(4512)
  })
  it('returns null for empty/invalid input', () => {
    expect(dollarsToCents('')).toBeNull()
    expect(dollarsToCents('abc')).toBeNull()
    expect(dollarsToCents('.')).toBeNull()
  })
  it('round-trips with centsToDollars', () => {
    expect(centsToDollars(dollarsToCents('45.10')!)).toBe('45.10')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --config ./vitest.config.mts tests/int/format.int.spec.ts`
Expected: FAIL — `centsToDollars`/`dollarsToCents` are not exported yet.

- [ ] **Step 3: Add the helpers to `src/lib/format.ts`**

The current file:

```ts
/** Formats integer cents as a USD string, e.g. 22000 -> "$220.00". */
export const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`
```

Add directly below the `usd` export (keep `usd` and `CATEGORY_LABELS` as-is):

```ts
/** Integer cents -> dollars string with 2 decimals, no symbol. 4500 -> "45.00". */
export const centsToDollars = (cents: number): string => (cents / 100).toFixed(2)

/**
 * Parse a user-typed dollars string into integer cents.
 * Strips everything except digits and dots, keeps only the first dot, then rounds
 * to the nearest cent. Returns null for empty/invalid input.
 *   "45" -> 4500 | "45.1" -> 4510 | "45.999" -> 4600 | "$45.00" -> 4500 | "" -> null
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

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --config ./vitest.config.mts tests/int/format.int.spec.ts`
Expected: PASS (all assertions green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/format.ts tests/int/format.int.spec.ts
git commit -m "Add cents<->dollars conversion helpers with tests"
```

---

## Task 2: PriceField component

**Files:**
- Create: `src/admin/PriceField.tsx`

No automated test: this is a Payload admin client component that depends on the admin form runtime. Its bug-prone logic (parsing/formatting) is already covered by Task 1's helper tests; the component is verified manually in Task 5.

- [ ] **Step 1: Create the component**

Create `src/admin/PriceField.tsx`:

```tsx
'use client'
import React, { useEffect, useState } from 'react'
import { FieldError, FieldLabel, useField } from '@payloadcms/ui'
import { centsToDollars, dollarsToCents } from '../lib/format'

type PriceFieldProps = {
  path: string
  readOnly?: boolean
  field?: {
    label?: string | false
    required?: boolean
    admin?: { description?: unknown }
  }
}

export const PriceField: React.FC<PriceFieldProps> = ({ field, path, readOnly }) => {
  const { value, setValue, showError } = useField<number | undefined>({ path })

  // Local text state so partial input like "45." is preserved while typing.
  const [text, setText] = useState<string>(value == null ? '' : centsToDollars(value))

  // Re-sync display when the stored value changes from outside (e.g. form reset),
  // but never clobber in-progress typing whose parsed value already matches.
  useEffect(() => {
    setText((prev) => {
      if (dollarsToCents(prev) === (value ?? null)) return prev
      return value == null ? '' : centsToDollars(value)
    })
  }, [value])

  const label = field?.label
  const required = field?.required
  const description = field?.admin?.description

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Allow only digits + a single dot, max 2 decimals.
    const raw = e.target.value.replace(/[^0-9.]/g, '')
    const firstDot = raw.indexOf('.')
    const next =
      firstDot === -1
        ? raw
        : `${raw.slice(0, firstDot)}.${raw.slice(firstDot + 1).replace(/\./g, '').slice(0, 2)}`
    setText(next)
    setValue(dollarsToCents(next) ?? undefined)
  }

  const handleBlur = () => setText(value == null ? '' : centsToDollars(value))

  return (
    <div className="field-type number">
      {label !== false && <FieldLabel label={label} required={required} path={path} />}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <span
          aria-hidden="true"
          style={{ position: 'absolute', left: 10, opacity: 0.7, pointerEvents: 'none' }}
        >
          $
        </span>
        <input
          type="text"
          inputMode="decimal"
          aria-label={typeof label === 'string' ? label : 'Price'}
          disabled={readOnly}
          value={text}
          onChange={handleChange}
          onBlur={handleBlur}
          style={{ paddingLeft: 22, width: '100%' }}
        />
      </div>
      {showError && <FieldError path={path} />}
      {typeof description === 'string' && (
        <div className="field-description">{description}</div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no NEW type errors in `src/admin/PriceField.tsx`. (Pre-existing errors elsewhere, if any, are unrelated — confirm none reference this file.)

- [ ] **Step 3: Commit**

```bash
git add src/admin/PriceField.tsx
git commit -m "Add PriceField admin component (dollar input, stores cents)"
```

---

## Task 3: PriceCell component

**Files:**
- Create: `src/admin/PriceCell.tsx`

- [ ] **Step 1: Create the component**

Create `src/admin/PriceCell.tsx`:

```tsx
'use client'
import React from 'react'
import { usd } from '../lib/format'

type PriceCellProps = { cellData?: number | null }

export const PriceCell: React.FC<PriceCellProps> = ({ cellData }) => {
  if (typeof cellData !== 'number' || !Number.isFinite(cellData)) return <span />
  return <span>{usd(cellData)}</span>
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no NEW type errors referencing `src/admin/PriceCell.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/admin/PriceCell.tsx
git commit -m "Add PriceCell admin component (dollar display in lists)"
```

---

## Task 4: Wire components onto the four fields + regenerate import map

**Files:**
- Modify: `src/collections/Classes.ts`
- Modify: `src/collections/FiringRequests.ts`
- Modify: `src/collections/Bookings.ts`
- Modify: `src/collections/Payments.ts`
- Modify (generated): `src/app/(payload)/admin/importMap.js`

- [ ] **Step 1: `Classes.ts` — replace the `priceCents` field**

Find (line ~34):

```ts
    { name: 'priceCents', type: 'number', required: true, min: 0, admin: { description: 'Price in cents, e.g. 22000 = $220.00' } },
```

Replace with:

```ts
    {
      name: 'priceCents',
      type: 'number',
      required: true,
      min: 0,
      label: 'Price',
      admin: {
        description: 'Price in dollars, e.g. 220 for $220.00',
        components: {
          Field: '/admin/PriceField#PriceField',
          Cell: '/admin/PriceCell#PriceCell',
        },
      },
    },
```

- [ ] **Step 2: `FiringRequests.ts` — replace the `quotedPriceCents` field**

Find (line ~45):

```ts
    { name: 'quotedPriceCents', type: 'number', min: 0, admin: { description: 'Price in cents, set by staff (e.g. 4500 = $45.00). Set this, then status → Approved to send the invoice.' } },
```

Replace with:

```ts
    {
      name: 'quotedPriceCents',
      type: 'number',
      min: 0,
      label: 'Quoted price',
      admin: {
        description: 'Price in dollars, set by staff (e.g. 45 for $45.00). Set this, then status → Approved to send the invoice.',
        components: {
          Field: '/admin/PriceField#PriceField',
          Cell: '/admin/PriceCell#PriceCell',
        },
      },
    },
```

- [ ] **Step 3: `Bookings.ts` — replace the `amountCents` field**

Find (line ~24):

```ts
    { name: 'amountCents', type: 'number', required: true },
```

Replace with:

```ts
    {
      name: 'amountCents',
      type: 'number',
      required: true,
      label: 'Amount',
      admin: {
        components: {
          Field: '/admin/PriceField#PriceField',
          Cell: '/admin/PriceCell#PriceCell',
        },
      },
    },
```

- [ ] **Step 4: `Payments.ts` — replace the `amountCents` field**

Find (line ~22):

```ts
    { name: 'amountCents', type: 'number', required: true },
```

Replace with:

```ts
    {
      name: 'amountCents',
      type: 'number',
      required: true,
      label: 'Amount',
      admin: {
        components: {
          Field: '/admin/PriceField#PriceField',
          Cell: '/admin/PriceCell#PriceCell',
        },
      },
    },
```

- [ ] **Step 5: Regenerate the import map**

Run: `pnpm generate:importmap`
Expected: command succeeds and `src/app/(payload)/admin/importMap.js` now imports `PriceField` and `PriceCell` (from `/admin/PriceField` and `/admin/PriceCell`) and adds their `#`-keyed entries to `importMap`.

Verify:
Run: `grep -c "PriceField\|PriceCell" "src/app/(payload)/admin/importMap.js"`
Expected: a non-zero count (both components present).

- [ ] **Step 6: Typecheck + confirm the admin app boots**

Run: `pnpm exec tsc --noEmit`
Expected: no new type errors.

Then confirm the build/runtime wiring resolves (the dev server compiles the admin without import-map errors):
Run: `pnpm exec playwright test tests/e2e/public-pages.e2e.spec.ts -g "home shows hero headline"`
Expected: PASS — this boots the Next app (which loads `payload.config` + the import map); a broken component reference would fail app compilation. (If Square/admin env differs, any failure here must be unrelated to the import map — confirm the error is not about `PriceField`/`PriceCell` resolution.)

- [ ] **Step 7: Commit**

```bash
git add "src/collections/Classes.ts" "src/collections/FiringRequests.ts" "src/collections/Bookings.ts" "src/collections/Payments.ts" "src/app/(payload)/admin/importMap.js"
git commit -m "Use dollar PriceField/PriceCell on all four price fields"
```

---

## Task 5: Manual admin verification

Automated tests can't log into the Payload admin and exercise the custom field UI. Verify by hand.

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server and log in**

Run: `pnpm dev`
Open `http://localhost:3000/admin` and log in.

- [ ] **Step 2: Verify the input on each field**

For a **Class** (edit an existing class), the **Firing requests**, **Bookings**, and **Payments** edit views:
- The price field shows a fixed `$` at the left of the box.
- Typing letters does nothing; only digits and one decimal point (max 2 places) are accepted.
- A stored value displays in dollars (e.g. a class at `22000` cents shows `220.00`); on blur, `45` becomes `45.00`.
- The field label reads "Price"/"Quoted price"/"Amount" (not "… Cents"), and descriptions say dollars.

- [ ] **Step 3: Verify round-trip storage (cents unchanged)**

Edit a Class price to `45`, save, reload — it should show `45.00`. Confirm the stored value is `4500` cents (check the Payments/Bookings list still charges correctly, or inspect via the API/DB). The frontend class page should still show `$45.00`.

- [ ] **Step 4: Verify list columns show dollars**

Open the **Firing requests**, **Bookings**, and **Payments** list views — the price/amount columns render `$X.XX`, not raw cents.

- [ ] **Step 5: Verify the firing invoice flow end-to-end**

On a test firing request, set a quoted price in dollars (e.g. `45`), set status → Approved, save. Confirm it invoices for the correct amount (`$45.00`) and does not hang — i.e. cents (`4500`) flow through unchanged to Square.

---

## Self-Review Notes

- **Spec coverage:** dollar input with fixed `$` + numeric-only → Task 2 (`PriceField`) + Task 1 helpers. Dollar display in admin lists → Task 3 (`PriceCell`) + Task 4 wiring. All four fields → Task 4 Steps 1-4. Cents-as-source-of-truth / no migration → no schema changes anywhere; helpers convert at the UI edge only. Import-map registration → Task 4 Step 5. Reworded labels/descriptions → Task 4. Helper unit tests → Task 1. Manual component verification → Task 5.
- **Type consistency:** `centsToDollars(cents: number): string` and `dollarsToCents(input: string): number | null` are used identically in `PriceField`, `PriceCell` (via `usd`), and the tests. Component refs use the exact same `/admin/PriceField#PriceField` / `/admin/PriceCell#PriceCell` strings in all four field configs.
- **No placeholders:** every code/command/expected-output is concrete.
- **Note on the float edge:** the rounding test deliberately uses `45.999`→`4600` (stable in float); sub-half-cent inputs like `0.005` are intentionally not asserted because binary float makes them ambiguous, and the keystroke filter caps real input at 2 decimals anyway.

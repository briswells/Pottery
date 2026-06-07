/** Formats integer cents as a USD string, e.g. 22000 -> "$220.00". */
export const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`

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

export const CATEGORY_LABELS: Record<string, string> = {
  'wheel-series': 'Wheel-throwing series',
  'day-camp': 'Day camp',
  'raku': 'Raku',
  'daytime-multiweek': 'Daytime multi-week',
}

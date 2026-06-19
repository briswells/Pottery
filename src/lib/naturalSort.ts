/**
 * Build a lexicographically-sortable key that orders names "naturally":
 * embedded digit runs are zero-padded so numbers sort numerically (2 before 10),
 * and because digits sort before letters in ASCII, purely/leading-numeric names
 * come before alphabetic ones. Lowercased so casing doesn't split the order.
 *
 *   "B-12" → "b-0000000012", "2" → "0000000002", "10" → "0000000010"
 *   sort order: 1, 2, 10, 20, A1, B-12
 */
export function naturalSortKey(name: string): string {
  return String(name ?? '')
    .replace(/\d+/g, (digits) => digits.padStart(10, '0'))
    .toLowerCase()
}

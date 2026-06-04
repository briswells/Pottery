/** Formats integer cents as a USD string, e.g. 22000 -> "$220.00". */
export const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`

export const CATEGORY_LABELS: Record<string, string> = {
  'wheel-series': 'Wheel-throwing series',
  'day-camp': 'Day camp',
  'raku': 'Raku',
  'daytime-multiweek': 'Daytime multi-week',
}

/** Formats integer cents as a USD string, e.g. 22000 -> "$220.00". */
export const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`

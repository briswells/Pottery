import { SquareClient, SquareEnvironment } from 'square'

let client: SquareClient | null = null

export function getSquareClient(): SquareClient {
  if (client) return client
  client = new SquareClient({
    token: process.env.SQUARE_ACCESS_TOKEN!,
    environment:
      process.env.SQUARE_ENVIRONMENT === 'production'
        ? SquareEnvironment.Production
        : SquareEnvironment.Sandbox,
  })
  return client
}

export const SQUARE_LOCATION_ID = () => process.env.SQUARE_LOCATION_ID!

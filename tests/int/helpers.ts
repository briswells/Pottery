import { getPayload, type Payload } from 'payload'
import config from '@payload-config'

let cached: Payload | null = null

/** Boots Payload once (against the test DB, configured by vitest.setup.ts). */
export async function getTestPayload(): Promise<Payload> {
  if (cached) return cached
  cached = await getPayload({ config: await config })
  return cached
}

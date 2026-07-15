/**
 * Minimal typed client for the Kit (ConvertKit) v4 API. Kit is the source of
 * truth for the mailing list — nothing here is mirrored locally. Free-plan
 * API-key auth; rate limit is 120 req/rolling minute, far above studio volume.
 */

const KIT_BASE = 'https://api.kit.com/v4'

export class KitError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** True when a Kit API key is configured — the whole feature is off without one. */
export function kitEnabled(): boolean {
  return Boolean(process.env.KIT_API_KEY)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function kitFetch(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${KIT_BASE}${path}`, {
    ...init,
    headers: {
      'X-Kit-Api-Key': process.env.KIT_API_KEY ?? '',
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new KitError(res.status, `Kit API ${res.status} on ${path}: ${text.slice(0, 300)}`)
  }
  if (res.status === 204) return null
  return res.json()
}

export interface KitSubscriber {
  id: number
  email_address: string
  first_name: string | null
  state: string
  created_at: string
}

/** Create (or upsert — Kit dedupes by email) an active subscriber. Single opt-in. */
export async function createKitSubscriber(input: { email: string; firstName?: string }): Promise<KitSubscriber> {
  const data = await kitFetch('/subscribers', {
    method: 'POST',
    body: JSON.stringify({
      email_address: input.email,
      ...(input.firstName ? { first_name: input.firstName } : {}),
    }),
  })
  return data.subscriber
}

export interface KitSubscriberPage {
  subscribers: KitSubscriber[]
  startCursor: string | null
  endCursor: string | null
  hasNextPage: boolean
  hasPrevPage: boolean
  totalCount: number | null
}

export async function listKitSubscribers(
  opts: { after?: string; before?: string; emailSearch?: string } = {},
): Promise<KitSubscriberPage> {
  const params = new URLSearchParams({ include_total_count: 'true' })
  if (opts.after) params.set('after', opts.after)
  if (opts.before) params.set('before', opts.before)
  if (opts.emailSearch) params.set('email_address', opts.emailSearch)
  const data = await kitFetch(`/subscribers?${params}`)
  return {
    subscribers: data.subscribers ?? [],
    startCursor: data.pagination?.start_cursor ?? null,
    endCursor: data.pagination?.end_cursor ?? null,
    hasNextPage: Boolean(data.pagination?.has_next_page),
    hasPrevPage: Boolean(data.pagination?.has_previous_page),
    totalCount: data.pagination?.total_count ?? data.total_count ?? null,
  }
}

/** Active-subscriber total, used for the send-confirm dialog and the sent stamp. */
export async function countKitSubscribers(): Promise<number | null> {
  const page = await listKitSubscribers()
  return page.totalCount
}

export async function unsubscribeKitSubscriber(id: number): Promise<void> {
  await kitFetch(`/subscribers/${id}/unsubscribe`, { method: 'POST' })
}

/** Create a broadcast that Kit sends at `sendAt` (pass "now" to send immediately).
 *  Kit appends its own unsubscribe footer. `public: false` keeps it email-only. */
export async function createKitBroadcast(input: {
  subject: string
  contentHtml: string
  sendAt: Date
}): Promise<{ id: number }> {
  const data = await kitFetch('/broadcasts', {
    method: 'POST',
    body: JSON.stringify({
      subject: input.subject,
      content: input.contentHtml,
      send_at: input.sendAt.toISOString(),
      public: false,
    }),
  })
  return { id: data.broadcast.id }
}

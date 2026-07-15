import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  kitEnabled,
  KitError,
  createKitSubscriber,
  listKitSubscribers,
  unsubscribeKitSubscriber,
  createKitBroadcast,
} from '../../src/lib/kit'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const OLD_KEY = process.env.KIT_API_KEY

describe('kit client', () => {
  beforeEach(() => {
    process.env.KIT_API_KEY = 'kit_test_key'
  })
  afterEach(() => {
    process.env.KIT_API_KEY = OLD_KEY
    vi.unstubAllGlobals()
  })

  it('kitEnabled reflects the env var', () => {
    expect(kitEnabled()).toBe(true)
    delete process.env.KIT_API_KEY
    expect(kitEnabled()).toBe(false)
  })

  it('createKitSubscriber posts email/first_name with the auth header and unwraps subscriber', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ subscriber: { id: 7, email_address: 'jo@example.com', first_name: 'Jo', state: 'active', created_at: 'x' } }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const sub = await createKitSubscriber({ email: 'jo@example.com', firstName: 'Jo' })
    expect(sub.id).toBe(7)
    const [url, init]: any[] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.kit.com/v4/subscribers')
    expect(init.method).toBe('POST')
    expect(init.headers['X-Kit-Api-Key']).toBe('kit_test_key')
    expect(JSON.parse(init.body)).toEqual({ email_address: 'jo@example.com', first_name: 'Jo' })
  })

  it('listKitSubscribers maps cursors, flags, and total count', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        subscribers: [{ id: 1, email_address: 'a@b.co', first_name: null, state: 'active', created_at: 'x' }],
        pagination: { has_previous_page: false, has_next_page: true, start_cursor: 'S', end_cursor: 'E', total_count: 41 },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const page = await listKitSubscribers({ after: 'CUR', emailSearch: 'a@b.co' })
    expect(page.subscribers).toHaveLength(1)
    expect(page).toMatchObject({ startCursor: 'S', endCursor: 'E', hasNextPage: true, hasPrevPage: false, totalCount: 41 })
    const url: string = (fetchMock.mock.calls as any[])[0][0]
    expect(url).toContain('include_total_count=true')
    expect(url).toContain('after=CUR')
    expect(url).toContain(encodeURIComponent('a@b.co'))
  })

  it('unsubscribeKitSubscriber handles a 204 empty response', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(unsubscribeKitSubscriber(9)).resolves.toBeUndefined()
    expect((fetchMock.mock.calls as any[])[0][0]).toBe('https://api.kit.com/v4/subscribers/9/unsubscribe')
  })

  it('createKitBroadcast sends subject/content/send_at/public:false and returns the id', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ broadcast: { id: 55 } }, 201))
    vi.stubGlobal('fetch', fetchMock)
    const when = new Date('2026-07-16T17:00:00.000Z')
    const res = await createKitBroadcast({ subject: 'Hi', contentHtml: '<p>Yo</p>', sendAt: when })
    expect(res).toEqual({ id: 55 })
    const body = JSON.parse((fetchMock.mock.calls as any[])[0][1].body)
    expect(body).toEqual({ subject: 'Hi', content: '<p>Yo</p>', send_at: '2026-07-16T17:00:00.000Z', public: false })
  })

  it('throws KitError with status on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })))
    await expect(createKitSubscriber({ email: 'a@b.co' })).rejects.toMatchObject({ status: 401 })
    await expect(createKitSubscriber({ email: 'a@b.co' })).rejects.toBeInstanceOf(KitError)
  })
})

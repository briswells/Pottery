// The default jsdom test environment's polyfilled Request/FormData hangs
// rather than errors when parsing multipart bodies containing real File
// blobs (see firing-paid.int.spec.ts for the analogous Buffer/instanceof
// issue). Force node for this file, which actually exercises req.formData().
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const createPaidFiringMock = vi.hoisted(() => vi.fn())
vi.mock('../../src/services/firing', () => ({ createPaidFiring: createPaidFiringMock }))

const mediaCreateMock = vi.hoisted(() => vi.fn())
const mediaDeleteMock = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('payload', () => ({
  getPayload: vi.fn(async () => ({ create: mediaCreateMock, delete: mediaDeleteMock })),
}))
vi.mock('@payload-config', () => ({ default: {} }))
// Avoid pulling in real Square/email clients (not exercised — the service is mocked).
vi.mock('../../src/lib/payments', () => ({ chargeCard: vi.fn() }))
vi.mock('../../src/lib/email', () => ({ sendEmail: vi.fn() }))

import { POST } from '../../src/app/api/firings/route'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

function photoFile(name = 'a.png') {
  return new File([png], name, { type: 'image/png' })
}

function baseForm(overrides: Record<string, string> = {}) {
  const form = new FormData()
  form.set('name', 'Jane Doe')
  form.set('email', 'jane@test.local')
  form.set('description', 'a few mugs')
  form.set('halfShelves', '2')
  form.set('stonewareConfirmed', 'true')
  form.set('sourceId', 'cnon:x')
  for (const [k, v] of Object.entries(overrides)) form.set(k, v)
  form.append('photos', photoFile())
  return form
}

function req(form: FormData) {
  return new Request('https://x.test/api/firings', { method: 'POST', body: form })
}

beforeEach(() => {
  createPaidFiringMock.mockReset()
  mediaCreateMock.mockReset()
  mediaDeleteMock.mockClear()
  let nextId = 1
  mediaCreateMock.mockImplementation(async () => ({ id: nextId++ }))
})

describe('POST /api/firings', () => {
  it('happy path: uploads photos, calls the service, and returns the request id', async () => {
    createPaidFiringMock.mockResolvedValueOnce({ id: 99 })
    const res = await POST(req(baseForm()))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toEqual({ ok: true, requestId: 99 })
    expect(mediaCreateMock).toHaveBeenCalledTimes(1)
    expect(createPaidFiringMock).toHaveBeenCalledWith(
      expect.objectContaining({ charge: expect.any(Function), sendEmail: expect.any(Function) }),
      expect.objectContaining({ halfShelves: 2, photoIds: [1], customerName: 'Jane Doe', customerEmail: 'jane@test.local' }),
    )
    expect(mediaDeleteMock).not.toHaveBeenCalled()
  })

  it('rejects missing required fields before touching media', async () => {
    const form = baseForm()
    form.set('name', '')
    const res = await POST(req(form))
    expect(res.status).toBe(400)
    expect(mediaCreateMock).not.toHaveBeenCalled()
    expect(createPaidFiringMock).not.toHaveBeenCalled()
  })

  it('rejects zero photos before touching media', async () => {
    const form = new FormData()
    form.set('name', 'Jane Doe')
    form.set('email', 'jane@test.local')
    form.set('description', 'a few mugs')
    form.set('halfShelves', '2')
    const res = await POST(req(form))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/1 and 5 photos/)
    expect(mediaCreateMock).not.toHaveBeenCalled()
  })

  it('rejects a non-image photo before uploading', async () => {
    const form = baseForm()
    form.append('photos', new File([Buffer.from('x')], 'a.txt', { type: 'text/plain' }))
    const res = await POST(req(form))
    expect(res.status).toBe(400)
    expect(mediaCreateMock).not.toHaveBeenCalled()
  })

  it('on service failure: deletes the just-uploaded media and returns 402 with the message', async () => {
    createPaidFiringMock.mockRejectedValueOnce(new Error('Your card was declined.'))
    const res = await POST(req(baseForm()))
    expect(res.status).toBe(402)
    expect(await res.json()).toEqual({ error: 'Your card was declined.' })
    expect(mediaDeleteMock).toHaveBeenCalledWith(
      expect.objectContaining({ collection: 'media', id: 1 }),
    )
  })

  it('malformed multipart returns 400', async () => {
    const badReq = new Request('https://x.test/api/firings', {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data; boundary=x' },
      body: 'not actually multipart',
    })
    const res = await POST(badReq)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Invalid form submission')
  })
})

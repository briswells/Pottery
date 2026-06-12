import { describe, it, expect, afterAll } from 'vitest'
import { getTestPayload } from './helpers'
import { upsertPersonByEmail } from '../../src/services/people'

describe('upsertPersonByEmail', () => {
  afterAll(async () => {
    const payload = await getTestPayload()
    await payload.delete({ collection: 'people', where: { email: { like: '@upsert.local' } } })
  })

  it('creates a new non-member person (status none, no plan)', async () => {
    const payload = await getTestPayload()
    const p = await upsertPersonByEmail({ payload }, { name: 'New Person', email: 'new@upsert.local', phone: '555' })
    expect(p.status).toBe('none')
    expect(p.plan).toBeFalsy()
    expect(p.phone).toBe('555')
  })

  it('matches case-insensitively and does not create a duplicate', async () => {
    const payload = await getTestPayload()
    const a = await upsertPersonByEmail({ payload }, { name: 'Dup', email: 'dup@upsert.local' })
    const b = await upsertPersonByEmail({ payload }, { name: 'Dup', email: 'DUP@UPSERT.LOCAL' })
    expect(b.id).toBe(a.id)
    const found = await payload.count({ collection: 'people', where: { email: { equals: 'dup@upsert.local' } } })
    expect(found.totalDocs).toBe(1)
  })

  it('enriches missing fields without clobbering existing ones', async () => {
    const payload = await getTestPayload()
    const first = await upsertPersonByEmail({ payload }, { name: 'Enrich', email: 'enrich@upsert.local', phone: '111' })
    const second = await upsertPersonByEmail({ payload }, { name: 'Should Not Win', email: 'enrich@upsert.local', phone: '222', squareCustomerId: 'cus_1' })
    expect(second.id).toBe(first.id)
    expect(second.phone).toBe('111') // existing phone kept
    expect(second.name).toBe('Enrich') // existing name kept
    expect(second.squareCustomerId).toBe('cus_1') // empty field filled
  })
})

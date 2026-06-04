import { describe, it, expect, beforeAll } from 'vitest'
import { getTestPayload } from './helpers'

describe('Users RBAC', () => {
  beforeAll(async () => {
    const payload = await getTestPayload()
    const existing = await payload.find({ collection: 'users', limit: 1, where: { email: { equals: 'admin@test.local' } } })
    if (existing.totalDocs === 0) {
      await payload.create({
        collection: 'users',
        draft: false,
        data: { name: 'Admin', email: 'admin@test.local', password: 'test12345', roles: ['admin'] },
      })
    }
  })

  it('defaults new users to the editor role', async () => {
    const payload = await getTestPayload()
    const user = await payload.create({
      collection: 'users',
      draft: false,
      data: { name: 'Plain', email: `plain-${Date.now()}@test.local`, password: 'test12345' },
    })
    expect(user.roles).toEqual(['editor'])
  })

  it('exposes public bio fields on the user', async () => {
    const payload = await getTestPayload()
    const user = await payload.create({
      collection: 'users',
      draft: false,
      data: {
        name: 'Eric', email: `eric-${Date.now()}@test.local`, password: 'test12345',
        title: 'Studio Manager', bio: 'Potter for 30+ years.', showOnStaffPage: true, order: 1,
      },
    })
    expect(user.title).toBe('Studio Manager')
    expect(user.showOnStaffPage).toBe(true)
  })

  it('rejects updating a user to an empty roles array', async () => {
    const payload = await getTestPayload()
    const user = await payload.create({
      collection: 'users',
      data: { name: 'RoleGuard', email: `roleguard-${Date.now()}@test.local`, password: 'test12345' },
    })
    await expect(
      payload.update({ collection: 'users', id: user.id, data: { roles: [] } }),
    ).rejects.toThrow()
  })
})

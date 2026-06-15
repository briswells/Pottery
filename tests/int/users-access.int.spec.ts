import { describe, it, expect } from 'vitest'
import { getTestPayload } from './helpers'

describe('Users RBAC', () => {
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
    expect(user.bio).toBe('Potter for 30+ years.')
    expect(user.showOnStaffPage).toBe(true)
  })

  it('does not expose users to unauthenticated (overrideAccess:false) reads', async () => {
    const payload = await getTestPayload()
    await expect(payload.find({ collection: 'users', overrideAccess: false })).rejects.toThrow()
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

  it('lets a non-admin (instructor) read and update only their own record', async () => {
    const payload = await getTestPayload()
    const me = await payload.create({
      collection: 'users',
      data: { name: 'InstSelf', email: `instself-${Date.now()}@test.local`, password: 'test12345', roles: ['instructor'] },
    })
    const someoneElse = await payload.create({
      collection: 'users',
      data: { name: 'InstOther', email: `instother-${Date.now()}@test.local`, password: 'test12345', roles: ['instructor'] },
    })

    // Reads are scoped to self — this is what makes /admin/account work for them.
    const visible = await payload.find({ collection: 'users', overrideAccess: false, user: me })
    expect(visible.docs.map((d) => d.id)).toEqual([me.id])

    // Can update their own profile.
    const updated = await payload.update({
      collection: 'users', id: me.id, overrideAccess: false, user: me, data: { bio: 'I throw mugs.' },
    })
    expect(updated.bio).toBe('I throw mugs.')

    // Cannot update anyone else.
    await expect(
      payload.update({ collection: 'users', id: someoneElse.id, overrideAccess: false, user: me, data: { bio: 'nope' } }),
    ).rejects.toThrow()
  })
})

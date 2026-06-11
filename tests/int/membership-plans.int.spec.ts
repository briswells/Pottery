import { describe, it, expect, afterAll } from 'vitest'
import { getTestPayload } from './helpers'

async function makeFreePlan(payload: any) {
  return payload.create({
    collection: 'membership-plans',
    overrideAccess: true,
    data: { name: `Free ${Date.now()}`, kind: 'free' },
  })
}

describe('membership-plans collection + member.plan', () => {
  it('creates a plan and a member assigned to it (Free → no Square)', async () => {
    const payload = await getTestPayload()
    const plan = await makeFreePlan(payload)
    const member = await payload.create({
      collection: 'members',
      overrideAccess: true,
      data: { name: 'Planned', email: `planned-${Date.now()}@test.local`, status: 'active', plan: plan.id },
    })
    expect(member.id).toBeTruthy()
    expect(member.plan).toBeTruthy()
  })

  it('rejects creating a member with no plan', async () => {
    const payload = await getTestPayload()
    await expect(
      payload.create({
        collection: 'members',
        overrideAccess: true,
        data: { name: 'NoPlan', email: `noplan-${Date.now()}@test.local`, status: 'active' },
      }),
    ).rejects.toThrow()
  })
})

afterAll(async () => {
  const payload = await getTestPayload()
  await payload.delete({ collection: 'members', where: { email: { contains: '@test.local' } }, overrideAccess: true })
  await payload.delete({ collection: 'membership-plans', where: { name: { contains: 'Free ' } }, overrideAccess: true })
})

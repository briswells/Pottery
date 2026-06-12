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
      collection: 'people',
      overrideAccess: true,
      data: { name: 'Planned', email: `planned-${Date.now()}@test.local`, status: 'active', plan: plan.id },
    })
    expect(member.id).toBeTruthy()
    expect(member.plan).toBeTruthy()
  })

  it('lets an admin create a non-member person with no plan (status none)', async () => {
    const payload = await getTestPayload()
    const staff = await payload.create({
      collection: 'users',
      data: { name: 'Staff', email: `staff-${Date.now()}@test.local`, password: 'test12345' },
    })
    const person = await payload.create({
      collection: 'people',
      overrideAccess: false,
      user: staff,
      data: { name: 'NoPlan', email: `noplan-${Date.now()}@test.local` },
    })
    expect(person.id).toBeTruthy()
    expect(person.plan).toBeFalsy()
    expect(person.status).toBe('none')
  })

  it('allows programmatic creation without a plan (no logged-in user)', async () => {
    const payload = await getTestPayload()
    const m = await payload.create({
      collection: 'people',
      overrideAccess: true,
      data: { name: 'Prog', email: `prog-${Date.now()}@test.local`, status: 'paused' },
    })
    expect(m.id).toBeTruthy()
  })
})

afterAll(async () => {
  const payload = await getTestPayload()
  await payload.delete({ collection: 'people', where: { email: { contains: '@test.local' } }, overrideAccess: true })
  await payload.delete({ collection: 'membership-plans', where: { name: { contains: 'Free ' } }, overrideAccess: true })
})

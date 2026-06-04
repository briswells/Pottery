import 'dotenv/config'
import { getPayload, Payload } from 'payload'
import config from '../payload.config'

async function upsertGlobal(payload: Payload, slug: string, data: Record<string, unknown>) {
  await payload.updateGlobal({ slug, data } as Parameters<Payload['updateGlobal']>[0])
}

async function ensureUser(payload: Payload, email: string, data: Record<string, unknown>) {
  const found = await payload.find({ collection: 'users', where: { email: { equals: email } }, limit: 1 })
  if (found.totalDocs > 0) return found.docs[0]
  return payload.create({ collection: 'users', data: { email, ...data } } as Parameters<Payload['create']>[0])
}

async function ensureClass(payload: Payload, slug: string, data: Record<string, unknown>) {
  const found = await payload.find({ collection: 'classes', where: { slug: { equals: slug } }, limit: 1 })
  if (found.totalDocs > 0) return found.docs[0]
  return payload.create({ collection: 'classes', data } as Parameters<Payload['create']>[0])
}

async function run() {
  const payload = await getPayload({ config: await config })

  await ensureUser(payload, 'eric@portsidepottery.com', {
    name: 'Eric', password: 'changeme-eric', roles: ['admin'],
    title: 'Studio Manager & Instructor',
    bio: 'Discovered pottery in high school 30+ years ago; inspired by Warren MacKenzie, Guy Wolff, and Phil Rogers.',
    showOnStaffPage: true, order: 1,
  })
  await ensureUser(payload, 'naiomi@portsidepottery.com', {
    name: 'Naiomi', password: 'changeme-naiomi', roles: ['editor'],
    title: 'Studio Technician & Instructor',
    bio: 'Learned pottery in high school; loves how clay brings people of every age and level together.',
    showOnStaffPage: true, order: 2,
  })

  await upsertGlobal(payload, 'site-settings', {
    studioName: 'Portside Pottery',
    phone: '360-838-3246',
    email: 'getcreative@portsidepottery.com',
    addressLine: '2121 St Francis Ln, Vancouver, WA',
    hours: [
      { days: 'Mon–Fri', time: '10am–3:30pm' },
      { days: 'Sat', time: '11am–7pm' },
      { days: 'Sun', time: 'By appointment' },
    ],
    socials: [{ platform: 'Facebook', url: 'https://www.facebook.com/p/Portside-pottery-61578019084110/' }],
  })

  await upsertGlobal(payload, 'home-page', {
    heroKicker: "Vancouver's Community Pottery",
    heroHeadline: 'Where clay meets community',
    heroSubtext: 'Wheel throwing, hand-building, and 24/7 studio access for makers of every level.',
    sections: [
      { heading: 'Our Purpose', body: 'We make pottery accessible to everyone and celebrate the healing joy of clay.' },
      { heading: 'Our Studio', body: 'Professional equipment, multiple firing options, and flexible 24/7 member access.' },
      { heading: 'Our Members', body: 'A diverse, collaborative community of makers learning together.' },
    ],
  })

  await upsertGlobal(payload, 'membership-page', {
    headline: 'Become a member at Portside Pottery',
    intro: 'Where clay meets community.',
    priceLabel: '$200 / month',
    benefits: [
      { item: '24-hour access' }, { item: '18 Shimpo Whisper wheels' }, { item: 'Shimpo slab roller' },
      { item: 'Wall-mounted extruder' }, { item: 'Large shelf' }, { item: '10+ studio glazes' },
      { item: 'Onsite laundry for towels and aprons' }, { item: 'Large raku kiln' }, { item: 'Cone 6 firing' },
    ],
  })

  await ensureClass(payload, '6wk-wheel-throwing-tuesdays', {
    title: '6wk Wheel Throwing (Tuesdays)', slug: '6wk-wheel-throwing-tuesdays', category: 'wheel-series', skillLevel: 'All levels',
    description: 'Six weeks of wheel-throwing fundamentals.', priceCents: 22000, capacity: 8,
    scheduleText: 'Tuesdays 6–8pm for 6 weeks', status: 'active',
  })
  await ensureClass(payload, 'kids-day-camp-pottery-pizza', {
    title: 'Kids Day Camp: Pottery & Pizza', slug: 'kids-day-camp-pottery-pizza', category: 'day-camp', skillLevel: 'Ages 8+',
    description: 'A fun day of clay and pizza for kids.', priceCents: 6500, capacity: 12,
    scheduleText: 'Single day, 10am–2pm', status: 'active',
  })

  console.log('Seed complete.')
  process.exit(0)
}

run().catch((e) => { console.error(e); process.exit(1) })

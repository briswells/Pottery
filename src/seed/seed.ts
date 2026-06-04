import 'dotenv/config'
import path from 'path'
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

async function ensureMedia(payload: Payload, filename: string, alt: string) {
  const found = await payload.find({ collection: 'media', where: { filename: { equals: filename } }, limit: 1 })
  if (found.totalDocs > 0) return found.docs[0]
  return payload.create({
    collection: 'media',
    filePath: path.resolve(process.cwd(), 'src/seed/assets', filename),
    data: { alt },
  } as Parameters<Payload['create']>[0])
}

async function run() {
  const payload = await getPayload({ config: await config })

  // Upload all seed image assets
  const logo = await ensureMedia(payload, 'portside-logo.jpg', 'Portside Pottery logo')
  const banner = await ensureMedia(payload, 'banner.jpg', 'Portside Pottery studio banner')
  const studio1 = await ensureMedia(payload, 'studio-1.jpg', 'Pottery at Portside studio')
  const studio2 = await ensureMedia(payload, 'studio-2.jpg', 'Pottery at Portside studio')
  const studio3 = await ensureMedia(payload, 'studio-3.jpg', 'Pottery at Portside studio')
  const stock1 = await ensureMedia(payload, 'stock-1.jpg', 'Ceramicist shaping clay on a pottery wheel')
  const stock2 = await ensureMedia(payload, 'stock-2.jpg', 'Throwing a cup on the pottery wheel')
  const stock3 = await ensureMedia(payload, 'stock-3.jpg', 'Hands forming clay on a potter\'s wheel')
  const stock4 = await ensureMedia(payload, 'stock-4.jpg', 'Potter shaping a vase from clay')
  const stock5 = await ensureMedia(payload, 'stock-5.jpg', 'Potter\'s hands working clay on a wheel')
  const ericPhoto = await ensureMedia(payload, 'eric.jpg', 'Eric, Studio Manager & Instructor')
  const naiomiPhoto = await ensureMedia(payload, 'naiomi.jpg', 'Naiomi, Studio Technician & Instructor')

  // Users
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

  // Update staff photos (idempotent — ensureUser skips existing users)
  const eric = await payload.find({ collection: 'users', where: { email: { equals: 'eric@portsidepottery.com' } }, limit: 1 })
  if (eric.totalDocs > 0) {
    await payload.update({ collection: 'users', id: eric.docs[0].id, data: { photo: ericPhoto.id } } as Parameters<Payload['update']>[0])
  }
  const naiomi = await payload.find({ collection: 'users', where: { email: { equals: 'naiomi@portsidepottery.com' } }, limit: 1 })
  if (naiomi.totalDocs > 0) {
    await payload.update({ collection: 'users', id: naiomi.docs[0].id, data: { photo: naiomiPhoto.id } } as Parameters<Payload['update']>[0])
  }

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
    logo: logo.id,
  })

  await upsertGlobal(payload, 'home-page', {
    heroKicker: "Vancouver's Community Pottery",
    heroHeadline: 'Where clay meets community',
    heroSubtext: 'Wheel throwing, hand-building, and 24/7 studio access for makers of every level.',
    heroImage: banner.id,
    sections: [
      { heading: 'Our Purpose', body: 'We make pottery accessible to everyone and celebrate the healing joy of clay.', image: studio1.id },
      { heading: 'Our Studio', body: 'Professional equipment, multiple firing options, and flexible 24/7 member access.', image: studio2.id },
      { heading: 'Our Members', body: 'A diverse, collaborative community of makers learning together.', image: studio3.id },
    ],
    gallery: [studio1.id, studio2.id, studio3.id, stock1.id, stock2.id, stock3.id],
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

  // Classes
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

  // Update class images (idempotent — ensureClass skips existing)
  const wheelClass = await payload.find({ collection: 'classes', where: { slug: { equals: '6wk-wheel-throwing-tuesdays' } }, limit: 1 })
  if (wheelClass.totalDocs > 0) {
    await payload.update({ collection: 'classes', id: wheelClass.docs[0].id, data: { image: stock4.id } } as Parameters<Payload['update']>[0])
  }
  const kidsClass = await payload.find({ collection: 'classes', where: { slug: { equals: 'kids-day-camp-pottery-pizza' } }, limit: 1 })
  if (kidsClass.totalDocs > 0) {
    await payload.update({ collection: 'classes', id: kidsClass.docs[0].id, data: { image: stock5.id } } as Parameters<Payload['update']>[0])
  }

  console.log('Seed complete.')
  process.exit(0)
}

run().catch((e) => { console.error(e); process.exit(1) })

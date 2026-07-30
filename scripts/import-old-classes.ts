import { getPayload } from 'payload'
import config from '@payload-config'
import path from 'path'
import { readFileSync } from 'fs'
import { studioMidnightIso, toStudioLocal } from '../src/lib/studio'

/**
 * One-off import of the class catalog scraped from the old GoDaddy site
 * (api.ola.godaddy.com services JSON). Creates/updates Classes, uploads their
 * images as Media, and creates published ClassInstances. Idempotent: classes
 * match by title, media by filename, instances by label + start date.
 *
 * Usage:
 *   SERVICES_JSON=/path/services.json IMAGES_DIR=/path/imgs npx tsx scripts/import-old-classes.ts
 * (plus the usual DATABASE_URL / PAYLOAD_SECRET / S3_* env for the target instance)
 */

type OlaService = {
  id: number
  name: string
  description: string
  image_url: string
  start_time: string
  capacity: number
  duration: string
  cost: string
}
/** ISO-8601 duration like PT2H / PT1H30M -> minutes. */
function durationMinutes(d: string): number {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?$/.exec(d)
  if (!m) throw new Error(`Unsupported duration ${d}`)
  return Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)
}

function addMinutes(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(':').map(Number)
  const total = h * 60 + m + minutes
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

// Class types the 12 scraped services roll up into. `serviceIds` lists which
// scraped occurrences become instances of the type; per-instance overrides below.
const CLASS_TYPES: {
  title: string
  descriptionFrom: number // service id whose description to use verbatim
  image: string // basename in IMAGES_DIR
  priceCents: number
  capacity: number
  numberOfClasses?: number
}[] = [
  { title: '6-Week Wheel Throwing', descriptionFrom: 7393563, image: 'IMG_0829.jpeg', priceCents: 40000, capacity: 6, numberOfClasses: 6 },
  { title: 'Daytime Multi-week Class', descriptionFrom: 7459400, image: 'IMG_0829.jpeg', priceCents: 40000, capacity: 6, numberOfClasses: 6 },
  { title: 'Wheel Teaser!', descriptionFrom: 7537094, image: 'IMG_0829.jpeg', priceCents: 9500, capacity: 6 },
  { title: 'Hand Built pair of Wall Pockets!!', descriptionFrom: 7537074, image: 'WallPockets.jpg', priceCents: 5000, capacity: 8 },
  { title: 'Hand Built Slab Pottery Mug!!', descriptionFrom: 7554803, image: 'Handle-mug.png', priceCents: 5000, capacity: 6 },
  { title: 'Rock Box Workshop!', descriptionFrom: 7562785, image: 'Rock-box.png', priceCents: 5000, capacity: 8 },
]

// serviceId -> which class it belongs to, its label, instructor, and (for
// multi-week runs) the weekly schedule.
const INSTANCES: Record<number, { classTitle: string; label: string; instructorEmail: string; daysOfWeek?: string[] }> = {
  7393563: { classTitle: '6-Week Wheel Throwing', label: '6-Week Wheel Throwing — Tuesdays', instructorEmail: 'naiomi@portsidepottery.com', daysOfWeek: ['TU'] },
  7393571: { classTitle: '6-Week Wheel Throwing', label: '6-Week Wheel Throwing — Wednesdays', instructorEmail: 'getcreative@portsidepottery.com', daysOfWeek: ['WE'] },
  7459400: { classTitle: 'Daytime Multi-week Class', label: 'Daytime Multi-week Class — Tuesdays', instructorEmail: 'andrea@portsidepottery.com', daysOfWeek: ['TU'] },
  7537094: { classTitle: 'Wheel Teaser!', label: 'Wheel Teaser!', instructorEmail: 'getcreative@portsidepottery.com' },
  7554865: { classTitle: 'Wheel Teaser!', label: 'Wheel Teaser!', instructorEmail: 'getcreative@portsidepottery.com' },
  7568408: { classTitle: 'Wheel Teaser!', label: 'Wheel Teaser!', instructorEmail: 'naiomi@portsidepottery.com' },
  7537074: { classTitle: 'Hand Built pair of Wall Pockets!!', label: 'Hand Built pair of Wall Pockets!!', instructorEmail: 'naiomi@portsidepottery.com' },
  7554860: { classTitle: 'Hand Built pair of Wall Pockets!!', label: 'Hand Built pair of Wall Pockets!!', instructorEmail: 'naiomi@portsidepottery.com' },
  7554803: { classTitle: 'Hand Built Slab Pottery Mug!!', label: 'Hand Built Slab Pottery Mug!!', instructorEmail: 'getcreative@portsidepottery.com' },
  7554844: { classTitle: 'Hand Built Slab Pottery Mug!!', label: 'Hand Built Slab Pottery Mug!!', instructorEmail: 'getcreative@portsidepottery.com' },
  7562785: { classTitle: 'Rock Box Workshop!', label: 'Rock Box Workshop! — with Andrea Carrasco', instructorEmail: 'andrea@portsidepottery.com' },
  7568401: { classTitle: 'Rock Box Workshop!', label: 'Rock Box Workshop!', instructorEmail: 'andrea@portsidepottery.com' },
}

async function run() {
  const servicesPath = process.env.SERVICES_JSON
  const imagesDir = process.env.IMAGES_DIR
  if (!servicesPath || !imagesDir) throw new Error('Set SERVICES_JSON and IMAGES_DIR')
  const services: OlaService[] = JSON.parse(readFileSync(servicesPath, 'utf8')).results
  const byId = new Map(services.map((s) => [s.id, s]))

  const payload = await getPayload({ config: await config })

  // Instructors by email
  const userIds = new Map<string, number>()
  for (const email of new Set(Object.values(INSTANCES).map((i) => i.instructorEmail))) {
    const { docs } = await payload.find({ collection: 'users', where: { email: { equals: email } }, limit: 1, overrideAccess: true })
    if (!docs[0]) throw new Error(`No user with email ${email}`)
    userIds.set(email, docs[0].id)
  }

  // Media (upsert by filename stem)
  const mediaIds = new Map<string, number>()
  for (const file of new Set(CLASS_TYPES.map((c) => c.image))) {
    const stem = path.parse(file).name
    const existing = await payload.find({ collection: 'media', where: { filename: { contains: stem } }, limit: 1, overrideAccess: true })
    if (existing.docs[0]) {
      mediaIds.set(file, existing.docs[0].id)
      console.log(`media exists: ${file} -> ${existing.docs[0].id}`)
      continue
    }
    const created = await payload.create({
      collection: 'media',
      data: { alt: `${stem.replace(/[-_]/g, ' ')} — class photo` },
      filePath: path.join(imagesDir, file),
      overrideAccess: true,
    })
    mediaIds.set(file, created.id)
    console.log(`media uploaded: ${file} -> ${created.id}`)
  }

  // Classes (upsert by title)
  const classIds = new Map<string, number>()
  for (const c of CLASS_TYPES) {
    const description = byId.get(c.descriptionFrom)?.description
    if (!description) throw new Error(`Service ${c.descriptionFrom} missing from JSON`)
    const data = {
      title: c.title,
      description,
      image: mediaIds.get(c.image),
      defaultPriceCents: c.priceCents,
      defaultCapacity: c.capacity,
      defaultNumberOfClasses: c.numberOfClasses ?? null,
      status: 'active' as const,
    }
    const { docs } = await payload.find({ collection: 'classes', where: { title: { equals: c.title } }, limit: 1, overrideAccess: true })
    if (docs[0]) {
      await payload.update({ collection: 'classes', id: docs[0].id, data, overrideAccess: true })
      classIds.set(c.title, docs[0].id)
      console.log(`class updated: ${c.title} (${docs[0].id})`)
    } else {
      const created = await payload.create({ collection: 'classes', data, overrideAccess: true })
      classIds.set(c.title, created.id)
      console.log(`class created: ${c.title} (${created.id})`)
    }
  }

  // Instances (skip if same label + startDate already exists)
  let created = 0, skipped = 0
  for (const [idStr, meta] of Object.entries(INSTANCES)) {
    const svc = byId.get(Number(idStr))
    if (!svc) throw new Error(`Service ${idStr} missing from JSON`)
    const { date, time } = toStudioLocal(svc.start_time)
    const startDate = studioMidnightIso(date)
    const existing = await payload.find({
      collection: 'class-instances',
      where: { and: [{ label: { equals: meta.label } }, { startDate: { equals: startDate } }] },
      limit: 1,
      overrideAccess: true,
    })
    if (existing.docs[0]) {
      skipped++
      console.log(`instance exists: ${meta.label} @ ${date}`)
      continue
    }
    await payload.create({
      collection: 'class-instances',
      overrideAccess: true,
      data: {
        class: classIds.get(meta.classTitle)!,
        label: meta.label,
        instructor: userIds.get(meta.instructorEmail)!,
        startDate,
        startTime: time,
        endTime: addMinutes(time, durationMinutes(svc.duration)),
        daysOfWeek: (meta.daysOfWeek ?? null) as never,
        numberOfClasses: meta.daysOfWeek ? 6 : null,
        capacity: svc.capacity,
        priceCents: Math.round(Number(svc.cost) * 100),
        status: 'published',
      },
    })
    created++
    console.log(`instance created: ${meta.label} @ ${date} ${time}`)
  }

  console.log(`Done. ${created} instances created, ${skipped} already existed.`)
  process.exit(0)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})

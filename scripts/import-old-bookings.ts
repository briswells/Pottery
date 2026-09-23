import { getPayload } from 'payload'
import config from '@payload-config'
import { upsertPersonByEmail } from '../src/services/people'

/**
 * One-off import of already-paid attendee rosters from the old GoDaddy booking
 * system into Bookings. Everyone here paid on the OLD site, so bookings are
 * created directly as `paid` (no charge, and Bookings has no hooks, so no
 * emails). Idempotent per (instance, email): creates only the shortfall when
 * someone booked multiple spots.
 */

type Attendee = { name: string; email: string; phone: string; spots: number }
type Roster = { label: string; date: string; amountCents: number; attendees: Attendee[] }

const ROSTERS: Roster[] = [
  {
    label: 'Hand Built Slab Pottery Mug!!', date: '2026-07-18', amountCents: 5000,
    attendees: [{ name: 'Ryan Coffey', email: 'ryanccoffey@aol.com', phone: '3606075996', spots: 1 }],
  },
  {
    label: 'Wheel Teaser!', date: '2026-07-25', amountCents: 9500,
    attendees: [{ name: 'Amber Sherwood', email: 'amberleeansherwood@gmail.com', phone: '3609015789', spots: 2 }],
  },
  {
    label: 'Hand Built Slab Pottery Mug!!', date: '2026-08-08', amountCents: 5000,
    attendees: [
      { name: 'Joey Grafton', email: 'joeygrafton01@gmail.com', phone: '9162251257', spots: 1 },
      { name: 'Madelyn Hubbs', email: 'maddy.hubbs13@gmail.com', phone: '5419721793', spots: 1 },
    ],
  },
]

async function run() {
  const payload = await getPayload({ config: await config })
  let created = 0, existed = 0

  for (const roster of ROSTERS) {
    // Instance dates are stored at studio-local (Pacific) midnight — 07:00Z in PDT.
    const startDate = `${roster.date}T07:00:00.000Z`
    const { docs } = await payload.find({
      collection: 'class-instances',
      where: { and: [{ label: { equals: roster.label } }, { startDate: { equals: startDate } }] },
      limit: 1,
      overrideAccess: true,
    })
    const instance = docs[0]
    if (!instance) throw new Error(`No instance "${roster.label}" @ ${roster.date}`)

    for (const a of roster.attendees) {
      const person = await upsertPersonByEmail({ payload }, { name: a.name, email: a.email, phone: a.phone })
      const current = await payload.count({
        collection: 'bookings',
        where: { and: [{ classInstance: { equals: instance.id } }, { customerEmail: { equals: a.email } }] },
        overrideAccess: true,
      })
      existed += Math.min(current.totalDocs, a.spots)
      for (let i = current.totalDocs; i < a.spots; i++) {
        await payload.create({
          collection: 'bookings',
          overrideAccess: true,
          data: {
            classInstance: instance.id,
            person: person.id,
            customerName: a.name,
            customerEmail: a.email,
            customerPhone: a.phone,
            status: 'paid',
            amountCents: roster.amountCents,
          },
        })
        created++
        console.log(`booked: ${a.name} -> ${roster.label} @ ${roster.date}`)
      }
    }
  }

  console.log(`Done. ${created} bookings created, ${existed} already existed.`)
  process.exit(0)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})

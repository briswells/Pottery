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
    label: 'Wheel Teaser!', date: '2026-07-11', amountCents: 9500,
    attendees: [{ name: 'Madison Stone', email: 'madisonstone28@gmail.com', phone: '3603147565', spots: 2 }],
  },
  {
    label: 'Hand Built pair of Wall Pockets!!', date: '2026-07-11', amountCents: 5000,
    attendees: [
      { name: 'Cindy Jacobs', email: 'cindyjjacobs@gmail.com', phone: '8505569858', spots: 2 },
      { name: 'Wendy Lowles', email: 'wlowles@gmail.com', phone: '512-909-2071', spots: 1 },
    ],
  },
  {
    label: 'Rock Box Workshop! — with Andrea Carrasco', date: '2026-07-13', amountCents: 5000,
    attendees: [
      { name: 'Cindy Jacobs', email: 'cindyjjacobs@gmail.com', phone: '8505569858', spots: 1 },
      { name: 'Elizabeth Larkin', email: 'biz_larkin@msn.com', phone: '8087811178', spots: 1 },
      { name: 'Kelley McCarthy', email: 'klmccarthy604@gmail.com', phone: '3608524835', spots: 1 },
      { name: 'Andie Simmons', email: 'andiemae@comcast.net', phone: '3605678818', spots: 1 },
      { name: 'Elizabeth Hada', email: 'elizabethhada@verizon.net', phone: '3109685077', spots: 1 },
    ],
  },
  {
    label: 'Hand Built pair of Wall Pockets!!', date: '2026-07-25', amountCents: 5000,
    attendees: [{ name: 'Becca McMartin', email: 'furjeans@mac.com', phone: '5035058934', spots: 1 }],
  },
]

async function run() {
  const payload = await getPayload({ config: await config })
  let created = 0, existed = 0

  for (const roster of ROSTERS) {
    const startDate = `${roster.date}T00:00:00.000Z`
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
      existed += Math.min(current.totalDocs, a.spots)
    }
  }

  console.log(`Done. ${created} bookings created, ${existed} already existed.`)
  process.exit(0)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})

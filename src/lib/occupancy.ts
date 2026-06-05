import type { Payload } from 'payload'

/** Raw number of seats held by active (paid or pending) bookings. */
export async function occupiedSeats(payload: Payload, classId: number | string): Promise<number> {
  const { totalDocs } = await payload.count({
    collection: 'bookings',
    where: { and: [{ class: { equals: classId } }, { status: { in: ['paid', 'pending'] } }] },
  })
  return totalDocs
}

export async function seatsRemaining(payload: Payload, classId: number | string): Promise<number> {
  const cls = await payload.findByID({ collection: 'classes', id: classId })
  const occupied = await occupiedSeats(payload, classId)
  return Math.max(0, (cls.capacity ?? 0) - occupied)
}

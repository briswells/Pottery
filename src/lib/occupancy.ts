import type { Payload } from 'payload'

export async function seatsRemaining(payload: Payload, classId: number | string): Promise<number> {
  const cls = await payload.findByID({ collection: 'classes', id: classId })
  const occupied = await payload.count({
    collection: 'bookings',
    where: { and: [{ class: { equals: classId } }, { status: { in: ['paid', 'pending'] } }] },
  })
  return Math.max(0, (cls.capacity ?? 0) - occupied.totalDocs)
}

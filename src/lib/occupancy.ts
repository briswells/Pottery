import type { Payload } from 'payload'

/** Raw number of seats held by active (paid or pending) bookings on an instance. */
export async function occupiedSeats(payload: Payload, classInstanceId: number | string): Promise<number> {
  const { totalDocs } = await payload.count({
    collection: 'bookings',
    where: { and: [{ classInstance: { equals: classInstanceId } }, { status: { in: ['paid', 'pending'] } }] },
  })
  return totalDocs
}

export async function seatsRemaining(payload: Payload, classInstanceId: number | string): Promise<number> {
  const inst = await payload.findByID({ collection: 'class-instances', id: classInstanceId })
  const occupied = await occupiedSeats(payload, classInstanceId)
  return Math.max(0, (inst.capacity ?? 0) - occupied)
}

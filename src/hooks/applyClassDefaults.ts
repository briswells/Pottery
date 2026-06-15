import type { CollectionBeforeValidateHook } from 'payload'
import { computeEndDate } from '../lib/schedule'

/**
 * Fills a class-instance's priceCents / capacity from its parent class when left
 * blank, derives endDate from a session count when given (so admins set an end date
 * OR a number of classes, not both), and maintains a human-readable `label` (class
 * title + start date) for the admin list and relationship dropdowns.
 */
export const applyClassDefaults: CollectionBeforeValidateHook = async ({ data, req }) => {
  if (!data) return data

  // Number of classes wins: fill in the end date from start date + meeting days.
  if (data.numberOfClasses != null && data.startDate) {
    const computed = computeEndDate(
      data.startDate as string,
      data.daysOfWeek as string[] | null,
      Number(data.numberOfClasses),
      data.skipDates as { date: string }[] | null,
    )
    if (computed) data.endDate = computed
  }

  const classId = typeof data.class === 'object' && data.class ? data.class.id : data.class
  if (!classId) return data
  const cls = await req.payload.findByID({ collection: 'classes', id: classId, depth: 0 })
  if (data.priceCents == null) data.priceCents = cls.defaultPriceCents
  if (data.capacity == null) data.capacity = cls.defaultCapacity
  const dateLabel = data.startDate
    ? new Date(data.startDate).toISOString().slice(0, 10)
    : 'unscheduled'
  data.label = `${cls.title} — ${dateLabel}`
  return data
}

import type { CollectionBeforeValidateHook } from 'payload'
import { computeEndDate } from '../lib/schedule'

/**
 * Fills a class-instance's priceCents / capacity / numberOfClasses from its parent
 * class when left blank, derives endDate from the (possibly inherited) session count
 * so admins set an end date OR a number of classes, and defaults the `label` (used as
 * the instance title) to the class title + start date when the admin leaves it blank.
 */
export const applyClassDefaults: CollectionBeforeValidateHook = async ({ data, req }) => {
  if (!data) return data

  const classId = typeof data.class === 'object' && data.class ? data.class.id : data.class
  if (!classId) return data
  const cls = await req.payload.findByID({ collection: 'classes', id: classId, depth: 0 })
  if (data.priceCents == null) data.priceCents = cls.defaultPriceCents
  if (data.capacity == null) data.capacity = cls.defaultCapacity
  if (data.numberOfClasses == null) data.numberOfClasses = cls.defaultNumberOfClasses

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

  // Default the title, but keep an admin-provided one (e.g. "… — Tuesday Nights").
  if (!data.label) {
    const dateLabel = data.startDate
      ? new Date(data.startDate).toISOString().slice(0, 10)
      : 'unscheduled'
    data.label = `${cls.title} — ${dateLabel}`
  }
  return data
}

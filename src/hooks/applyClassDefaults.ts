import type { CollectionBeforeValidateHook } from 'payload'

/**
 * Fills a class-instance's priceCents / capacity from its parent class when left
 * blank, and maintains a human-readable `label` (class title + start date) for the
 * admin list and relationship dropdowns.
 */
export const applyClassDefaults: CollectionBeforeValidateHook = async ({ data, req }) => {
  if (!data) return data
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

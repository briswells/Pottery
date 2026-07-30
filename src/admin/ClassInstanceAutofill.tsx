'use client'
import { useEffect, useRef } from 'react'
import { useField } from '@payloadcms/ui'

type ClassValue = string | number | { id: string | number } | null | undefined

/**
 * Invisible side-effect field: when a class is selected, prefill the instance's
 * title and number of classes from that class template. Both stay fully editable
 * afterward — an admin-edited value is never clobbered, but switching to a
 * different class re-applies that class's defaults.
 */
export const ClassInstanceAutofill: React.FC = () => {
  const { value: classValue } = useField<ClassValue>({ path: 'class' })
  const { value: title, setValue: setTitle } = useField<string | null | undefined>({ path: 'label' })
  const { value: count, setValue: setCount } = useField<number | null | undefined>({ path: 'numberOfClasses' })
  const { value: price, setValue: setPrice } = useField<number | null | undefined>({ path: 'priceCents' })
  const { value: capacity, setValue: setCapacity } = useField<number | null | undefined>({ path: 'capacity' })

  const appliedFor = useRef<string | number | null>(null)
  const lastAutoTitle = useRef<string | null>(null)
  const lastAutoCount = useRef<number | null>(null)
  const lastAutoPrice = useRef<number | null>(null)
  const lastAutoCapacity = useRef<number | null>(null)

  const classId = classValue && typeof classValue === 'object' ? classValue.id : classValue

  useEffect(() => {
    if (classId == null || appliedFor.current === classId) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/classes/${classId}?depth=0`, { credentials: 'include' })
        if (!res.ok || cancelled) return
        const cls = await res.json()
        if (cancelled) return
        appliedFor.current = classId
        // Only auto-fill an empty field or one still holding our last auto value,
        // so a title/count the admin typed is preserved.
        if (cls.title && (!title || title === lastAutoTitle.current)) {
          setTitle(cls.title)
          lastAutoTitle.current = cls.title
        }
        if (cls.defaultNumberOfClasses != null && (count == null || count === lastAutoCount.current)) {
          setCount(cls.defaultNumberOfClasses)
          lastAutoCount.current = cls.defaultNumberOfClasses
        }
        // Price and capacity were previously filled invisibly by the server on
        // save; showing them here lets admins see (and override) what a class
        // will cost and hold before publishing.
        if (cls.defaultPriceCents != null && (price == null || price === lastAutoPrice.current)) {
          setPrice(cls.defaultPriceCents)
          lastAutoPrice.current = cls.defaultPriceCents
        }
        if (cls.defaultCapacity != null && (capacity == null || capacity === lastAutoCapacity.current)) {
          setCapacity(cls.defaultCapacity)
          lastAutoCapacity.current = cls.defaultCapacity
        }
      } catch {
        /* leave fields as-is on any fetch error */
      }
    })()
    return () => {
      cancelled = true
    }
    // Re-run only when the selected class changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId])

  return null
}

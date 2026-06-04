import type { FieldHook } from 'payload'

export const toSlug = (s: string) =>
  s.toLowerCase().trim()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

const fallbackSlug = () => `class-${Date.now().toString(36)}`

/** Fills `slug` from `title` when slug is empty; never yields an empty slug. */
export const slugifyFromTitle: FieldHook = ({ value, data }) => {
  const source = value ? String(value) : data?.title ? String(data.title) : ''
  if (!source) return value
  const slug = toSlug(source)
  return slug || fallbackSlug()
}

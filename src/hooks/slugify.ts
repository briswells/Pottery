import type { FieldHook } from 'payload'

const toSlug = (s: string) =>
  s.toLowerCase().trim()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

/** Fills `slug` from `title` when slug is empty. */
export const slugifyFromTitle: FieldHook = ({ value, data }) => {
  if (value) return toSlug(String(value))
  if (data?.title) return toSlug(String(data.title))
  return value
}

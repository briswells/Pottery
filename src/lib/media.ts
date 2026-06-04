import type { Media } from '../payload-types'

type MediaRef = number | Media | null | undefined

/** Returns a usable image URL from a Payload upload field (optionally a sized variant), or null. */
export function mediaUrl(ref: MediaRef, size?: 'card' | 'hero'): string | null {
  if (!ref || typeof ref !== 'object') return null
  if (size && ref.sizes?.[size]?.url) return ref.sizes[size]!.url ?? null
  return ref.url ?? null
}

/** Returns the alt text from a Payload upload field, or empty string. */
export function mediaAlt(ref: MediaRef): string {
  return ref && typeof ref === 'object' ? (ref.alt ?? '') : ''
}

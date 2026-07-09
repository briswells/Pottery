import type { Payload } from 'payload'

export function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export interface StudioInfo {
  studioName: string
  /** Escaped address, or null when Site Settings has none. */
  addressHtml: string | null
  /** `<ul>` of escaped opening hours, or '' when Site Settings has none. */
  hoursHtml: string
}

/**
 * Studio name/address/hours for transactional emails, read live from Site
 * Settings so staff edits flow through without a deploy. Never throws — on any
 * failure it degrades to the studio name with no address/hours.
 */
export async function getStudioInfo(payload: Payload): Promise<StudioInfo> {
  try {
    const settings = await payload.findGlobal({ slug: 'site-settings' })
    const hours = (settings.hours ?? []).filter((h) => h.days || h.time)
    return {
      studioName: settings.studioName ?? 'Portside Pottery',
      addressHtml: settings.addressLine ? escapeHtml(settings.addressLine) : null,
      hoursHtml:
        hours.length > 0
          ? `<ul>${hours.map((h) => `<li>${escapeHtml([h.days, h.time].filter(Boolean).join(': '))}</li>`).join('')}</ul>`
          : '',
    }
  } catch {
    return { studioName: 'Portside Pottery', addressHtml: null, hoursHtml: '' }
  }
}

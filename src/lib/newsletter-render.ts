import { convertLexicalToHTML } from '@payloadcms/richtext-lexical/html'
import type { SerializedEditorState } from '@payloadcms/richtext-lexical/lexical'

export interface NewsletterRenderInput {
  body: SerializedEditorState
  /** Site origin used to absolutize relative media/link URLs, e.g. https://portsidepottery.com */
  baseUrl: string
  studioName: string
  logoUrl?: string | null
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/**
 * Rewrite site-relative URLs emitted by the Lexical → HTML converter (media
 * uploads, internal links) into absolute URLs, since email clients don't
 * resolve relative URLs against any page origin.
 *
 * Handles two shapes:
 *  - `src="/..."` and `href="/..."` attribute values.
 *  - `srcset="/a.jpg 500w, /b.jpg 1200w"` — Payload's lexical upload
 *    converter emits `<picture><source srcset="...">` when the referenced
 *    upload's collection has image sizes configured (this project's Media
 *    collection does), so srcset needs its own rewriting or those images
 *    break in clients that honor it (e.g. Apple/iOS Mail).
 *
 * Protocol-relative URLs (`//host/path`) and already-absolute URLs are left
 * untouched — only a single leading `/` counts as site-relative.
 *
 * This runs on trusted converter output, not arbitrary HTML, so plain
 * regexes are fine here; no need for a full HTML parser.
 */
export function absolutizeEmailUrls(html: string, origin: string): string {
  const base = origin.replace(/\/+$/, '')

  // src="/..." and href="/..." — negative lookahead excludes "//..." (protocol-relative).
  let out = html.replace(/\b(src|href)="\/(?!\/)/g, `$1="${base}/`)

  // srcset="/a.jpg 500w, /b.jpg 1200w, https://already/abs.jpg 2x" — rewrite
  // only the comma-separated entries that are site-relative; leave the rest.
  out = out.replace(/\bsrcset="([^"]*)"/g, (_match, value: string) => {
    const rewritten = value
      .split(',')
      .map((entry) => {
        const trimmed = entry.trim()
        if (!trimmed) return trimmed
        const spaceIdx = trimmed.indexOf(' ')
        const url = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)
        const descriptor = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx)
        return url.startsWith('/') && !url.startsWith('//') ? `${base}${url}${descriptor}` : trimmed
      })
      .join(', ')
    return `srcset="${rewritten}"`
  })

  return out
}

/**
 * Render a newsletter body (Lexical state, uploads populated via depth) to a
 * complete email HTML document: converted rich text inside one fixed
 * Portside-branded, table-based shell. Email clients don't load external CSS,
 * so everything is inline; Kit appends its own unsubscribe footer on send.
 */
export function renderNewsletterHtml({ body, baseUrl, studioName, logoUrl }: NewsletterRenderInput): string {
  const origin = baseUrl.replace(/\/+$/, '')
  let content = convertLexicalToHTML({ data: body })
  // Media uploads and internal links come out site-relative; email needs absolute.
  content = absolutizeEmailUrls(content, origin)

  const logo = logoUrl ? (logoUrl.startsWith('/') ? `${origin}${logoUrl}` : logoUrl) : null
  const name = escapeHtml(studioName)

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f5f1ec;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f1ec;">
      <tr><td align="center" style="padding:24px 12px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#ffffff;border-radius:8px;">
          <tr><td align="center" style="padding:28px 32px 12px;">
            ${logo ? `<img src="${logo}" alt="${name}" height="56" style="height:56px;border:0;">` : `<div style="font-size:22px;font-weight:700;color:#3b2f2a;font-family:Georgia,'Times New Roman',serif;">${name}</div>`}
          </td></tr>
          <tr><td style="padding:8px 32px 32px;font-family:Georgia,'Times New Roman',serif;font-size:16px;line-height:1.6;color:#33302c;">
            ${content}
          </td></tr>
          <tr><td align="center" style="padding:16px 32px 28px;border-top:1px solid #eee7de;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#8a8378;">
            ${name} · <a href="${origin}" style="color:#8a8378;">${escapeHtml(origin.replace(/^https?:\/\//, ''))}</a>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`
}

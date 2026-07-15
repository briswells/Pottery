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
 * Render a newsletter body (Lexical state, uploads populated via depth) to a
 * complete email HTML document: converted rich text inside one fixed
 * Portside-branded, table-based shell. Email clients don't load external CSS,
 * so everything is inline; Kit appends its own unsubscribe footer on send.
 */
export function renderNewsletterHtml({ body, baseUrl, studioName, logoUrl }: NewsletterRenderInput): string {
  const origin = baseUrl.replace(/\/+$/, '')
  let content = convertLexicalToHTML({ data: body })
  // Media uploads and internal links come out site-relative; email needs absolute.
  content = content.replaceAll('src="/', `src="${origin}/`).replaceAll('href="/', `href="${origin}/`)

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

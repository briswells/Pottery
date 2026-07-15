import { describe, it, expect } from 'vitest'
import { renderNewsletterHtml } from '../../src/lib/newsletter-render'
import type { SerializedEditorState } from '@payloadcms/richtext-lexical/lexical'

function text(t: string) {
  return { type: 'text', text: t, version: 1, detail: 0, format: 0, mode: 'normal', style: '' }
}

const BODY = {
  root: {
    type: 'root',
    format: '',
    indent: 0,
    version: 1,
    direction: 'ltr',
    children: [
      { type: 'heading', tag: 'h2', version: 1, format: '', indent: 0, direction: 'ltr', children: [text('Kiln news')] },
      { type: 'paragraph', version: 1, format: '', indent: 0, direction: 'ltr', textFormat: 0, children: [text('The cone 10 firing is Friday.')] },
    ],
  },
} as unknown as SerializedEditorState

describe('renderNewsletterHtml', () => {
  it('renders the body inside the branded shell', () => {
    const html = renderNewsletterHtml({ body: BODY, baseUrl: 'https://example.com', studioName: 'Portside Pottery' })
    expect(html).toContain('Kiln news')
    expect(html).toContain('The cone 10 firing is Friday.')
    expect(html).toContain('Portside Pottery')
    expect(html).toContain('<!doctype html>')
  })

  it('rewrites relative src/href to absolute site URLs', () => {
    const html = renderNewsletterHtml({ body: BODY, baseUrl: 'https://example.com/', studioName: 'P' })
    // The shell footer links home with an absolute URL and no double slash.
    expect(html).toContain('href="https://example.com"')
    expect(html).not.toContain('https://example.com//')
  })

  it('uses the logo when given (absolutized) and falls back to the studio name', () => {
    const withLogo = renderNewsletterHtml({ body: BODY, baseUrl: 'https://example.com', studioName: 'P', logoUrl: '/api/media/file/logo.png' })
    expect(withLogo).toContain('src="https://example.com/api/media/file/logo.png"')
    const noLogo = renderNewsletterHtml({ body: BODY, baseUrl: 'https://example.com', studioName: 'Portside Pottery' })
    expect(noLogo).toMatch(/Portside Pottery<\/div>/)
  })

  it('escapes the studio name', () => {
    const html = renderNewsletterHtml({ body: BODY, baseUrl: 'https://example.com', studioName: '<script>x</script>' })
    expect(html).not.toContain('<script>x</script>')
  })
})

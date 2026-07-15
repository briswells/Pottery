import { describe, it, expect } from 'vitest'
import { renderNewsletterHtml, absolutizeEmailUrls } from '../../src/lib/newsletter-render'
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

  it('absolutizes the shell footer link with no double slash', () => {
    // This only pins the shell's own home link, not lexical content rewriting
    // (single-slash vs. protocol-relative and srcset handling are covered
    // directly by the absolutizeEmailUrls unit tests below).
    const html = renderNewsletterHtml({ body: BODY, baseUrl: 'https://example.com/', studioName: 'P' })
    expect(html).toContain('href="https://example.com"')
    expect(html).not.toContain('https://example.com//')
  })

  it('contains no unsubscribe footer of its own (Kit appends its own on send)', () => {
    const html = renderNewsletterHtml({ body: BODY, baseUrl: 'https://example.com', studioName: 'Portside Pottery' })
    expect(html.toLowerCase()).not.toContain('unsubscribe')
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

describe('absolutizeEmailUrls', () => {
  const origin = 'https://example.com'

  it('rewrites a plain src attribute', () => {
    const html = absolutizeEmailUrls('<img src="/api/media/file/photo.jpg">', origin)
    expect(html).toBe('<img src="https://example.com/api/media/file/photo.jpg">')
  })

  it('rewrites a plain href attribute', () => {
    const html = absolutizeEmailUrls('<a href="/classes/wheel-throwing">link</a>', origin)
    expect(html).toBe('<a href="https://example.com/classes/wheel-throwing">link</a>')
  })

  it('rewrites every relative entry inside a srcset attribute, preserving descriptors', () => {
    const html = absolutizeEmailUrls(
      '<source srcset="/api/media/file/photo-500.jpg 500w, /api/media/file/photo-1200.jpg 1200w">',
      origin,
    )
    expect(html).toBe(
      '<source srcset="https://example.com/api/media/file/photo-500.jpg 500w, https://example.com/api/media/file/photo-1200.jpg 1200w">',
    )
  })

  it('leaves protocol-relative URLs untouched', () => {
    const html = absolutizeEmailUrls('<a href="//cdn.example.com/x.jpg">link</a>', origin)
    expect(html).toBe('<a href="//cdn.example.com/x.jpg">link</a>')
  })

  it('leaves already-absolute URLs (including in srcset) untouched', () => {
    const src = absolutizeEmailUrls('<img src="https://cdn.example.com/photo.jpg">', origin)
    expect(src).toBe('<img src="https://cdn.example.com/photo.jpg">')

    const srcset = absolutizeEmailUrls(
      '<source srcset="https://cdn.example.com/photo-500.jpg 500w, https://cdn.example.com/photo-1200.jpg 1200w">',
      origin,
    )
    expect(srcset).toBe(
      '<source srcset="https://cdn.example.com/photo-500.jpg 500w, https://cdn.example.com/photo-1200.jpg 1200w">',
    )
  })
})

import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { PRIVATE_ROBOTS } from './site'
import { usePageMetadata } from './usePageMetadata'

function MetadataProbe(props: Parameters<typeof usePageMetadata>[0]) {
  usePageMetadata(props)
  return null
}

describe('usePageMetadata', () => {
  beforeEach(() => {
    document.head.innerHTML = ''
    document.title = ''
    window.history.replaceState({}, '', '/')
  })

  afterEach(() => {
    document.head.innerHTML = ''
    document.title = ''
    window.history.replaceState({}, '', '/')
  })

  it('applies title, robots, canonical, social tags, and structured data', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <MetadataProbe
          title="Open Source Encrypted File Transfer in the Browser | Xdrop"
          description="SEO test description"
          structuredData={{
            '@context': 'https://schema.org',
            '@type': 'WebSite',
            name: 'Xdrop',
          }}
        />
      </MemoryRouter>,
    )

    expect(document.title).toBe('Open Source Encrypted File Transfer in the Browser | Xdrop')
    expect(readMetaByName('description')).toBe('SEO test description')
    expect(readMetaByName('robots')).toContain('index, follow')
    expect(readMetaByProperty('og:title')).toBe(
      'Open Source Encrypted File Transfer in the Browser | Xdrop',
    )
    expect(readMetaByProperty('og:url')).toBe(new URL('/', window.location.origin).toString())
    expect(readCanonical()).toBe(new URL('/', window.location.origin).toString())
    expect(document.getElementById('xdrop-structured-data')?.textContent).toContain(
      '"@type":"WebSite"',
    )
  })

  it('supports noindex metadata without structured data or URL tags', () => {
    render(
      <MemoryRouter initialEntries={['/t/abc123']}>
        <MetadataProbe
          title="Download and Decrypt in the Browser | Xdrop"
          robots={PRIVATE_ROBOTS}
          exposeUrl={false}
        />
      </MemoryRouter>,
    )

    expect(readMetaByName('robots')).toBe(PRIVATE_ROBOTS)
    expect(readMetaByProperty('og:url')).toBeUndefined()
    expect(readCanonical()).toBeUndefined()
    expect(document.getElementById('xdrop-structured-data')).toBeNull()
  })

  it('reuses existing tags, applies defaults, and removes stale structured data', () => {
    document.head.innerHTML = [
      '<meta name="description" content="old description">',
      '<meta property="og:title" content="old title">',
      '<link rel="canonical" href="https://old.example.com/">',
      '<script id="xdrop-structured-data" type="application/ld+json">{"old":true}</script>',
    ].join('')

    const { rerender } = render(
      <MemoryRouter initialEntries={['/share/t1']}>
        <MetadataProbe
          title="Share the Full Link | Xdrop"
          path="/custom/share"
          structuredData={{ '@type': 'Thing', name: 'Xdrop share' }}
        />
      </MemoryRouter>,
    )

    expect(document.head.querySelectorAll('meta[name="description"]')).toHaveLength(1)
    expect(document.head.querySelectorAll('link[rel="canonical"]')).toHaveLength(1)
    expect(readMetaByName('description')).toContain(
      'Xdrop is an open source file transfer app that encrypts files in your browser',
    )
    expect(readMetaByName('robots')).toContain('index, follow')
    expect(readMetaByProperty('og:type')).toBe('website')
    expect(readMetaByProperty('og:url')).toBe(
      new URL('/custom/share', window.location.origin).toString(),
    )
    expect(document.getElementById('xdrop-structured-data')?.textContent).toContain('Xdrop share')

    rerender(
      <MemoryRouter initialEntries={['/share/t1']}>
        <MetadataProbe title="Share the Full Link | Xdrop" exposeUrl={false} />
      </MemoryRouter>,
    )

    expect(readMetaByProperty('og:url')).toBeUndefined()
    expect(readCanonical()).toBeUndefined()
    expect(document.getElementById('xdrop-structured-data')).toBeNull()
  })
})

function readMetaByName(name: string) {
  return document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content
}

function readMetaByProperty(property: string) {
  return document.head.querySelector<HTMLMetaElement>(`meta[property="${property}"]`)?.content
}

function readCanonical() {
  return document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href
}

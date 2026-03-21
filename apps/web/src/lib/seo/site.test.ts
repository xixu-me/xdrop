import { afterEach, describe, expect, it, vi } from 'vitest'

import { getConfiguredSiteUrl, getHomeStructuredData, getSiteOrigin, toAbsoluteUrl } from './site'

describe('site helpers', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('uses the configured site URL when present', () => {
    vi.stubEnv('VITE_SITE_URL', 'https://xdrop.example.com///')

    expect(getConfiguredSiteUrl()).toBe('https://xdrop.example.com')
    expect(getSiteOrigin()).toBe('https://xdrop.example.com')
    expect(toAbsoluteUrl('/docs')).toBe('https://xdrop.example.com/docs')
  })

  it('builds homepage structured data with canonical image and logo URLs', () => {
    vi.stubEnv('VITE_SITE_URL', 'https://xdrop.example.com///')

    expect(getHomeStructuredData()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          '@type': 'WebSite',
          image: 'https://xdrop.example.com/brand-lockup-horizontal.png',
        }),
        expect.objectContaining({
          '@type': 'Organization',
          logo: expect.objectContaining({
            url: 'https://xdrop.example.com/brand-symbol-512.png',
          }),
        }),
      ]),
    )
  })

  it('returns the raw path when no site origin is available', () => {
    const originalWindow = globalThis.window
    vi.stubEnv('VITE_SITE_URL', '')

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: undefined,
    })

    expect(toAbsoluteUrl('/docs')).toBe('/docs')

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    })
  })
})

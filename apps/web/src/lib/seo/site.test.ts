import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  HISTORY_PAGE_DESCRIPTION,
  HISTORY_PAGE_TITLE,
  NOT_FOUND_PAGE_DESCRIPTION,
  RECEIVE_PAGE_DESCRIPTION,
  RECEIVE_PAGE_TITLE,
  SHARE_PAGE_DESCRIPTION,
  SHARE_PAGE_TITLE,
  getConfiguredSiteUrl,
  getHomeStructuredData,
  getSiteOrigin,
  toAbsoluteUrl,
} from './site'

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

  it('keeps page-level seo copy aligned with the messaging guide', () => {
    expect(HISTORY_PAGE_TITLE).toBe('Manage End-to-End Encrypted Transfers on This Device | Xdrop')
    expect(HISTORY_PAGE_DESCRIPTION).toBe(
      'Manage Xdrop end-to-end encrypted file transfers stored in this browser on this device. Plaintext file names, contents, and keys stay off the server.',
    )
    expect(SHARE_PAGE_TITLE).toBe('Share an End-to-End Encrypted Transfer | Xdrop')
    expect(SHARE_PAGE_DESCRIPTION).toBe(
      'Share an Xdrop end-to-end encrypted file transfer from this browser on this device while keeping plaintext file names, contents, and keys off the server.',
    )
    expect(RECEIVE_PAGE_TITLE).toBe('Receive an End-to-End Encrypted Transfer | Xdrop')
    expect(RECEIVE_PAGE_DESCRIPTION).toBe(
      'Receive an Xdrop end-to-end encrypted file transfer and decrypt it locally in the browser, keeping plaintext file names, contents, and keys off the server.',
    )
    expect(NOT_FOUND_PAGE_DESCRIPTION).toBe(
      'This page was not found in Xdrop. If this came from an end-to-end encrypted transfer link, ask the sender to resend the complete share details.',
    )
  })
})

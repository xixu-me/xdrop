/**
 * Central SEO defaults and URL helpers for the browser app.
 */

export const SITE_NAME = 'Xdrop'
export const PROJECT_ONE_LINER =
  'Xdrop is an open source encrypted file transfer app for browsers and agent-driven terminal workflows, keeping plaintext file names, contents, and keys off the server.'
export const SHORT_POSITIONING_SUMMARY =
  'Browser-first encrypted file transfer, with agent-ready terminal workflows.'
export const TERMINAL_SUPPORT_BLURB =
  'Use Xdrop in the browser for normal sharing, or through an agent when you need to move files out of a cloud server, remote container, or automated terminal workflow.'
export const DEFAULT_SEO_TITLE =
  'Open Source Encrypted File Transfer for Browsers and Agents | Xdrop'
export const DEFAULT_SEO_DESCRIPTION = PROJECT_ONE_LINER
export const HISTORY_PAGE_TITLE = 'Manage Transfers on This Device | Xdrop'
export const HISTORY_PAGE_DESCRIPTION =
  'Manage encrypted transfers stored in this browser on this device. There is no account or cross-device history.'
export const SHARE_PAGE_TITLE = 'Share This Transfer | Xdrop'
export const SHARE_PAGE_DESCRIPTION =
  'Review upload status and share a transfer staged in this browser on this device without exposing its address on the page.'
export const RECEIVE_PAGE_TITLE = 'Download and Decrypt in the Browser | Xdrop'
export const RECEIVE_PAGE_DESCRIPTION =
  'Download files from this transfer and decrypt them in the browser. The decryption key stays in the browser and never reaches the server.'
export const NOT_FOUND_PAGE_TITLE = 'Page Not Found | Xdrop'
export const NOT_FOUND_PAGE_DESCRIPTION =
  'The address does not map to a page in Xdrop. If this came from a shared transfer, ask the sender to resend the complete share details.'
export const DEFAULT_OG_IMAGE_PATH = '/brand-lockup-horizontal.png'
export const DEFAULT_OG_IMAGE_ALT = 'Xdrop horizontal brand lockup'
export const DEFAULT_LOGO_PATH = '/brand-symbol-512.png'
export const REPOSITORY_URL = 'https://github.com/xixu-me/xdrop'
export const AUTHOR_NAME = 'Xi Xu'
export const AUTHOR_URL = 'https://xi-xu.me'
export const LICENSE_URL = `${REPOSITORY_URL}/blob/main/LICENSE`
export const DEFAULT_ROBOTS =
  'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1'
export const PRIVATE_ROBOTS = 'noindex, nofollow, noarchive, nosnippet'

/** getConfiguredSiteUrl returns the canonical origin configured at build time, if any. */
export function getConfiguredSiteUrl() {
  const configuredSiteUrl = import.meta.env.VITE_SITE_URL?.trim() ?? ''
  return configuredSiteUrl.replace(/\/+$/u, '')
}

/** getSiteOrigin prefers the configured site URL and falls back to the current browser origin. */
export function getSiteOrigin() {
  return getConfiguredSiteUrl() || (typeof window !== 'undefined' ? window.location.origin : '')
}

/** toAbsoluteUrl resolves a route or asset path against the canonical site origin. */
export function toAbsoluteUrl(path: string) {
  const origin = getSiteOrigin()
  if (!origin) {
    return path
  }

  return new URL(path, `${origin}/`).toString()
}

/** getHomeStructuredData returns the homepage JSON-LD used for both crawlability and brand recognition. */
export function getHomeStructuredData() {
  const homeUrl = toAbsoluteUrl('/')
  const organizationId = `${homeUrl}#organization`
  const logoUrl = toAbsoluteUrl(DEFAULT_LOGO_PATH)
  const imageUrl = toAbsoluteUrl(DEFAULT_OG_IMAGE_PATH)

  return [
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: SITE_NAME,
      url: homeUrl,
      description: PROJECT_ONE_LINER,
      image: imageUrl,
      publisher: {
        '@id': organizationId,
      },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: SITE_NAME,
      applicationCategory: 'UtilitiesApplication',
      operatingSystem: 'Any',
      offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'USD',
      },
      description: PROJECT_ONE_LINER,
      url: homeUrl,
      image: imageUrl,
      publisher: {
        '@id': organizationId,
      },
      sameAs: [REPOSITORY_URL],
    },
    {
      '@context': 'https://schema.org',
      '@id': organizationId,
      '@type': 'Organization',
      name: SITE_NAME,
      url: homeUrl,
      sameAs: [REPOSITORY_URL],
      image: imageUrl,
      logo: {
        '@type': 'ImageObject',
        url: logoUrl,
        width: 512,
        height: 512,
      },
    },
  ]
}

/**
 * Central SEO defaults and URL helpers for the browser app.
 */

export const SITE_NAME = 'Xdrop'
export const PROJECT_ONE_LINER =
  'Xdrop is an open source end-to-end encrypted file transfer app for humans and agents, keeping plaintext file names, contents, and keys off the server.'
export const SHORT_POSITIONING_SUMMARY = 'End-to-end encrypted file transfer for humans and agents.'
export const TERMINAL_SUPPORT_BLURB =
  'Agents can use Xdrop to upload files, return end-to-end encrypted share links, and use Xdrop links for local decryption.'
export const DEFAULT_SEO_TITLE =
  'Open Source End-to-End Encrypted File Transfer for Humans and Agents | Xdrop'
export const DEFAULT_SEO_DESCRIPTION = PROJECT_ONE_LINER
export const HISTORY_PAGE_TITLE = 'Manage End-to-End Encrypted Transfers on This Device | Xdrop'
export const HISTORY_PAGE_DESCRIPTION =
  'Manage Xdrop end-to-end encrypted file transfers stored in this browser on this device. Plaintext file names, contents, and keys stay off the server.'
export const SHARE_PAGE_TITLE = 'Share an End-to-End Encrypted Transfer | Xdrop'
export const SHARE_PAGE_DESCRIPTION =
  'Share an Xdrop end-to-end encrypted file transfer from this browser on this device while keeping plaintext file names, contents, and keys off the server.'
export const RECEIVE_PAGE_TITLE = 'Receive an End-to-End Encrypted Transfer | Xdrop'
export const RECEIVE_PAGE_DESCRIPTION =
  'Receive an Xdrop end-to-end encrypted file transfer and decrypt it locally in the browser, keeping plaintext file names, contents, and keys off the server.'
export const NOT_FOUND_PAGE_TITLE = 'Page Not Found | Xdrop'
export const NOT_FOUND_PAGE_DESCRIPTION =
  'This page was not found in Xdrop. If this came from an end-to-end encrypted transfer link, ask the sender to resend the complete share details.'
export const DEFAULT_OG_IMAGE_PATH = '/brand-lockup-horizontal.png'
export const DEFAULT_OG_IMAGE_ALT =
  'Open source end-to-end encrypted file transfer for humans and agents. Plaintext file names, contents, and keys stay off the server.'
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

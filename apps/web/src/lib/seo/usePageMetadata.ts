/**
 * React hook for synchronizing document title, meta tags, canonical URLs, and JSON-LD.
 */

import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

import {
  DEFAULT_OG_IMAGE_PATH,
  DEFAULT_OG_IMAGE_ALT,
  DEFAULT_ROBOTS,
  DEFAULT_SEO_DESCRIPTION,
  SITE_NAME,
  toAbsoluteUrl,
} from './site'

type StructuredData = Record<string, unknown> | Array<Record<string, unknown>>

type MetadataOptions = {
  title: string
  description?: string
  robots?: string
  path?: string
  exposeUrl?: boolean
  imagePath?: string
  type?: 'website' | 'article'
  structuredData?: StructuredData
}

const STRUCTURED_DATA_ID = 'xdrop-structured-data'

/** usePageMetadata keeps the document head aligned with the active route state. */
export function usePageMetadata({
  title,
  description = DEFAULT_SEO_DESCRIPTION,
  robots = DEFAULT_ROBOTS,
  path,
  exposeUrl = true,
  imagePath = DEFAULT_OG_IMAGE_PATH,
  type = 'website',
  structuredData,
}: MetadataOptions) {
  const location = useLocation()

  useEffect(() => {
    const currentPath = path ?? `${location.pathname}${location.search}`
    const canonicalUrl = exposeUrl ? toAbsoluteUrl(currentPath || '/') : undefined
    const imageUrl = toAbsoluteUrl(imagePath)

    document.title = title
    setMetaByName('description', description)
    setMetaByName('robots', robots)
    setMetaByName('application-name', SITE_NAME)
    setMetaByName('apple-mobile-web-app-title', SITE_NAME)
    setMetaByName('twitter:card', 'summary_large_image')
    setMetaByName('twitter:title', title)
    setMetaByName('twitter:description', description)
    setMetaByName('twitter:image', imageUrl)

    setMetaByProperty('og:site_name', SITE_NAME)
    setMetaByProperty('og:title', title)
    setMetaByProperty('og:description', description)
    setMetaByProperty('og:type', type)
    setMetaByProperty('og:image', imageUrl)
    setMetaByProperty('og:image:alt', DEFAULT_OG_IMAGE_ALT)

    if (canonicalUrl) {
      setMetaByProperty('og:url', canonicalUrl)
      ensureCanonicalLink(canonicalUrl)
    } else {
      removeMetaByProperty('og:url')
      removeCanonicalLink()
    }
    syncStructuredData(structuredData)
  }, [
    description,
    exposeUrl,
    imagePath,
    location.pathname,
    location.search,
    path,
    robots,
    structuredData,
    title,
    type,
  ])
}

/** ensureCanonicalLink creates or updates the canonical link element. */
function ensureCanonicalLink(href: string) {
  let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')

  if (!link) {
    link = document.createElement('link')
    link.rel = 'canonical'
    document.head.append(link)
  }

  link.href = href
}

/** removeCanonicalLink removes the canonical link when a route should stay private. */
function removeCanonicalLink() {
  document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.remove()
}

/** setMetaByName creates or updates a `<meta name="...">` tag. */
function setMetaByName(name: string, content: string) {
  let meta = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)

  if (!meta) {
    meta = document.createElement('meta')
    meta.name = name
    document.head.append(meta)
  }

  meta.content = content
}

/** setMetaByProperty creates or updates a `<meta property="...">` tag. */
function setMetaByProperty(property: string, content: string) {
  let meta = document.head.querySelector<HTMLMetaElement>(`meta[property="${property}"]`)

  if (!meta) {
    meta = document.createElement('meta')
    meta.setAttribute('property', property)
    document.head.append(meta)
  }

  meta.content = content
}

/** removeMetaByProperty removes a property-based meta tag when it should not be exposed. */
function removeMetaByProperty(property: string) {
  document.head.querySelector<HTMLMetaElement>(`meta[property="${property}"]`)?.remove()
}

/** syncStructuredData keeps the singleton JSON-LD script in sync with the route metadata. */
function syncStructuredData(structuredData?: StructuredData) {
  const existing = document.getElementById(STRUCTURED_DATA_ID)

  if (!structuredData) {
    existing?.remove()
    return
  }

  const next = existing ?? document.createElement('script')
  next.id = STRUCTURED_DATA_ID
  next.setAttribute('type', 'application/ld+json')
  next.textContent = JSON.stringify(structuredData)

  if (!existing) {
    document.head.append(next)
  }
}

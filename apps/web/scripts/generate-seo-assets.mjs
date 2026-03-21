import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'

const currentDirectory = dirname(fileURLToPath(import.meta.url))
const distDirectory = join(currentDirectory, '..', 'dist')
const siteUrl = process.env.VITE_SITE_URL?.trim().replace(/\/+$/u, '') || ''

const SITE_NAME = 'Xdrop'
const DEFAULT_OG_IMAGE_PATH = '/brand-lockup-horizontal.png'
const DEFAULT_LOGO_PATH = '/brand-symbol-512.png'
const DEFAULT_OG_IMAGE_ALT = 'Xdrop horizontal brand lockup'
const DEFAULT_OG_TYPE = 'website'
const REPOSITORY_URL = 'https://github.com/xixu-me/xdrop'
const DEFAULT_ROBOTS =
  'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1'
const PRIVATE_ROBOTS = 'noindex, nofollow, noarchive, nosnippet'
const STRUCTURED_DATA_ID = 'xdrop-structured-data-static'

const HOME_TITLE = 'Open Source Encrypted File Transfer for Browsers and Agents | Xdrop'
const HOME_DESCRIPTION =
  'Xdrop is an open source encrypted file transfer app for browsers and agent-driven terminal workflows, keeping plaintext file names, contents, and keys off the server.'
const HISTORY_PAGE_TITLE = 'Manage Transfers on This Device | Xdrop'
const HISTORY_PAGE_DESCRIPTION =
  'Manage encrypted transfers stored in this browser on this device. There is no account or cross-device history.'
const SHARE_PAGE_TITLE = 'Share the Full Link | Xdrop'
const SHARE_PAGE_DESCRIPTION =
  'Review upload status and copy the full share link for a transfer staged in this browser on this device.'
const RECEIVE_PAGE_TITLE = 'Download and Decrypt in the Browser | Xdrop'
const RECEIVE_PAGE_DESCRIPTION =
  'Download files from this transfer and decrypt them in the browser. The decryption key stays in the share link fragment.'
const NOT_FOUND_PAGE_TITLE = 'Page Not Found | Xdrop'
const NOT_FOUND_PAGE_DESCRIPTION =
  'The address does not map to a page in Xdrop. If this came from a shared transfer, ask for the full URL, including the #k=... decryption fragment.'

const routeShells = [
  {
    outputPath: 'index.html',
    pagePath: '/',
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
    robots: DEFAULT_ROBOTS,
    structuredData: getHomeStructuredData(),
  },
  {
    outputPath: 'transfers/index.html',
    pagePath: '/transfers',
    title: HISTORY_PAGE_TITLE,
    description: HISTORY_PAGE_DESCRIPTION,
    robots: PRIVATE_ROBOTS,
    exposeUrl: false,
  },
  {
    outputPath: 'share/index.html',
    pagePath: '/share/',
    title: SHARE_PAGE_TITLE,
    description: SHARE_PAGE_DESCRIPTION,
    robots: PRIVATE_ROBOTS,
    exposeUrl: false,
  },
  {
    outputPath: 't/index.html',
    pagePath: '/t/',
    title: RECEIVE_PAGE_TITLE,
    description: RECEIVE_PAGE_DESCRIPTION,
    robots: PRIVATE_ROBOTS,
    exposeUrl: false,
  },
  {
    outputPath: 'not-found/index.html',
    title: NOT_FOUND_PAGE_TITLE,
    description: NOT_FOUND_PAGE_DESCRIPTION,
    robots: PRIVATE_ROBOTS,
    exposeUrl: false,
  },
]

const robotsLines = [
  'User-agent: *',
  'Allow: /',
  'Disallow: /share/',
  'Disallow: /t/',
  'Disallow: /transfers',
]

if (siteUrl) {
  robotsLines.push(`Sitemap: ${siteUrl}/sitemap.xml`)
}

await writeFile(join(distDirectory, 'robots.txt'), `${robotsLines.join('\n')}\n`, 'utf8')

if (!siteUrl) {
  await rm(join(distDirectory, 'sitemap.xml'), { force: true })
  console.warn('[seo] Skipped sitemap.xml generation because VITE_SITE_URL is not set.')
}

const sitemap = siteUrl
  ? `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${siteUrl}/</loc>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`
  : ''

if (sitemap) {
  await writeFile(join(distDirectory, 'sitemap.xml'), sitemap, 'utf8')
}

const template = await readFile(join(distDirectory, 'index.html'), 'utf8')

for (const shell of routeShells) {
  const outputFile = join(distDirectory, shell.outputPath)
  await mkdir(dirname(outputFile), { recursive: true })
  await writeFile(outputFile, renderRouteShell(template, shell), 'utf8')
}

console.info(
  `[seo] Generated route HTML shells${siteUrl ? `, robots.txt, and sitemap.xml for ${siteUrl}` : ' and robots.txt'}.`,
)

function renderRouteShell(template, shell) {
  const dom = new JSDOM(template)
  const { document } = dom.window
  const canonicalUrl =
    shell.exposeUrl === false || !shell.pagePath ? undefined : toAbsoluteUrl(shell.pagePath)
  const imageUrl = toAbsoluteUrl(DEFAULT_OG_IMAGE_PATH)

  document.title = shell.title
  setMetaByName(document, 'description', shell.description)
  setMetaByName(document, 'robots', shell.robots)
  setMetaByName(document, 'application-name', SITE_NAME)
  setMetaByName(document, 'apple-mobile-web-app-title', SITE_NAME)
  setMetaByName(document, 'twitter:card', 'summary_large_image')
  setMetaByName(document, 'twitter:title', shell.title)
  setMetaByName(document, 'twitter:description', shell.description)
  setMetaByName(document, 'twitter:image', imageUrl)

  setMetaByProperty(document, 'og:site_name', SITE_NAME)
  setMetaByProperty(document, 'og:type', DEFAULT_OG_TYPE)
  setMetaByProperty(document, 'og:title', shell.title)
  setMetaByProperty(document, 'og:description', shell.description)
  setMetaByProperty(document, 'og:image', imageUrl)
  setMetaByProperty(document, 'og:image:alt', DEFAULT_OG_IMAGE_ALT)

  if (canonicalUrl) {
    setMetaByProperty(document, 'og:url', canonicalUrl)
    ensureCanonicalLink(document, canonicalUrl)
  } else {
    removeCanonicalLink(document)
    removeMetaByProperty(document, 'og:url')
  }

  syncStructuredData(document, shell.structuredData)

  return `<!doctype html>\n${document.documentElement.outerHTML}\n`
}

function setMetaByName(document, name, content) {
  let meta = document.head.querySelector(`meta[name="${name}"]`)

  if (!meta) {
    meta = document.createElement('meta')
    meta.setAttribute('name', name)
    document.head.append(meta)
  }

  meta.setAttribute('content', content)
}

function setMetaByProperty(document, property, content) {
  let meta = document.head.querySelector(`meta[property="${property}"]`)

  if (!meta) {
    meta = document.createElement('meta')
    meta.setAttribute('property', property)
    document.head.append(meta)
  }

  meta.setAttribute('content', content)
}

function removeMetaByProperty(document, property) {
  document.head.querySelector(`meta[property="${property}"]`)?.remove()
}

function ensureCanonicalLink(document, href) {
  let link = document.head.querySelector('link[rel="canonical"]')

  if (!link) {
    link = document.createElement('link')
    link.setAttribute('rel', 'canonical')
    document.head.append(link)
  }

  link.setAttribute('href', href)
}

function removeCanonicalLink(document) {
  document.head.querySelector('link[rel="canonical"]')?.remove()
}

function syncStructuredData(document, structuredData) {
  const existing = document.getElementById(STRUCTURED_DATA_ID)

  if (!structuredData) {
    existing?.remove()
    return
  }

  const script = existing ?? document.createElement('script')
  script.id = STRUCTURED_DATA_ID
  script.setAttribute('type', 'application/ld+json')
  script.textContent = JSON.stringify(structuredData)

  if (!existing) {
    document.head.append(script)
  }
}

function getHomeStructuredData() {
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
      description: HOME_DESCRIPTION,
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
      description: HOME_DESCRIPTION,
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

function toAbsoluteUrl(path) {
  if (!siteUrl) {
    return path
  }

  return new URL(path, `${siteUrl}/`).toString()
}

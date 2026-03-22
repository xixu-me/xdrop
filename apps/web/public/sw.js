const CACHE_NAME = 'xdrop-static-v5'
const STATIC_ASSETS = [
  '/manifest.webmanifest',
  '/brand-symbol.svg',
  '/favicon.svg',
  '/brand-symbol-maskable.svg',
  '/brand-symbol-192.png',
  '/brand-symbol-512.png',
  '/brand-symbol-maskable-512.png',
  '/brand-lockup-horizontal.svg',
  '/brand-lockup-horizontal.png',
  '/apple-touch-icon.png',
  '/icons.svg',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') {
    return
  }

  const url = new URL(request.url)
  if (
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/xdrop/')
  ) {
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request))
    return
  }

  if (!shouldCache(url.pathname)) {
    return
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        return cached
      }

      return fetch(request)
        .then((response) => {
          if (!response.ok || response.type === 'opaque') {
            return response
          }

          const copy = response.clone()
          void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
          return response
        })
        .catch(() => cached)
    }),
  )
})

function shouldCache(pathname) {
  return pathname.startsWith('/assets/') || STATIC_ASSETS.includes(pathname)
}

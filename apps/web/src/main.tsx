/**
 * Browser entrypoint that mounts the app shell and registers the production service worker.
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/instrument-sans/wght.css'
import '@fontsource/fraunces/500.css'
import '@fontsource/fraunces/700.css'

import { App } from '@/app/App'
import './index.css'

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  // Register after the initial page load so first paint is not blocked.
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

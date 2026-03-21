/**
 * Root router for the browser application.
 */

import { createBrowserRouter, RouterProvider } from 'react-router-dom'

import { PageStateCard } from '@/components/ui/PageStateCard'
import { Shell } from './Shell'

function RouteHydrateFallback() {
  return (
    <PageStateCard
      eyebrow="Xdrop"
      title="Loading…"
      body="Preparing the encrypted transfer workspace."
    />
  )
}

function lazyRoute<T extends { Component: unknown }>(load: () => Promise<T>) {
  return {
    lazy: load,
    hydrateFallbackElement: <RouteHydrateFallback />,
  }
}

/** The router keeps navigation declarative and co-locates each page with its route. */
const router = createBrowserRouter([
  {
    path: '/',
    Component: Shell,
    children: [
      {
        ...lazyRoute(async () => {
          const { SenderRouteLayout } = await import('./routes/SenderRouteLayout')
          return { Component: SenderRouteLayout }
        }),
        children: [
          {
            index: true,
            ...lazyRoute(async () => {
              const { HomePage } = await import('./routes/HomePage')
              return { Component: HomePage }
            }),
          },
          {
            path: 'share/:transferId',
            ...lazyRoute(async () => {
              const { SharePage } = await import('./routes/SharePage')
              return { Component: SharePage }
            }),
          },
          {
            path: 'transfers',
            ...lazyRoute(async () => {
              const { HistoryPage } = await import('./routes/HistoryPage')
              return { Component: HistoryPage }
            }),
          },
        ],
      },
      {
        path: 't/:transferId',
        ...lazyRoute(async () => {
          const { ReceivePage } = await import('./routes/ReceivePage')
          return { Component: ReceivePage }
        }),
      },
      {
        path: '*',
        ...lazyRoute(async () => {
          const { NotFoundPage } = await import('./routes/NotFoundPage')
          return { Component: NotFoundPage }
        }),
      },
    ],
  },
])

/** App renders the router provider used by the rest of the browser UI. */
export function App() {
  return <RouterProvider router={router} />
}

import { Outlet } from 'react-router-dom'

import { TransferProvider } from '@/features/upload/TransferContext'

/** SenderRouteLayout loads upload runtime state only for sender-side routes. */
export function SenderRouteLayout() {
  return (
    <TransferProvider>
      <Outlet />
    </TransferProvider>
  )
}

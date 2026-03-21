import { useParams } from 'react-router-dom'

import { ReceiveTransfer } from '@/features/receive/ReceiveTransfer'

/** ReceivePage resolves the transfer ID from the URL before rendering the receiver flow. */
export function ReceivePage() {
  const { transferId } = useParams()

  if (!transferId) {
    return null
  }

  return <ReceiveTransfer transferId={transferId} />
}

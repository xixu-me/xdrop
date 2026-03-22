import { useParams } from 'react-router-dom'

import { ShareCard } from '@/features/share/ShareCard'
import { useTransfers } from '@/features/upload/TransferContext'
import { PRIVATE_ROBOTS, SHARE_PAGE_DESCRIPTION, SHARE_PAGE_TITLE } from '@/lib/seo/site'
import { usePageMetadata } from '@/lib/seo/usePageMetadata'

/** SharePage shows sender-side progress and sharing controls for one local transfer. */
export function SharePage() {
  const { transferId } = useParams()
  const { transfers, extendTransfer } = useTransfers()
  const transfer = transfers.find((item) => item.id === transferId)

  usePageMetadata({
    title: SHARE_PAGE_TITLE,
    description: SHARE_PAGE_DESCRIPTION,
    robots: PRIVATE_ROBOTS,
    exposeUrl: false,
  })

  return <ShareCard transfer={transfer} onExtendTransfer={extendTransfer} />
}

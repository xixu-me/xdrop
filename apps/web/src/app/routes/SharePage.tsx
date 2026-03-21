import { useParams } from 'react-router-dom'

import { ShareCard } from '@/features/share/ShareCard'
import { useTransfers } from '@/features/upload/TransferContext'
import { PRIVATE_ROBOTS } from '@/lib/seo/site'
import { usePageMetadata } from '@/lib/seo/usePageMetadata'

/** SharePage shows sender-side progress and sharing controls for one local transfer. */
export function SharePage() {
  const { transferId } = useParams()
  const { transfers } = useTransfers()
  const transfer = transfers.find((item) => item.id === transferId)

  usePageMetadata({
    title: 'Share the Full Link | Xdrop',
    description:
      'Review upload status and copy the full share link for a browser-encrypted transfer.',
    robots: PRIVATE_ROBOTS,
    exposeUrl: false,
  })

  return <ShareCard transfer={transfer} />
}

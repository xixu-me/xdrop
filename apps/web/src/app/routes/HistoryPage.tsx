import { HistoryBoard } from '@/features/history/HistoryBoard'
import { PRIVATE_ROBOTS } from '@/lib/seo/site'
import { usePageMetadata } from '@/lib/seo/usePageMetadata'

/** HistoryPage hides local-only transfer history from search engines. */
export function HistoryPage() {
  usePageMetadata({
    title: 'Manage Transfers on This Device | Xdrop',
    description:
      'Manage encrypted transfers stored in this browser. There is no account or cross-device history.',
    robots: PRIVATE_ROBOTS,
    exposeUrl: false,
  })

  return <HistoryBoard />
}

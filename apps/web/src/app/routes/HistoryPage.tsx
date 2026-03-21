import { HistoryBoard } from '@/features/history/HistoryBoard'
import { HISTORY_PAGE_DESCRIPTION, HISTORY_PAGE_TITLE, PRIVATE_ROBOTS } from '@/lib/seo/site'
import { usePageMetadata } from '@/lib/seo/usePageMetadata'

/** HistoryPage hides local-only transfer history from search engines. */
export function HistoryPage() {
  usePageMetadata({
    title: HISTORY_PAGE_TITLE,
    description: HISTORY_PAGE_DESCRIPTION,
    robots: PRIVATE_ROBOTS,
    exposeUrl: false,
  })

  return <HistoryBoard />
}

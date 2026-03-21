import { UploadStudio } from '@/features/upload/UploadStudio'
import { DEFAULT_SEO_TITLE, PROJECT_ONE_LINER, getHomeStructuredData } from '@/lib/seo/site'
import { usePageMetadata } from '@/lib/seo/usePageMetadata'

/** HomePage applies homepage metadata and renders the upload workflow. */
export function HomePage() {
  usePageMetadata({
    title: DEFAULT_SEO_TITLE,
    description: PROJECT_ONE_LINER,
    structuredData: getHomeStructuredData(),
  })

  return <UploadStudio />
}

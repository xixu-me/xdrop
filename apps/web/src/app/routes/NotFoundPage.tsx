import { Card } from '@/components/ui/Card'
import { PRIVATE_ROBOTS } from '@/lib/seo/site'
import { usePageMetadata } from '@/lib/seo/usePageMetadata'

/** NotFoundPage explains the most common ways secure share links break. */
export function NotFoundPage() {
  usePageMetadata({
    title: 'Page Not Found | Xdrop',
    description:
      'The address does not map to a page in Xdrop. If this came from a shared transfer, ask for the full URL, including the #k=... decryption fragment.',
    robots: PRIVATE_ROBOTS,
    exposeUrl: false,
  })

  return (
    <div className="stack">
      <Card className="hero-card page-hero-card">
        <div className="page-hero-copy">
          <p className="eyebrow">404 · Not found</p>
          <h2>This page was not found.</h2>
          <p className="muted page-intro">
            The address does not map to a page in Xdrop. If this came from a shared transfer, ask
            for the full URL, including the <code>#k=...</code> decryption fragment.
          </p>
        </div>
      </Card>

      <Card className="receive-list-card">
        <div className="section-heading receive-list-heading">
          <div className="receive-list-copy">
            <p className="eyebrow">Quick recovery</p>
            <h2>Try these checks</h2>
            <p className="muted">Most broken links come from one of these places.</p>
          </div>
        </div>

        <ul className="file-list">
          <li className="file-row not-found-tip">
            <div className="file-stack">
              <strong>Try the browser that created the transfer</strong>
              <p className="muted">
                Sender history and local transfer controls only exist on the device that created the
                transfer.
              </p>
            </div>
          </li>
          <li className="file-row not-found-tip">
            <div className="file-stack">
              <strong>Check the route family</strong>
              <p className="muted">
                Shared downloads live under <code>/t/:transferId</code>. Sender history lives under{' '}
                <code>/transfers</code>.
              </p>
            </div>
          </li>
          <li className="file-row not-found-tip">
            <div className="file-stack">
              <strong>Return to a safe page</strong>
              <p className="muted">
                Use the navigation above to start a transfer or manage transfers on this device.
              </p>
            </div>
          </li>
        </ul>
      </Card>
    </div>
  )
}

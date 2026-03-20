type Props = {
  status: string
}

/** StatusBadge normalizes transfer state labels into a consistent badge UI. */
export function StatusBadge({ status }: Props) {
  return <span className={`status-badge status-badge--${status}`}>{labelForStatus(status)}</span>
}

/** labelForStatus converts internal state keys into human-readable badge copy. */
function labelForStatus(status: string) {
  switch (status) {
    case 'draft':
      return 'Draft'
    case 'preparing':
      return 'Preparing'
    case 'uploading':
      return 'Uploading'
    case 'paused':
      return 'Continuing'
    case 'ready':
      return 'Ready'
    case 'failed':
      return 'Failed'
    case 'expired':
      return 'Expired'
    case 'deleted':
      return 'Deleted'
    default:
      return status
  }
}

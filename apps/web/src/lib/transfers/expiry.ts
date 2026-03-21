import type { LocalTransferRecord } from '@/lib/indexeddb/db'

/** isExpiredTransfer compares the transfer expiry time against a caller-supplied clock. */
export function isExpiredTransfer(transfer: LocalTransferRecord, now = Date.now()) {
  if (transfer.status === 'deleted') {
    return false
  }

  const expiresAt = new Date(transfer.expiresAt).getTime()
  return Number.isFinite(expiresAt) && expiresAt <= now
}

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { useTransfers } from '@/features/upload/TransferContext'
import { formatBytes } from '@/lib/files/formatBytes'
import { formatLocalDateTime } from '@/lib/i18n/formatDateTime'
import type { LocalTransferRecord } from '@/lib/indexeddb/db'
import { isExpiredTransfer } from '@/lib/transfers/expiry'

/** HistoryBoard is the sender-side dashboard for transfer status, copy, extend, and delete actions. */
export function HistoryBoard() {
  const { transfers, deleteTransfer } = useTransfers()
  const [expandedExpired, setExpandedExpired] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({})
  const [pendingDeleteTransferId, setPendingDeleteTransferId] = useState<string>()

  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(intervalId)
  }, [])

  const { activeTransfers, expiredTransfers } = useMemo(() => {
    const active: LocalTransferRecord[] = []
    const expired: LocalTransferRecord[] = []

    for (const transfer of transfers) {
      if (isExpiredTransfer(transfer, now)) {
        expired.push(transfer)
      } else {
        active.push(transfer)
      }
    }

    return { activeTransfers: active, expiredTransfers: expired }
  }, [now, transfers])

  /** setActionError scopes async action failures to the affected transfer card. */
  const setActionError = (transferId: string, error: unknown) => {
    setActionErrors((current) => ({
      ...current,
      [transferId]:
        error instanceof Error ? error.message : 'Could not update this transfer right now.',
    }))
  }

  /** clearActionError removes stale feedback before a new action starts. */
  const clearActionError = (transferId: string) => {
    setActionErrors((current) => {
      if (!(transferId in current)) {
        return current
      }

      const next = { ...current }
      delete next[transferId]
      return next
    })
  }

  const handleDelete = async (transferId: string) => {
    clearActionError(transferId)
    try {
      await deleteTransfer(transferId)
      setPendingDeleteTransferId((current) => (current === transferId ? undefined : current))
    } catch (error) {
      setActionError(transferId, error)
    }
  }

  return (
    <div className="stack">
      <Card className="hero-card page-hero-card">
        <div className="page-hero-copy history-hero-copy">
          <p className="eyebrow">Transfers</p>
          <h2>Manage transfers on this device.</h2>
          <p className="muted page-intro">
            This browser keeps your transfer controls unless privacy mode clears them after upload.
            There is no account or cross-device history.
          </p>
        </div>
      </Card>
      {activeTransfers.length === 0 && expiredTransfers.length === 0 ? (
        <Card>
          <div className="empty-state empty-state--compact">
            <h3>No transfers on this device</h3>
            <p className="muted">Start a transfer and it will appear here with local controls.</p>
          </div>
        </Card>
      ) : null}
      {activeTransfers.map((transfer) => renderTransferCard(transfer))}
      {expiredTransfers.length > 0 ? (
        <Card className="expired-group">
          <button
            aria-expanded={expandedExpired}
            className="expired-group__toggle"
            onClick={() => setExpandedExpired((current) => !current)}
            type="button"
          >
            <div className="expired-group__copy">
              <p className="eyebrow">Expired</p>
              <h2>Expired transfers</h2>
              <p className="muted">
                Past their local expiry time. Expand to review or forget them.
              </p>
            </div>
            <span className="expired-group__count">{expiredTransfers.length}</span>
          </button>
          {expandedExpired ? (
            <div className="stack expired-group__content">
              {expiredTransfers.map((transfer) => renderTransferCard(transfer, true))}
            </div>
          ) : null}
        </Card>
      ) : null}
    </div>
  )

  /** renderTransferCard keeps the active and expired layouts visually consistent. */
  function renderTransferCard(transfer: LocalTransferRecord, expired = false) {
    const progress = (transfer.uploadedBytes / Math.max(transfer.totalBytes, 1)) * 100
    const canManageTransfer = Boolean(transfer.manageToken)
    const showProgress = !expired && transfer.status !== 'ready'
    const status = expired ? 'expired' : transfer.status

    return (
      <Card
        key={transfer.id}
        className={expired ? 'history-transfer-card history-transfer-card--expired' : ''}
      >
        <div className="history-row">
          <div className="file-stack history-card-stack">
            <div className="history-card-heading">
              <StatusBadge status={status} />
              <div className="history-card-copy">
                <h3 className="transfer-name">{transfer.displayName}</h3>
                <p className="muted">
                  Created {formatLocalDateTime(transfer.createdAt)} ·{' '}
                  {expired ? 'Expired' : 'Expires'} {formatLocalDateTime(transfer.expiresAt)}
                </p>
                {!showProgress ? (
                  <span className="muted">
                    {transfer.totalFiles} files · {formatBytes(transfer.totalBytes)}
                  </span>
                ) : null}
              </div>
            </div>
            {showProgress ? (
              <ProgressBar value={progress} label={`${Math.round(progress)}% uploaded`} />
            ) : null}
            {showProgress ? (
              <span className="muted">
                {transfer.totalFiles} files · {formatBytes(transfer.totalBytes)}
              </span>
            ) : null}
          </div>
          <div className="history-actions">
            {!expired ? (
              <Link className="button button--ghost" to={`/share/${transfer.id}`}>
                Open share page
              </Link>
            ) : null}
            {pendingDeleteTransferId === transfer.id ? (
              <>
                <Button tone="danger" onClick={() => void handleDelete(transfer.id)}>
                  {canManageTransfer ? 'Confirm delete' : 'Confirm forget'}
                </Button>
                <Button
                  tone="ghost"
                  onClick={() =>
                    setPendingDeleteTransferId((current) =>
                      current === transfer.id ? undefined : current,
                    )
                  }
                >
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                tone="danger"
                onClick={() => {
                  clearActionError(transfer.id)
                  setPendingDeleteTransferId(transfer.id)
                }}
              >
                {canManageTransfer ? 'Delete' : 'Forget local copy'}
              </Button>
            )}
          </div>
        </div>

        {pendingDeleteTransferId === transfer.id && !canManageTransfer ? (
          <p aria-live="polite" className="warning">
            Confirm forget to remove this local record from this device.
          </p>
        ) : null}
        {transfer.localManagementCleared ? (
          <p className="warning">
            Privacy mode removed local transfer controls after upload. The share link still works,
            but you can't extend or delete this transfer here.
          </p>
        ) : null}
        {transfer.lastError ? <p className="warning">{transfer.lastError}</p> : null}
        {actionErrors[transfer.id] ? (
          <p aria-live="polite" className="warning">
            {actionErrors[transfer.id]}
          </p>
        ) : null}
      </Card>
    )
  }
}

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import QRCode from 'qrcode'

import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { PageStateCard } from '@/components/ui/PageStateCard'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { formatBytes } from '@/lib/files/formatBytes'
import { formatLocalDateTime } from '@/lib/i18n/formatDateTime'
import type { LocalTransferRecord } from '@/lib/indexeddb/db'
import { isExpiredTransfer } from '@/lib/transfers/expiry'

type Props = {
  transfer: LocalTransferRecord | undefined
}

/** ShareCard shows sender-side sharing controls and current upload state for one transfer. */
export function ShareCard({ transfer }: Props) {
  const [now, setNow] = useState(() => Date.now())
  const [qrState, setQrState] = useState<{ dataUrl?: string; shareUrl?: string }>({})
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle')
  const [actionError, setActionError] = useState<string>()
  const progress = transfer ? (transfer.uploadedBytes / Math.max(transfer.totalBytes, 1)) * 100 : 0
  const expired = transfer ? isExpiredTransfer(transfer, now) : false
  const canShareLink = Boolean(transfer?.shareUrl) && !expired && transfer?.status !== 'deleted'
  const qrShareUrl = canShareLink ? transfer?.shareUrl : undefined
  const qrDataUrl = qrShareUrl && qrState.shareUrl === qrShareUrl ? qrState.dataUrl : undefined

  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(intervalId)
  }, [])

  useEffect(() => {
    if (!qrShareUrl) {
      return
    }

    let cancelled = false

    // QR generation is asynchronous, so we guard against setting stale state after URL changes.
    void QRCode.toDataURL(qrShareUrl, {
      margin: 1,
      width: 256,
      color: {
        dark: '#0c130b',
        light: '#f7f2e8',
      },
    })
      .then((nextQrDataUrl) => {
        if (!cancelled) {
          setQrState({
            dataUrl: nextQrDataUrl,
            shareUrl: qrShareUrl,
          })
        }
      })
      .catch(() => {
        if (!cancelled) {
          setQrState((currentState) => (currentState.shareUrl === qrShareUrl ? {} : currentState))
        }
      })

    return () => {
      cancelled = true
    }
  }, [qrShareUrl])

  /** copyLink writes the full share URL, including the `#k=` fragment, to the clipboard. */
  const copyLink = async () => {
    if (!transfer?.shareUrl || !canShareLink) {
      return
    }
    try {
      setActionError(undefined)
      await navigator.clipboard.writeText(transfer.shareUrl)
      setCopyState('copied')
      window.setTimeout(() => setCopyState('idle'), 1800)
    } catch {
      setCopyState('idle')
      setActionError('Copy failed. Select the full link below to copy it manually.')
    }
  }

  /** shareLink uses the platform share sheet when available and falls back to copying. */
  const shareLink = async () => {
    if (!transfer?.shareUrl || !canShareLink) {
      return
    }
    if (navigator.share) {
      try {
        setActionError(undefined)
        await navigator.share({
          title: transfer.displayName,
          url: transfer.shareUrl,
          text: 'Encrypted files via Xdrop',
        })
        return
      } catch (error) {
        if (isAbortLike(error)) {
          return
        }
        await copyLink()
        return
      }
    }

    await copyLink()
  }

  if (!transfer) {
    return (
      <PageStateCard
        eyebrow="Share"
        title="Transfer not on this device"
        body="Open it in the browser that created it."
      />
    )
  }

  if (expired) {
    return (
      <div className="stack">
        <Card className="hero-card page-hero-card">
          <div className="page-hero-head">
            <div className="page-hero-copy">
              <p className="eyebrow">Share</p>
              <h2>This transfer expired.</h2>
              <p className="page-summary-name">{transfer.displayName}</p>
              <p className="muted page-intro">
                Share links stop working once the expiry time passes. This page keeps the local
                record, but it no longer presents the link or QR code as active.
              </p>
            </div>
            <StatusBadge status="expired" />
          </div>
          <dl className="page-meta">
            <div className="page-meta-item">
              <dt className="page-meta-label">Files</dt>
              <dd className="page-meta-value">{transfer.totalFiles}</dd>
            </div>
            <div className="page-meta-item">
              <dt className="page-meta-label">Expired</dt>
              <dd className="page-meta-value">{formatLocalDateTime(transfer.expiresAt)}</dd>
            </div>
            <div className="page-meta-item">
              <dt className="page-meta-label">Encrypted size</dt>
              <dd className="page-meta-value">{formatBytes(transfer.totalBytes)}</dd>
            </div>
          </dl>
          <div className="button-row">
            <Link className="button button--ghost" to="/transfers">
              Manage transfers
            </Link>
          </div>
          <p className="warning">
            Recipients opening the saved <code>/t/</code> link will see it as expired.
          </p>
          {transfer.lastError ? <p className="warning">{transfer.lastError}</p> : null}
        </Card>
      </div>
    )
  }

  const showUploadProgress = transfer.status !== 'ready' && transfer.status !== 'deleted'
  const statusCopy = shareStatusCopy(transfer.status)

  return (
    <div className="share-layout">
      <Card className="hero-card page-hero-card">
        <div className="page-hero-head">
          <div className="page-hero-copy">
            <p className="eyebrow">Share</p>
            <h2>Share the full link.</h2>
            <p className="page-summary-name">{transfer.displayName}</p>
            <p className="muted page-intro">
              The server stores ciphertext and operational metadata, not plaintext file names, file
              contents, or the decryption key.
            </p>
          </div>
          <StatusBadge status={transfer.status} />
        </div>
        {showUploadProgress ? (
          <ProgressBar value={progress} label={`${Math.round(progress)}% uploaded`} />
        ) : null}
        {statusCopy ? <p className="muted page-status-copy">{statusCopy}</p> : null}
        <dl className="page-meta">
          <div className="page-meta-item">
            <dt className="page-meta-label">Files</dt>
            <dd className="page-meta-value">{transfer.totalFiles}</dd>
          </div>
          <div className="page-meta-item">
            <dt className="page-meta-label">Expires</dt>
            <dd className="page-meta-value">{formatLocalDateTime(transfer.expiresAt)}</dd>
          </div>
          <div className="page-meta-item">
            <dt className="page-meta-label">Encrypted size</dt>
            <dd className="page-meta-value">{formatBytes(transfer.totalBytes)}</dd>
          </div>
        </dl>

        <div className="button-row">
          <Button onClick={() => void copyLink()} disabled={!canShareLink}>
            {copyState === 'copied' ? 'Copied' : 'Copy link'}
          </Button>
          <Button onClick={() => void shareLink()} tone="ghost" disabled={!canShareLink}>
            Share link
          </Button>
          <Link className="button button--ghost" to="/transfers">
            Manage transfers
          </Link>
        </div>
        {transfer.shareUrl ? (
          <label className="field">
            <span>Full link</span>
            <input
              autoComplete="off"
              name="shareUrl"
              readOnly
              spellCheck={false}
              value={transfer.shareUrl}
              onFocus={(event) => event.currentTarget.select()}
            />
          </label>
        ) : null}
        {actionError ? (
          <p aria-live="polite" className="warning">
            {actionError}
          </p>
        ) : null}
        {transfer.localManagementCleared ? (
          <p className="warning">
            Privacy mode removed local transfer controls after upload. Keep the share link safe.
            Extend and delete are no longer available here.
          </p>
        ) : null}
        <p className="warning">
          Keep the full link, including the <code>#k=</code> part. Without it, the files cannot be
          decrypted.
        </p>
      </Card>

      <Card className="qr-card">
        {qrDataUrl ? (
          <img alt="Transfer QR code" className="qr-image" src={qrDataUrl} />
        ) : (
          <div className="qr-placeholder" />
        )}
        <p className="muted qr-copy">Open on another device.</p>
      </Card>
    </div>
  )
}

/** shareStatusCopy translates local transfer state into sender-facing guidance. */
function shareStatusCopy(status: LocalTransferRecord['status']) {
  switch (status) {
    case 'ready':
      return undefined
    case 'paused':
      return 'Upload will continue automatically when this browser returns.'
    case 'failed':
      return 'Upload stopped in this browser.'
    case 'deleted':
      return 'This transfer was deleted.'
    default:
      return 'The link will work once the upload finishes.'
  }
}

function isAbortLike(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { PageStateCard } from '@/components/ui/PageStateCard'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { apiClient } from '@/lib/api/client'
import type { ManifestFileEntry, ManifestV1, PublicTransferDescriptor } from '@/lib/api/types'
import {
  decryptManifest as decryptManifestEnvelope,
  unwrapRootKey as unwrapTransferRootKey,
} from '@/lib/crypto/envelope'
import { parseLinkKey } from '@/lib/crypto/urlKey'
import { createDecryptedReadableStream, decryptFileToBlob } from '@/lib/download/decrypt'
import { buildZipFromStreams, writeZipStream } from '@/lib/download/zip'
import { formatBytes } from '@/lib/files/formatBytes'
import { safeDownloadName, sanitizePath } from '@/lib/files/paths'
import { isAbortError, openSaveWritable, saveBlob, supportsStreamingSave } from '@/lib/files/save'
import { formatLocalDateTime } from '@/lib/i18n/formatDateTime'
import { PRIVATE_ROBOTS } from '@/lib/seo/site'
import { usePageMetadata } from '@/lib/seo/usePageMetadata'

type Props = {
  transferId: string
}

/** ReceiveTransfer fetches the encrypted manifest and decrypts downloads entirely in-browser. */
export function ReceiveTransfer({ transferId }: Props) {
  const [descriptor, setDescriptor] = useState<PublicTransferDescriptor>()
  const [manifest, setManifest] = useState<ManifestV1>()
  const [rootKey, setRootKey] = useState<Uint8Array | null>(null)
  const [error, setError] = useState<string>()
  const [downloadError, setDownloadError] = useState<string>()
  const [downloadProgress, setDownloadProgress] = useState(0)
  const [activeDownload, setActiveDownload] = useState<string | 'zip' | null>(null)

  const fragmentKey = useMemo(() => parseLinkKey(window.location.hash), [])
  const totalPlaintextBytes = useMemo(
    () => (manifest?.files ?? []).reduce((sum, file) => sum + file.plaintextSize, 0),
    [manifest],
  )
  const progressLabel =
    activeDownload !== null
      ? `${downloadProgress}% downloaded`
      : downloadProgress === 100
        ? 'Download complete'
        : 'Ready to download'
  const showDownloadStatus =
    activeDownload !== null || downloadProgress > 0 || Boolean(downloadError)

  usePageMetadata({
    title: 'Download and Decrypt in the Browser | Xdrop',
    description:
      'Download files from this transfer and decrypt them in the browser. The decryption key stays in the share link fragment.',
    robots: PRIVATE_ROBOTS,
    exposeUrl: false,
  })

  useEffect(() => {
    void (async () => {
      if (!fragmentKey) {
        setError('This link is missing the decryption key.')
        return
      }

      try {
        const nextDescriptor = await apiClient.getPublicTransfer(transferId)
        setDescriptor(nextDescriptor)
        if (
          nextDescriptor.status !== 'ready' ||
          !nextDescriptor.manifestUrl ||
          !nextDescriptor.wrappedRootKey
        ) {
          return
        }

        // The link fragment never leaves the browser; only the encrypted manifest is fetched.
        const response = await fetch(nextDescriptor.manifestUrl)
        if (!response.ok) {
          throw new Error("Couldn't load the encrypted file list.")
        }
        const envelopeBytes = new Uint8Array(await response.arrayBuffer())
        const decryptedRootKey = await unwrapRootKeyOrThrow(
          nextDescriptor.wrappedRootKey,
          fragmentKey,
        )
        const decryptedManifest = await decryptManifestOrThrow(decryptedRootKey, envelopeBytes)
        setRootKey(decryptedRootKey)
        setManifest(decryptedManifest)
      } catch (caughtError) {
        setError(
          caughtError instanceof Error ? caughtError.message : "Couldn't open this transfer.",
        )
      }
    })()
  }, [fragmentKey, transferId])

  /** downloadFile streams to disk when possible and falls back to an in-memory Blob otherwise. */
  const downloadFile = async (file: ManifestFileEntry) => {
    if (!rootKey) {
      return
    }

    setDownloadError(undefined)
    setDownloadProgress(0)
    setActiveDownload(file.fileId)

    const filename = safeDownloadName(file.relativePath)

    try {
      const downloadArgs = {
        transferId,
        file,
        rootKey,
        onProgress: (completedBytes: number, totalBytes: number) =>
          setDownloadProgress(Math.round((completedBytes / Math.max(totalBytes, 1)) * 100)),
      }

      if (supportsStreamingSave()) {
        const writable = await openSaveWritable(filename, {
          mimeType: file.mimeType || 'application/octet-stream',
        })
        if (writable) {
          await createDecryptedReadableStream(downloadArgs).pipeTo(writable)
        } else {
          const blob = await decryptFileToBlob(downloadArgs)
          saveBlob(blob, filename)
        }
      } else {
        const blob = await decryptFileToBlob(downloadArgs)
        saveBlob(blob, filename)
      }

      setDownloadProgress(100)
    } catch (caughtError) {
      if (isAbortError(caughtError)) {
        setDownloadProgress(0)
        return
      }
      setDownloadError(caughtError instanceof Error ? caughtError.message : 'Download failed.')
    } finally {
      setActiveDownload((current) => (current === file.fileId ? null : current))
    }
  }

  /** downloadAll streams ZIP creation to disk when possible and avoids per-file buffering. */
  const downloadAll = async () => {
    if (!manifest || !rootKey) {
      return
    }

    setDownloadError(undefined)
    setDownloadProgress(0)
    setActiveDownload('zip')

    const zipName = `${safeDownloadName(manifest.displayName)}.zip`
    const totalBytes = manifest.files.reduce((sum, file) => sum + file.plaintextSize, 0)
    let completedBytes = 0

    try {
      const createZipEntries = () =>
        manifest.files.map((file) => ({
          path: sanitizePath(file.relativePath),
          readable: createDecryptedReadableStream({
            transferId,
            file,
            rootKey,
            onProgress: (fileCompletedBytes) =>
              setDownloadProgress(
                Math.round(((completedBytes + fileCompletedBytes) / Math.max(totalBytes, 1)) * 100),
              ),
          }),
          size: file.plaintextSize,
          modifiedAt: file.modifiedAt,
          onComplete: () => {
            completedBytes += file.plaintextSize
          },
        }))

      if (supportsStreamingSave()) {
        const writable = await openSaveWritable(zipName, { mimeType: 'application/zip' })
        if (writable) {
          await writeZipStream(createZipEntries(), writable)
        } else {
          const zip = await buildZipFromStreams(createZipEntries())
          saveBlob(zip, zipName)
        }
      } else {
        const zip = await buildZipFromStreams(createZipEntries())
        saveBlob(zip, zipName)
      }

      setDownloadProgress(100)
    } catch (caughtError) {
      if (isAbortError(caughtError)) {
        setDownloadProgress(0)
        return
      }
      setDownloadError(caughtError instanceof Error ? caughtError.message : 'Download failed.')
    } finally {
      setActiveDownload((current) => (current === 'zip' ? null : current))
    }
  }

  if (error) {
    return <PageStateCard eyebrow="Receive" title="Can't open this transfer" body={error} />
  }

  if (!descriptor) {
    return (
      <PageStateCard
        eyebrow="Receive"
        title="Opening transfer…"
        body="Checking the link and decryption key."
      />
    )
  }

  if (descriptor.status !== 'ready') {
    const statusCopy = getTransferStatusCopy(descriptor.status)
    return <PageStateCard eyebrow="Receive" title={statusCopy.title} body={statusCopy.body} />
  }

  if (!manifest) {
    return (
      <PageStateCard
        eyebrow="Receive"
        title="Decrypting file list…"
        body="The decryption key stays in this browser. It never reaches the server."
      />
    )
  }

  return (
    <div className="receive-layout">
      <Card className="hero-card page-hero-card">
        <div className="page-hero-copy">
          <p className="eyebrow">Receive</p>
          <h2>Download and decrypt in the browser.</h2>
          <p className="page-summary-name">{manifest.displayName}</p>
          <p className="muted page-intro">
            The decryption key stays in the share link fragment and never reaches the server.
          </p>
        </div>
        <dl className="page-meta">
          <div className="page-meta-item">
            <dt className="page-meta-label">Files</dt>
            <dd className="page-meta-value">{manifest.files.length}</dd>
          </div>
          <div className="page-meta-item">
            <dt className="page-meta-label">Expires</dt>
            <dd className="page-meta-value">{formatLocalDateTime(descriptor.expiresAt)}</dd>
          </div>
          <div className="page-meta-item">
            <dt className="page-meta-label">Total size</dt>
            <dd className="page-meta-value">{formatBytes(totalPlaintextBytes)}</dd>
          </div>
        </dl>
      </Card>

      <Card className="receive-list-card">
        <div className="section-heading receive-list-heading">
          <div className="receive-list-copy">
            <h2>Files</h2>
            <p className="muted">Download individual files, or save the whole transfer as a ZIP.</p>
          </div>
          <div className="receive-list-tools">
            <Button onClick={() => void downloadAll()} disabled={activeDownload !== null}>
              {activeDownload === 'zip' ? 'Preparing ZIP…' : 'Download all as a ZIP'}
            </Button>
            {showDownloadStatus ? (
              <div className="receive-list-status">
                <ProgressBar
                  value={downloadProgress}
                  {...(progressLabel ? { label: progressLabel } : {})}
                />
                {downloadError ? <p className="warning">{downloadError}</p> : null}
              </div>
            ) : null}
          </div>
        </div>
        <ul className="file-list receive-file-list">
          {manifest.files.map((file) => {
            const hasDirectoryPath =
              file.relativePath !== file.name && /[\\/]/.test(file.relativePath)

            return (
              <li key={file.fileId} className="file-row receive-file-row">
                <div className="file-stack receive-file-stack">
                  <div className="receive-file-heading">
                    <strong>{file.name}</strong>
                    <span className="receive-file-size">{formatBytes(file.plaintextSize)}</span>
                  </div>
                  {hasDirectoryPath ? (
                    <p className="muted receive-file-path">{file.relativePath}</p>
                  ) : null}
                </div>
                <div className="file-actions receive-file-actions">
                  <Button
                    tone="ghost"
                    onClick={() => void downloadFile(file)}
                    disabled={activeDownload !== null}
                  >
                    {activeDownload === file.fileId ? 'Downloading…' : 'Download'}
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      </Card>
    </div>
  )
}

/** unwrapRootKeyOrThrow hides low-level crypto failures behind a sender-friendly message. */
async function unwrapRootKeyOrThrow(wrappedRootKey: string, fragmentKey: Uint8Array) {
  try {
    return await unwrapTransferRootKey(wrappedRootKey, fragmentKey)
  } catch {
    throw new Error('This decryption key is invalid.')
  }
}

/** decryptManifestOrThrow maps manifest decryption failures to a single invalid-key error. */
async function decryptManifestOrThrow(rootKey: Uint8Array, envelopeBytes: Uint8Array) {
  try {
    return await decryptManifestEnvelope(rootKey, envelopeBytes)
  } catch {
    throw new Error('This decryption key is invalid.')
  }
}

/** getTransferStatusCopy explains why a public transfer cannot yet be downloaded. */
function getTransferStatusCopy(status: PublicTransferDescriptor['status']) {
  switch (status) {
    case 'expired':
      return {
        title: 'Share link expired',
        body: 'Ask the sender for a new link if the transfer is still available.',
      }
    case 'deleted':
      return {
        title: 'Transfer deleted',
        body: 'The sender removed it from storage.',
      }
    case 'incomplete':
      return {
        title: 'Upload in progress',
        body: 'The sender is still uploading. Try again shortly.',
      }
    default:
      return {
        title: 'Transfer unavailable',
        body: 'This transfer is not ready.',
      }
  }
}

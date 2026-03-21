/**
 * Sender-side upload composer for staging files, remembering draft state, and launching uploads.
 */

import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { DEFAULT_EXPIRY_SECONDS, EXPIRY_OPTIONS, type ExpiryOption } from '@xdrop/shared'

import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { formatBytes } from '@/lib/files/formatBytes'
import { PROJECT_ONE_LINER } from '@/lib/seo/site'
import { defaultTransferName, useTransfers, type SelectedSource } from './TransferContext'
import { getTransferSelectionLimitError } from './selectionLimits'
import {
  clearUploadSelectionDraft,
  loadUploadSelectionDraft,
  persistUploadSelectionDraftSources,
  saveUploadSelectionDraftSettings,
  type UploadSelectionDraftSource,
} from './uploadSelectionDraft'

type DragState = 'idle' | 'over'

type FileSystemEntryLike = {
  isFile: boolean
  isDirectory: boolean
  name: string
  createReader?: () => FileSystemDirectoryReaderLike
  file?: (callback: (file: File) => void) => void
}

type FileSystemDirectoryReaderLike = {
  readEntries: (callback: (entries: FileSystemEntryLike[]) => void) => void
}

type ItemWithEntry = DataTransferItem & {
  webkitGetAsEntry?: () => FileSystemEntryLike | null
}

/** UploadStudio is the main landing experience for composing and starting a transfer. */
export function UploadStudio() {
  const { createTransfer, transfers } = useTransfers()
  const navigate = useNavigate()
  const [selectedSources, setSelectedSources] = useState<UploadSelectionDraftSource[]>([])
  const [displayName, setDisplayName] = useState('')
  const [expiresInSeconds, setExpiresInSeconds] = useState<ExpiryOption>(DEFAULT_EXPIRY_SECONDS)
  const [stripMetadata, setStripMetadata] = useState(true)
  const [clearLocalSecretsOnReady, setClearLocalSecretsOnReady] = useState(false)
  const [dragState, setDragState] = useState<DragState>('idle')
  const [isLaunching, setIsLaunching] = useState(false)
  const [launchError, setLaunchError] = useState<string>()
  const [selectionError, setSelectionError] = useState<string>()
  const [hasLoadedDraft, setHasLoadedDraft] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const isMountedRef = useRef(true)
  const sourceSyncRef = useRef(Promise.resolve())

  useEffect(() => {
    folderInputRef.current?.setAttribute('webkitdirectory', '')
  }, [])

  useEffect(() => {
    isMountedRef.current = true
    void (async () => {
      try {
        const draft = await loadUploadSelectionDraft()
        if (!isMountedRef.current) {
          return
        }

        setSelectedSources(draft.sources)
        setDisplayName(draft.settings.displayName)
        setExpiresInSeconds(draft.settings.expiresInSeconds)
        setStripMetadata(draft.settings.stripMetadata)
      } catch (error) {
        if (!isMountedRef.current) {
          return
        }
        setSelectionError(
          error instanceof Error ? error.message : "Couldn't restore the previous selection.",
        )
      } finally {
        if (isMountedRef.current) {
          setHasLoadedDraft(true)
        }
      }
    })()

    return () => {
      isMountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!hasLoadedDraft) {
      return
    }

    saveUploadSelectionDraftSettings({
      displayName,
      expiresInSeconds,
      stripMetadata,
    })
  }, [displayName, expiresInSeconds, hasLoadedDraft, stripMetadata])

  const recentTransfers = useMemo(() => transfers.slice(0, 3), [transfers])
  const totalSelectedBytes = useMemo(
    () => selectedSources.reduce((sum, source) => sum + source.file.size, 0),
    [selectedSources],
  )
  const selectionLimitError = useMemo(
    () => getTransferSelectionLimitError(selectedSources),
    [selectedSources],
  )
  const uploadError = selectionError ?? launchError
  const stagedLabel =
    selectedSources.length === 0
      ? 'Awaiting files'
      : `${selectedSources.length} item${selectedSources.length === 1 ? '' : 's'} staged`
  const payloadLabel = selectedSources.length === 0 ? '0 B' : formatBytes(totalSelectedBytes)
  /** syncDraftSources serializes staged file persistence so OPFS and IndexedDB stay consistent. */
  const syncDraftSources = (sources: UploadSelectionDraftSource[]) => {
    sourceSyncRef.current = sourceSyncRef.current
      .then(async () => {
        const nextSources = await persistUploadSelectionDraftSources(sources)
        if (!isMountedRef.current) {
          return
        }

        setSelectedSources((current) =>
          hasSameDraftSelection(current, nextSources) ? current : nextSources,
        )
      })
      .catch((error) => {
        if (!isMountedRef.current) {
          return
        }
        setSelectionError(
          error instanceof Error ? error.message : "Couldn't keep this selection after refresh.",
        )
      })
  }

  /** clearDraftSources clears the persisted draft after a successful launch or manual reset. */
  const clearDraftSources = () => {
    sourceSyncRef.current = sourceSyncRef.current.then(() => clearUploadSelectionDraft())
    return sourceSyncRef.current
  }

  /** launchTransfer hands the staged sources to the transfer runtime and navigates to share view. */
  const launchTransfer = async () => {
    if (selectionLimitError) {
      setSelectionError(selectionLimitError)
      setLaunchError(undefined)
      return
    }

    try {
      setIsLaunching(true)
      setLaunchError(undefined)
      setSelectionError(undefined)
      const transferId = await createTransfer(selectedSources, {
        displayName: displayName.trim() || defaultTransferName(selectedSources),
        expiresInSeconds,
        stripMetadata,
        clearLocalSecretsOnReady,
      })
      await clearDraftSources()
      setSelectedSources([])
      navigate(`/share/${transferId}`)
    } catch (error) {
      setLaunchError(error instanceof Error ? error.message : 'Could not start the transfer.')
    } finally {
      setIsLaunching(false)
    }
  }

  /** addSelectedSources merges new picks into the existing draft while enforcing selection limits. */
  const addSelectedSources = (incomingSources: SelectedSource[]) => {
    const nextSelection = mergeSelectedSources(selectedSources, incomingSources)
    const nextError = getTransferSelectionLimitError(nextSelection)

    if (nextError) {
      setSelectionError(`Couldn't add this selection. ${nextError}`)
      setLaunchError(undefined)
      return
    }

    setSelectionError(undefined)
    setLaunchError(undefined)
    setSelectedSources(nextSelection)
    syncDraftSources(nextSelection)
  }

  const onFilesPicked = (files: FileList | null) => {
    if (!files) {
      return
    }

    addSelectedSources(
      Array.from(files).map((file) => ({
        file,
        relativePath: file.webkitRelativePath || file.name,
      })),
    )
  }

  const onDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragState('idle')
    const fromEntries = await collectDropItems(event.dataTransfer.items)
    if (fromEntries.length > 0) {
      addSelectedSources(fromEntries)
      return
    }

    onFilesPicked(event.dataTransfer.files)
  }

  const removeSource = (target: SelectedSource) => {
    setSelectionError(undefined)
    setLaunchError(undefined)
    setSelectedSources((current) => {
      const nextSelection = current.filter(
        (source) =>
          !(
            source.relativePath === target.relativePath &&
            source.file.size === target.file.size &&
            source.file.lastModified === target.file.lastModified
          ),
      )
      syncDraftSources(nextSelection)
      return nextSelection
    })
  }

  return (
    <div className="upload-layout">
      <Card className="hero-card hero-card--upload">
        <div className="upload-hero-shell">
          <div className="page-hero-copy upload-hero-copy">
            <p className="eyebrow">End-to-end encryption</p>
            <h1 className="page-hero-title">Encrypted file transfer.</h1>
            <p className="lead">{PROJECT_ONE_LINER}</p>
            <p className="muted">
              Use Xdrop in the browser for normal sharing, or{' '}
              <a
                className="inline-link"
                href="https://github.com/xixu-me/xdrop?tab=readme-ov-file#use-via-agents"
                rel="noreferrer"
                target="_blank"
              >
                through an agent
              </a>{' '}
              when you need to move files out of a cloud server, remote container, or automated
              terminal workflow.
            </p>
          </div>
        </div>
        <div
          className={`dropzone dropzone--${dragState} ${
            selectedSources.length > 0 ? 'dropzone--active' : ''
          }`.trim()}
          onDragEnter={(event) => {
            event.preventDefault()
            setDragState('over')
          }}
          onDragLeave={(event) => {
            event.preventDefault()
            setDragState('idle')
          }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => void onDrop(event)}
        >
          <div className="dropzone-shell">
            <p className="muted dropzone-copy">
              Use the web app to drop files or a folder. Names, paths, and file contents are
              encrypted in this browser before upload.
            </p>
            {uploadError ? <p className="warning dropzone-copy">{uploadError}</p> : null}
            <div className="button-row">
              <Button onClick={() => fileInputRef.current?.click()}>Choose files</Button>
              <Button tone="ghost" onClick={() => folderInputRef.current?.click()}>
                Choose folder
              </Button>
            </div>
          </div>
          <input
            hidden
            multiple
            ref={fileInputRef}
            type="file"
            onChange={(event) => {
              onFilesPicked(event.target.files)
              event.target.value = ''
            }}
          />
          <input
            hidden
            multiple
            ref={folderInputRef}
            type="file"
            onChange={(event) => {
              onFilesPicked(event.target.files)
              event.target.value = ''
            }}
          />
        </div>

        <div aria-live="polite" className="insight-strip">
          <div className="insight-chip">
            <span className="insight-chip__label">Selection</span>
            <strong className="insight-chip__value">{stagedLabel}</strong>
          </div>
          <div className="insight-chip">
            <span className="insight-chip__label">Estimated payload</span>
            <strong className="insight-chip__value">{payloadLabel}</strong>
          </div>
          <div className="insight-chip">
            <span className="insight-chip__label">Resume behavior</span>
            <strong className="insight-chip__value">
              {hasLoadedDraft ? 'Keeps your stage after refresh' : 'Loading local draft…'}
            </strong>
          </div>
        </div>

        <div className="field-grid">
          <label className="field">
            <span>Transfer name</span>
            <input
              autoComplete="off"
              name="displayName"
              placeholder={
                selectedSources.length > 0
                  ? defaultTransferName(selectedSources)
                  : 'Untitled transfer'
              }
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Expiry</span>
            <select
              name="expiresInSeconds"
              value={expiresInSeconds}
              onChange={(event) => setExpiresInSeconds(Number(event.target.value) as ExpiryOption)}
            >
              {EXPIRY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="composer-footer">
          <div className="button-row">
            <Button
              disabled={selectedSources.length === 0 || isLaunching || Boolean(selectionLimitError)}
              onClick={() => void launchTransfer()}
            >
              {isLaunching ? 'Starting…' : 'Start transfer'}
            </Button>
            <Button
              tone="ghost"
              disabled={selectedSources.length === 0}
              onClick={() =>
                void (async () => {
                  setSelectedSources([])
                  setSelectionError(undefined)
                  setLaunchError(undefined)
                  await clearDraftSources()
                })()
              }
            >
              Clear selection
            </Button>
          </div>
        </div>

        <label className="toggle toggle--card">
          <input
            checked={stripMetadata}
            type="checkbox"
            onChange={(event) => setStripMetadata(event.target.checked)}
          />
          <div>
            <span>Remove image metadata before encryption</span>
            <p className="muted">
              Useful for photos and screenshots. Pixels stay the same. When supported, removable
              EXIF data is stripped.
            </p>
          </div>
        </label>

        <label className="toggle toggle--card">
          <input
            checked={clearLocalSecretsOnReady}
            type="checkbox"
            onChange={(event) => setClearLocalSecretsOnReady(event.target.checked)}
          />
          <div>
            <span>Privacy mode: remove local transfer controls after upload</span>
            <p className="muted">
              The share link stays on this device, but extend and delete controls are removed once
              the upload finishes.
            </p>
          </div>
        </label>
        <p className="warning">
          Uploads continue automatically when you return here in the same browser on this device
          after a refresh or reopen. Privacy mode keeps less sensitive state on this device, with
          fewer local controls.
        </p>
      </Card>

      <div className="upload-rail">
        <Card className="receive-list-card upload-selection-card">
          <div className="section-heading receive-list-heading">
            <div className="receive-list-copy">
              <h2>Ready to send</h2>
              <p className="muted">This is what will be encrypted.</p>
            </div>
          </div>
          {selectedSources.length === 0 ? (
            <div className="empty-state">
              <h3>Nothing selected</h3>
              <p className="muted">Add files or a folder to get started.</p>
            </div>
          ) : (
            <ul className="file-list receive-file-list">
              {selectedSources.map((source, index) => {
                const hasDirectoryPath =
                  source.relativePath !== source.file.name && /[\\/]/.test(source.relativePath)

                return (
                  <li
                    key={`${source.relativePath}:${source.file.lastModified}`}
                    className="file-row receive-file-row"
                    style={{ animationDelay: `${120 + index * 70}ms` }}
                  >
                    <div className="file-stack receive-file-stack">
                      <div className="receive-file-heading">
                        <strong>{source.file.name}</strong>
                        <span className="receive-file-size">{formatBytes(source.file.size)}</span>
                      </div>
                      {hasDirectoryPath ? (
                        <p className="muted receive-file-path">{source.relativePath}</p>
                      ) : null}
                    </div>
                    <div className="file-actions receive-file-actions">
                      <Button tone="ghost" onClick={() => removeSource(source)}>
                        Remove
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        <Card className="receive-list-card upload-recent-card">
          <div className="section-heading receive-list-heading">
            <div className="receive-list-copy">
              <h2>Recent transfers</h2>
              <p className="muted">Saved in this browser only.</p>
            </div>
            <div className="receive-list-tools upload-recent-tools">
              <Button tone="ghost" onClick={() => navigate('/transfers')}>
                Manage transfers
              </Button>
            </div>
          </div>
          {recentTransfers.length === 0 ? (
            <div className="empty-state">
              <h3>No recent transfers</h3>
              <p className="muted">New transfers appear here.</p>
            </div>
          ) : (
            <ul className="file-list">
              {recentTransfers.map((transfer, index) => {
                const progress = (transfer.uploadedBytes / Math.max(transfer.totalBytes, 1)) * 100
                const showProgress = transfer.status !== 'ready'
                return (
                  <li
                    key={transfer.id}
                    className="queue-row"
                    style={{ animationDelay: `${160 + index * 80}ms` }}
                  >
                    <div className="file-stack queue-card-stack">
                      <div className="history-card-heading queue-card-heading">
                        <StatusBadge status={transfer.status} />
                        <div className="history-card-copy">
                          <h3 className="transfer-name">{transfer.displayName}</h3>
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
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}

/** mergeSelectedSources deduplicates files by path, size, and modification time. */
function mergeSelectedSources(
  current: UploadSelectionDraftSource[],
  incoming: SelectedSource[],
): UploadSelectionDraftSource[] {
  const next = new Map(current.map((source) => [selectionKey(source), source]))
  for (const source of incoming) {
    next.set(selectionKey(source), source)
  }
  return Array.from(next.values())
}

/** selectionKey provides a stable identity for draft deduplication and comparison. */
function selectionKey(source: SelectedSource) {
  return `${source.relativePath}:${source.file.size}:${source.file.lastModified}`
}

/** hasSameDraftSelection avoids unnecessary state updates when draft persistence is unchanged. */
function hasSameDraftSelection(
  current: UploadSelectionDraftSource[],
  next: UploadSelectionDraftSource[],
) {
  if (current.length !== next.length) {
    return false
  }

  return current.every((source, index) => {
    const candidate = next[index]
    return (
      candidate !== undefined &&
      source.draftKey === candidate.draftKey &&
      selectionKey(source) === selectionKey(candidate)
    )
  })
}

/** collectDropItems expands dropped directories via the legacy WebKit entry API when available. */
async function collectDropItems(items: DataTransferItemList) {
  const entries = await Promise.all(
    Array.from(items).map(async (item) => {
      const entry = (item as ItemWithEntry).webkitGetAsEntry?.()
      if (!entry) {
        return []
      }
      return readEntry(entry)
    }),
  )
  return entries.flat()
}

/** readEntry recursively expands dropped files and folders into normalized selected sources. */
async function readEntry(entry: FileSystemEntryLike, parentPath = ''): Promise<SelectedSource[]> {
  if (entry.isFile && entry.file) {
    const file = await new Promise<File>((resolve) => entry.file?.(resolve))
    return [
      {
        file,
        relativePath: parentPath ? `${parentPath}/${file.name}` : file.name,
      },
    ]
  }

  if (entry.isDirectory && entry.createReader) {
    const reader = entry.createReader()
    const entries = await readAllDirectoryEntries(reader)
    const nextPath = parentPath ? `${parentPath}/${entry.name}` : entry.name
    const nested = await Promise.all(entries.map((child) => readEntry(child, nextPath)))
    return nested.flat()
  }

  return []
}

/** readAllDirectoryEntries drains the WebKit directory reader until it reports no more children. */
async function readAllDirectoryEntries(reader: FileSystemDirectoryReaderLike) {
  const entries: FileSystemEntryLike[] = []

  while (true) {
    const batch = await new Promise<FileSystemEntryLike[]>((resolve) => reader.readEntries(resolve))
    if (batch.length === 0) {
      return entries
    }
    entries.push(...batch)
  }
}

export const __test__ = {
  collectDropItems,
  hasSameDraftSelection,
  mergeSelectedSources,
  readAllDirectoryEntries,
  readEntry,
  selectionKey,
}

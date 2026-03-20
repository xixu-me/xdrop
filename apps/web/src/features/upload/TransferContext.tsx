/**
 * Transfer runtime state for creating, resuming, and managing uploads within the browser.
 */

import {
  DEFAULT_CHUNK_SIZE,
  MAX_FILE_COUNT,
  MAX_UPLOAD_CONCURRENCY,
  MAX_TRANSFER_BYTES,
  SOURCE_BLOB_PERSIST_LIMIT,
} from '@xdrop/shared'
import {
  createContext,
  startTransition,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react'

import type { ExpiryOption } from '@xdrop/shared'
import { apiClient } from '@/lib/api/client'
import type { ManifestFileEntry, ManifestV1 } from '@/lib/api/types'
import { toBase64, toBase64Url } from '@/lib/crypto/base64'
import { generateSecret } from '@/lib/crypto/envelope'
import {
  createIndexedDbSourceRecord,
  deletePersistedTransferSources,
  loadPersistedSourceFile,
  persistSourceToOpfs,
  supportsOpfsSourcePersistence,
} from '@/lib/files/persistentSources'
import { safeDownloadName, sanitizePath } from '@/lib/files/paths'
import { stripMetadata } from '@/lib/files/metadata'
import {
  deleteTransfer as deleteTransferRecord,
  deleteSourcesForTransfer,
  getSourcesForTransfer,
  getTransfer,
  listTransfers,
  putSources,
  putTransfer,
  type LocalTransferRecord,
  type PersistedSourceRecord,
} from '@/lib/indexeddb/db'
import { cryptoWorker } from '@/lib/workers/cryptoClient'
import { getPreparedTransferLimitError, getTransferSelectionLimitError } from './selectionLimits'

/** SelectedSource is the normalized shape used throughout the upload flow. */
export type SelectedSource = {
  file: File
  relativePath: string
}

type CreateTransferOptions = {
  displayName: string
  expiresInSeconds: ExpiryOption
  stripMetadata: boolean
  clearLocalSecretsOnReady: boolean
}

type AbortReason = 'navigation' | 'delete'

type RuntimeState = {
  cancelled: boolean
  controller: AbortController | undefined
  abortReason: AbortReason | undefined
}

type UploadSource = PersistedSourceRecord & {
  file: File
}

/** This message marks transfers that should resume automatically after a page return. */
const RESUME_AFTER_NAVIGATION_MESSAGE =
  'This page was closed or refreshed. Upload will continue automatically when this browser returns.'

type TransferContextValue = {
  transfers: LocalTransferRecord[]
  createTransfer: (sources: SelectedSource[], options: CreateTransferOptions) => Promise<string>
  refreshTransfers: () => Promise<void>
  deleteTransfer: (transferId: string) => Promise<void>
  extendTransfer: (transferId: string, expiresInSeconds: ExpiryOption) => Promise<void>
}

const TransferContext = createContext<TransferContextValue | null>(null)

/** TransferProvider owns the browser-local upload runtime and transfer persistence. */
export function TransferProvider({ children }: PropsWithChildren) {
  const [transfers, setTransfers] = useState<LocalTransferRecord[]>([])
  const runtimes = useRef(new Map<string, RuntimeState>())
  const continueTransferRef = useRef<(transferId: string) => Promise<void>>(async () => {})

  /** updateTransferInState applies lightweight UI updates without reloading IndexedDB state. */
  const updateTransferInState = (
    transferId: string,
    updater: (current: LocalTransferRecord) => LocalTransferRecord,
  ) => {
    startTransition(() =>
      setTransfers((current) =>
        current.map((transfer) => (transfer.id === transferId ? updater(transfer) : transfer)),
      ),
    )
  }

  /** refreshTransfers reloads and sorts the local transfer list from IndexedDB. */
  const refreshTransfers = async () => {
    const nextTransfers = (await listTransfers()).sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt),
    )
    startTransition(() => setTransfers(nextTransfers))
  }

  /** updateTransferRecord keeps the IndexedDB record and in-memory list aligned. */
  const updateTransferRecord = async (
    transferId: string,
    updater: (current: LocalTransferRecord) => LocalTransferRecord,
  ) => {
    const record = await getTransfer(transferId)
    if (!record) {
      return undefined
    }
    const nextRecord = updater(record)
    await putTransfer(nextRecord)
    updateTransferInState(transferId, () => nextRecord)
    return nextRecord
  }

  useEffect(() => {
    void (async () => {
      const recoveredTransferIds = await recoverInterruptedTransfers()
      await refreshTransfers()
      if (recoveredTransferIds.length === 0) {
        return
      }

      void Promise.allSettled(
        recoveredTransferIds.map((transferId) => continueTransferRef.current(transferId)),
      )
    })()
  }, [])

  useEffect(() => {
    const handlePageExit = () => {
      abortAllRuntimes(runtimes.current, 'navigation')
    }

    window.addEventListener('pagehide', handlePageExit)
    window.addEventListener('beforeunload', handlePageExit)
    return () => {
      window.removeEventListener('pagehide', handlePageExit)
      window.removeEventListener('beforeunload', handlePageExit)
      handlePageExit()
    }
  }, [])

  /** createTransfer prepares local state, registers files remotely, and starts the upload loop. */
  const createTransfer = async (sources: SelectedSource[], options: CreateTransferOptions) => {
    if (sources.length === 0) {
      throw new Error('Choose at least one file or folder.')
    }
    const selectionLimitError = getTransferSelectionLimitError(sources)
    if (selectionLimitError) {
      throw new Error(selectionLimitError)
    }

    const { uploadConfig, manageToken, transferId, expiresAt } = await apiClient.createTransfer(
      options.expiresInSeconds,
    )
    try {
      const chunkSize = uploadConfig.chunkSize || DEFAULT_CHUNK_SIZE
      const rootKey = await generateSecret(32)
      const linkKey = await generateSecret(32)

      const prepared = await prepareSources(transferId, sources, chunkSize, options.stripMetadata)
      const preparedLimitError = getPreparedTransferLimitError(
        prepared.files.length,
        prepared.totalCiphertextBytes,
      )
      if (preparedLimitError) {
        throw new Error(preparedLimitError)
      }
      const shareUrl = `${window.location.origin}/t/${transferId}#k=${toBase64Url(linkKey)}`

      await apiClient.registerFiles(
        transferId,
        manageToken,
        prepared.files.map((file) => ({
          fileId: file.fileId,
          totalChunks: file.totalChunks,
          ciphertextBytes: file.ciphertextSizes.reduce((sum, size) => sum + size, 0),
          plaintextBytes: file.plaintextSize,
          chunkSize: file.chunkSize,
        })),
      )

      if (prepared.persistedSources.length > 0) {
        await putSources(prepared.persistedSources)
      }

      const draft: LocalTransferRecord = {
        id: transferId,
        displayName:
          options.displayName || safeDownloadName(prepared.files[0]?.relativePath ?? 'transfer'),
        createdAt: new Date().toISOString(),
        expiresAt,
        status: 'preparing',
        shareUrl,
        manageToken,
        linkKeyBase64Url: toBase64Url(linkKey),
        rootKeyBase64Url: toBase64Url(rootKey),
        metadataStrippingEnabled: options.stripMetadata,
        clearLocalSecretsOnReady: options.clearLocalSecretsOnReady,
        localManagementCleared: false,
        totalFiles: prepared.files.length,
        totalBytes: prepared.totalCiphertextBytes,
        uploadedBytes: 0,
        sourcePersisted: true,
        files: prepared.files,
      }

      await putTransfer(draft)
      await refreshTransfers()
      runtimes.current.set(transferId, createRuntimeState())
      void uploadTransfer(draft)

      return transferId
    } catch (error) {
      await Promise.allSettled([
        deletePersistedTransferSources(transferId),
        apiClient.deleteTransfer(transferId, manageToken),
      ])
      throw error
    }
  }

  /** continueTransfer recreates runtime state for an interrupted local transfer. */
  const continueTransfer = async (transferId: string) => {
    const record = await getTransfer(transferId)
    if (!record) {
      throw new Error('This transfer is not saved on this device.')
    }
    ensureManageAccess(
      record,
      'This transfer can no longer continue after privacy mode clears local transfer controls.',
    )

    runtimes.current.set(transferId, createRuntimeState())
    await uploadTransfer(record)
  }
  continueTransferRef.current = continueTransfer

  /** deleteTransfer stops any active upload, cleans up local state, and best-effort deletes remotely. */
  const deleteTransfer = async (transferId: string) => {
    const record = await getTransfer(transferId)
    if (record) {
      const runtime = runtimes.current.get(transferId)
      if (runtime) {
        runtime.cancelled = true
        abortRuntime(runtime, 'delete')
      }
      if (record.manageToken) {
        try {
          await apiClient.deleteTransfer(transferId, record.manageToken)
        } catch {
          // Cleanup is best effort here; the expiry job will retry remotely.
        }
      }
      await Promise.allSettled([deletePersistedTransferSources(transferId)])
      await deleteTransferRecord(transferId)
      runtimes.current.delete(transferId)
      await refreshTransfers()
    }
  }

  /** extendTransfer pushes the chosen expiry option back to the API and local cache. */
  const extendTransfer = async (transferId: string, expiresInSeconds: ExpiryOption) => {
    const record = await getTransfer(transferId)
    if (!record) {
      throw new Error('This transfer is not saved on this device.')
    }
    ensureManageAccess(
      record,
      'Expiry changes are no longer available after privacy mode clears local transfer controls.',
    )

    await apiClient.updateTransfer(transferId, record.manageToken, { expiresInSeconds })
    const nextExpiry = new Date(Date.now() + expiresInSeconds * 1000)

    await putTransfer({
      ...record,
      expiresAt: nextExpiry.toISOString(),
    })
    await refreshTransfers()
  }

  /** uploadTransfer performs the resumable chunk upload, manifest upload, and finalization sequence. */
  const uploadTransfer = async (record: LocalTransferRecord) => {
    const runtime = runtimes.current.get(record.id) ?? createRuntimeState()
    runtime.cancelled = false
    runtime.abortReason = undefined
    const controller = new AbortController()
    runtime.controller = controller
    runtimes.current.set(record.id, runtime)
    let acknowledgedUploadedBytes = record.uploadedBytes
    let visibleUploadedBytes = record.uploadedBytes

    try {
      const localSources = await getSourcesForTransfer(record.id)
      if (localSources.length !== record.files.length) {
        await updateTransferRecord(record.id, (current) => ({
          ...current,
          status: 'failed',
          lastError: "Source files are no longer on this device, so this transfer can't continue.",
        }))
        return
      }

      const uploadSources = (
        await Promise.all(localSources.map(async (source) => hydrateUploadSource(source)))
      ).filter((source): source is UploadSource => source !== null)
      if (uploadSources.length !== record.files.length) {
        await updateTransferRecord(record.id, (current) => ({
          ...current,
          status: 'failed',
          lastError: "Source files are no longer on this device, so this transfer can't continue.",
        }))
        return
      }

      await updateTransferRecord(record.id, (current) => ({
        ...current,
        status: 'uploading',
        lastError: undefined,
      }))

      const rootKey = fromBase64Url(record.rootKeyBase64Url)
      const linkKey = fromBase64Url(record.linkKeyBase64Url)
      const resume = await apiClient.resumeTransfer(record.id, record.manageToken, {
        signal: controller.signal,
      })
      const uploadedChunkMap = resume.uploadedChunks ?? {}
      const tasks = buildChunkTasks(record.files, uploadSources, uploadedChunkMap)

      const concurrency = Math.max(
        1,
        Math.min(
          MAX_UPLOAD_CONCURRENCY,
          navigator.hardwareConcurrency ? Math.floor(navigator.hardwareConcurrency / 2) : 4,
        ),
      )

      for (let batchStart = 0; batchStart < tasks.length; batchStart += concurrency * 2) {
        if (runtime.cancelled) {
          return
        }

        // Upload URLs are fetched in batches so the client can retry without presigning the whole transfer.
        const batch = tasks.slice(batchStart, batchStart + concurrency * 2)
        const urls = await apiClient.createUploadUrls(
          record.id,
          record.manageToken,
          batch.map(({ fileId, chunkIndex }) => ({ fileId, chunkIndex })),
          { signal: controller.signal },
        )
        const urlMap = new Map(urls.map((item) => [`${item.fileId}:${item.chunkIndex}`, item]))

        const completed = await parallelLimit(
          batch,
          concurrency,
          async (task) => {
            throwIfAborted(controller.signal)
            const url = urlMap.get(`${task.fileId}:${task.chunkIndex}`)
            if (!url) {
              throw new Error('Missing an upload URL for one chunk.')
            }

            const start = task.chunkIndex * task.file.chunkSize
            const end = Math.min(task.source.file.size, start + task.file.chunkSize)
            const plaintext = new Uint8Array(await task.source.file.slice(start, end).arrayBuffer())
            throwIfAborted(controller.signal)
            const encrypted = await cryptoWorker.encryptChunk({
              rootKey,
              transferId: record.id,
              fileId: task.fileId,
              chunkIndex: task.chunkIndex,
              noncePrefix: task.noncePrefix,
              plaintextChunkSize: plaintext.byteLength,
              plaintext,
            })
            throwIfAborted(controller.signal)

            const response = await fetch(url.url, {
              method: 'PUT',
              signal: controller.signal,
              headers: { 'Content-Type': 'application/octet-stream' },
              body: toArrayBuffer(encrypted.ciphertext),
            })

            if (!response.ok) {
              throw new Error(`Chunk upload failed with ${response.status}`)
            }

            visibleUploadedBytes = Math.min(
              record.totalBytes,
              visibleUploadedBytes + encrypted.ciphertext.byteLength,
            )
            updateTransferInState(record.id, (current) => ({
              ...current,
              uploadedBytes: Math.max(current.uploadedBytes, visibleUploadedBytes),
            }))

            return {
              fileId: task.fileId,
              chunkIndex: task.chunkIndex,
              ciphertextSize: encrypted.ciphertext.byteLength,
              checksumSha256: encrypted.checksumHex,
            }
          },
          controller.signal,
        )

        await apiClient.completeChunks(record.id, record.manageToken, completed, {
          signal: controller.signal,
        })
        const uploadedBytes = completed.reduce((sum, item) => sum + item.ciphertextSize, 0)
        acknowledgedUploadedBytes = Math.min(
          record.totalBytes,
          acknowledgedUploadedBytes + uploadedBytes,
        )
        await updateTransferRecord(record.id, (current) => ({
          ...current,
          uploadedBytes: acknowledgedUploadedBytes,
        }))
      }

      const manifest = buildManifest(record)
      const manifestBytes = await cryptoWorker.encryptManifest(rootKey, manifest)
      const wrappedRootKey = await cryptoWorker.wrapRootKey(rootKey, linkKey)

      await apiClient.uploadManifest(record.id, record.manageToken, toBase64(manifestBytes), {
        signal: controller.signal,
      })
      await apiClient.finalizeTransfer(
        record.id,
        record.manageToken,
        wrappedRootKey,
        record.files.length,
        record.totalBytes,
        {
          signal: controller.signal,
        },
      )
      await cleanupFinishedTransferSources(record.id)

      await updateTransferRecord(record.id, (current) => ({
        ...finalizeCompletedTransfer(current, wrappedRootKey),
      }))
    } catch (error) {
      if (isAbortLike(error) || controller.signal.aborted) {
        const nextStatus = runtime.abortReason === 'delete' ? 'failed' : 'paused'
        const nextError =
          runtime.abortReason === 'navigation' ? RESUME_AFTER_NAVIGATION_MESSAGE : undefined

        await updateTransferRecord(record.id, (current) => ({
          ...current,
          status: nextStatus,
          lastError: nextError,
          uploadedBytes: acknowledgedUploadedBytes,
        }))
        return
      }

      await updateTransferRecord(record.id, (current) => ({
        ...current,
        status: 'failed',
        uploadedBytes: acknowledgedUploadedBytes,
        lastError: error instanceof Error ? error.message : 'Upload failed.',
      }))
      throw error
    } finally {
      const latestRuntime = runtimes.current.get(record.id)
      if (latestRuntime?.controller === controller) {
        latestRuntime.controller = undefined
        latestRuntime.abortReason = undefined
      }
      await refreshTransfers()
    }
  }

  return (
    <TransferContext.Provider
      value={{
        transfers,
        createTransfer,
        refreshTransfers,
        deleteTransfer,
        extendTransfer,
      }}
    >
      {children}
    </TransferContext.Provider>
  )
}

/** useTransfers exposes the transfer runtime to sender-side components. */
export function useTransfers() {
  const value = useContext(TransferContext)
  if (!value) {
    throw new Error('useTransfers must be used inside a TransferProvider')
  }
  return value
}

function fromBase64Url(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0))
}

/** prepareSources strips metadata, computes manifest entries, and persists resumable source files. */
async function prepareSources(
  transferId: string,
  sources: SelectedSource[],
  chunkSize: number,
  stripSourceMetadata: boolean,
) {
  if (sources.length > MAX_FILE_COUNT) {
    throw new Error(`This selection has ${sources.length} items. The limit is ${MAX_FILE_COUNT}.`)
  }

  const files: ManifestFileEntry[] = []
  const persistedSources: PersistedSourceRecord[] = []
  let persistedBytes = 0
  let totalCiphertextBytes = 0
  const useOpfs = supportsOpfsSourcePersistence()

  for (const source of sources) {
    const stripped = await stripMetadata(source.file, stripSourceMetadata)
    const file = stripped.file
    const fileId = toBase64Url(await generateSecret(18))
    const noncePrefix = await generateSecret(8)
    const totalChunks = Math.max(1, Math.ceil(file.size / chunkSize))
    const ciphertextSizes = Array.from({ length: totalChunks }, (_, index) => {
      const plaintextSize = Math.min(chunkSize, Math.max(file.size - index * chunkSize, 0))
      return plaintextSize + 16
    })
    totalCiphertextBytes += ciphertextSizes.reduce((sum, size) => sum + size, 0)
    files.push({
      fileId,
      name: file.name,
      relativePath: source.relativePath,
      mimeType: file.type || 'application/octet-stream',
      plaintextSize: file.size,
      modifiedAt: file.lastModified,
      chunkSize,
      totalChunks,
      ciphertextSizes,
      noncePrefix: toBase64Url(noncePrefix),
      metadataStripped: stripped.stripped,
    })

    let persistedSource: PersistedSourceRecord | null = null
    if (useOpfs) {
      persistedSource = await persistSourceToOpfs({
        transferId,
        fileId,
        relativePath: source.relativePath,
        file,
      })
    }

    if (!persistedSource && persistedBytes + file.size <= SOURCE_BLOB_PERSIST_LIMIT) {
      persistedSource = createIndexedDbSourceRecord({
        transferId,
        fileId,
        relativePath: source.relativePath,
        file,
      })
      persistedBytes += file.size
    }

    if (!persistedSource) {
      throw new Error(
        useOpfs
          ? "This browser couldn't reserve enough local storage, so automatic recovery after refresh won't be available."
          : 'To keep uploads going after refresh, use a browser with OPFS support or choose smaller files.',
      )
    }

    persistedSources.push(persistedSource)
  }

  if (totalCiphertextBytes > MAX_TRANSFER_BYTES) {
    throw new Error(
      `This transfer would upload ${formatTransferBytes(totalCiphertextBytes)} after encryption. The limit is ${formatTransferBytes(MAX_TRANSFER_BYTES)} per transfer.`,
    )
  }

  return { files, persistedSources, totalCiphertextBytes }
}

/** buildManifest creates the manifest payload that recipients decrypt before downloading files. */
function buildManifest(record: LocalTransferRecord, displayName = record.displayName): ManifestV1 {
  return {
    version: 1,
    displayName,
    createdAt: record.createdAt,
    chunkSize: record.files[0]?.chunkSize ?? DEFAULT_CHUNK_SIZE,
    files: record.files,
  }
}

/** finalizeCompletedTransfer optionally scrubs local secrets after a successful upload. */
function finalizeCompletedTransfer(
  record: LocalTransferRecord,
  wrappedRootKey: string,
): LocalTransferRecord {
  const readyRecord: LocalTransferRecord = {
    ...record,
    wrappedRootKey,
    status: 'ready',
    uploadedBytes: record.totalBytes,
    lastError: undefined,
    sourcePersisted: false,
  }

  if (!record.clearLocalSecretsOnReady) {
    return readyRecord
  }

  const scrubbedReadyRecord = { ...readyRecord }
  delete scrubbedReadyRecord.wrappedRootKey

  return {
    ...scrubbedReadyRecord,
    manageToken: '',
    linkKeyBase64Url: '',
    rootKeyBase64Url: '',
    files: [],
    localManagementCleared: true,
  }
}

/** buildChunkTasks filters out already uploaded chunks so resume only uploads missing work. */
function buildChunkTasks(
  files: ManifestFileEntry[],
  sources: UploadSource[],
  uploadedChunkMap: Record<string, number[]>,
) {
  const sourceMap = new Map(sources.map((source) => [source.fileId, source]))
  const tasks: Array<{
    fileId: string
    chunkIndex: number
    file: ManifestFileEntry
    source: UploadSource
    noncePrefix: Uint8Array
  }> = []

  for (const file of files) {
    const source = sourceMap.get(file.fileId)
    if (!source) {
      continue
    }
    const uploaded = new Set(uploadedChunkMap[file.fileId] ?? [])
    const noncePrefix = fromBase64Url(file.noncePrefix)
    for (let chunkIndex = 0; chunkIndex < file.totalChunks; chunkIndex += 1) {
      if (uploaded.has(chunkIndex)) {
        continue
      }
      tasks.push({
        fileId: file.fileId,
        chunkIndex,
        file,
        source,
        noncePrefix,
      })
    }
  }

  return tasks
}

/** hydrateUploadSource rehydrates the stored source record into a fresh File object. */
async function hydrateUploadSource(source: PersistedSourceRecord): Promise<UploadSource | null> {
  const file = await loadPersistedSourceFile(source)
  if (!file) {
    return null
  }

  return {
    ...source,
    file,
  }
}

/** cleanupFinishedTransferSources removes persisted upload sources after completion. */
async function cleanupFinishedTransferSources(transferId: string) {
  await Promise.allSettled([
    deletePersistedTransferSources(transferId),
    deleteSourcesForTransfer(transferId),
  ])
}

/** abortAllRuntimes signals every active upload runtime during navigation teardown. */
function abortAllRuntimes(runtimes: Map<string, RuntimeState>, reason: AbortReason) {
  for (const runtime of runtimes.values()) {
    abortRuntime(runtime, reason)
  }
}

/** createRuntimeState returns the mutable controller state for one in-flight transfer. */
function createRuntimeState(): RuntimeState {
  return {
    cancelled: false,
    controller: undefined,
    abortReason: undefined,
  }
}

/** abortRuntime records the reason before aborting the active controller. */
function abortRuntime(runtime: RuntimeState, reason: AbortReason) {
  runtime.abortReason = reason
  runtime.controller?.abort()
}

function isAbortLike(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) {
    throw new DOMException('The operation was aborted.', 'AbortError')
  }
}

/** recoverInterruptedTransfers marks unfinished uploads as paused so they can resume cleanly. */
async function recoverInterruptedTransfers() {
  const transfers = await listTransfers()
  const recoveredTransferIds: string[] = []

  await Promise.all(
    transfers.map(async (transfer) => {
      const interruptedInFlight = transfer.status === 'uploading' || transfer.status === 'preparing'
      const recoveryPendingTransfer =
        transfer.status === 'paused' && transfer.lastError === RESUME_AFTER_NAVIGATION_MESSAGE

      if (!interruptedInFlight && !recoveryPendingTransfer) {
        return
      }

      recoveredTransferIds.push(transfer.id)

      if (recoveryPendingTransfer) {
        return
      }

      await putTransfer({
        ...transfer,
        status: 'paused',
        lastError: RESUME_AFTER_NAVIGATION_MESSAGE,
      })
    }),
  )

  return recoveredTransferIds
}

/** ensureManageAccess rejects local actions once privacy mode clears sender secrets. */
function ensureManageAccess(record: LocalTransferRecord, message: string) {
  if (!record.manageToken) {
    throw new Error(message)
  }
}

/** parallelLimit runs async work with a simple in-process concurrency cap. */
async function parallelLimit<TInput, TOutput>(
  items: TInput[],
  concurrency: number,
  worker: (item: TInput, index: number) => Promise<TOutput>,
  signal?: AbortSignal,
) {
  const results: TOutput[] = []
  let cursor = 0

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (cursor < items.length) {
        if (signal?.aborted) {
          throwIfAborted(signal)
        }
        const index = cursor
        cursor += 1
        const item = items[index]
        if (item === undefined) {
          continue
        }
        results.push(await worker(item, index))
      }
    }),
  )

  return results
}

function toArrayBuffer(input: Uint8Array) {
  return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer
}

function formatTransferBytes(value: number) {
  if (value >= 1024 * 1024 * 1024) {
    return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GiB`
  }
  if (value >= 1024 * 1024) {
    return `${Math.round(value / (1024 * 1024))} MiB`
  }
  if (value >= 1024) {
    return `${Math.round(value / 1024)} KiB`
  }
  return `${value} B`
}

/** defaultTransferName derives a friendly label from the staged selection. */
export function defaultTransferName(sources: SelectedSource[]) {
  const firstSource = sources[0]
  if (!firstSource) {
    return 'Untitled transfer'
  }

  if (sources.length === 1) {
    return safeDownloadName(firstSource.relativePath)
  }

  const commonRootDirectory = getCommonRootDirectory(sources)
  if (commonRootDirectory) {
    return commonRootDirectory
  }

  const remainingCount = sources.length - 1
  return `${safeDownloadName(firstSource.relativePath)} and ${remainingCount} more ${remainingCount === 1 ? 'item' : 'items'}`
}

/** getCommonRootDirectory collapses a folder drop into a single directory name when possible. */
function getCommonRootDirectory(sources: SelectedSource[]) {
  const rootSegments = sources.map(
    (source) => sanitizePath(source.relativePath).split('/')[0] || '',
  )
  const firstRoot = rootSegments[0]
  if (!firstRoot) {
    return null
  }

  const allShareRoot = rootSegments.every((segment) => segment === firstRoot)
  const includesNestedPath = sources.some((source) =>
    sanitizePath(source.relativePath).includes('/'),
  )

  return allShareRoot && includesNestedPath ? firstRoot : null
}

export const __test__ = {
  abortRuntime,
  buildChunkTasks,
  buildManifest,
  createRuntimeState,
  ensureManageAccess,
  finalizeCompletedTransfer,
  formatTransferBytes,
  fromBase64Url,
  getCommonRootDirectory,
  hydrateUploadSource,
  isAbortLike,
  parallelLimit,
  prepareSources,
  recoverInterruptedTransfers,
  throwIfAborted,
  toArrayBuffer,
}

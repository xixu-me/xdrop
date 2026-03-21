/**
 * IndexedDB persistence for local transfer state and resumable source files.
 */

import { openDB } from 'idb'

import type { ManifestFileEntry } from '@/lib/api/types'

/** LocalTransferStatus represents sender-side browser state, not the public API state. */
export type LocalTransferStatus =
  | 'draft'
  | 'preparing'
  | 'uploading'
  | 'paused'
  | 'ready'
  | 'failed'
  | 'deleted'

/** LocalTransferRecord stores everything this browser needs to resume and manage a transfer. */
export type LocalTransferRecord = {
  id: string
  displayName: string
  createdAt: string
  expiresAt: string
  status: LocalTransferStatus
  shareUrl?: string
  manageToken: string
  linkKeyBase64Url: string
  rootKeyBase64Url: string
  wrappedRootKey?: string
  metadataStrippingEnabled: boolean
  clearLocalSecretsOnReady: boolean
  localManagementCleared: boolean
  totalFiles: number
  totalBytes: number
  uploadedBytes: number
  lastError?: string | undefined
  sourcePersisted: boolean
  files: ManifestFileEntry[]
}

/** PersistedSourceStorage identifies where a staged source file lives locally. */
export type PersistedSourceStorage = 'opfs' | 'indexeddb'

/** PersistedSourceRecord describes one locally stored source file for resume support. */
export type PersistedSourceRecord = {
  key: string
  transferId: string
  fileId: string
  relativePath: string
  storage: PersistedSourceStorage
  file?: Blob
  opfsPath?: string
  name: string
  type: string
  lastModified: number
  size: number
}

const databasePromise = openDB('xdrop-local', 2, {
  upgrade(database) {
    if (!database.objectStoreNames.contains('transfers')) {
      const transfers = database.createObjectStore('transfers', { keyPath: 'id' })
      transfers.createIndex('status', 'status')
    }

    if (!database.objectStoreNames.contains('sources')) {
      database.createObjectStore('sources', { keyPath: 'key' })
    }
  },
})

/** listTransfers returns every locally remembered transfer in this browser. */
export async function listTransfers() {
  return (await databasePromise).getAll('transfers') as Promise<LocalTransferRecord[]>
}

/** getTransfer loads one local transfer record by ID. */
export async function getTransfer(id: string) {
  return (await databasePromise).get('transfers', id) as Promise<LocalTransferRecord | undefined>
}

/** putTransfer upserts a local transfer record. */
export async function putTransfer(record: LocalTransferRecord) {
  await (await databasePromise).put('transfers', record)
}

/** deleteTransfer removes a local transfer and any persisted source files tied to it. */
export async function deleteTransfer(id: string) {
  const database = await databasePromise
  const transaction = database.transaction('transfers', 'readwrite')
  await transaction.store.delete(id)
  await transaction.done
  await deleteSourcesForTransfer(id)
}

/** putSources upserts a batch of persisted source file records. */
export async function putSources(records: PersistedSourceRecord[]) {
  const database = await databasePromise
  const transaction = database.transaction('sources', 'readwrite')
  for (const record of records) {
    await transaction.store.put(record)
  }
  await transaction.done
}

/** getSourcesForTransfer scans the source store for all files owned by a transfer. */
export async function getSourcesForTransfer(transferId: string) {
  const database = await databasePromise
  const transaction = database.transaction('sources', 'readonly')
  const results: PersistedSourceRecord[] = []
  let cursor = await transaction.store.openCursor()
  while (cursor) {
    if (cursor.value.transferId === transferId) {
      results.push(cursor.value as PersistedSourceRecord)
    }
    cursor = await cursor.continue()
  }
  await transaction.done
  return results
}

/** deleteSourcesForTransfer removes every persisted source record for a transfer. */
export async function deleteSourcesForTransfer(transferId: string) {
  const database = await databasePromise
  const transaction = database.transaction('sources', 'readwrite')
  let cursor = await transaction.store.openCursor()
  while (cursor) {
    if (cursor.value.transferId === transferId) {
      await cursor.delete()
    }
    cursor = await cursor.continue()
  }
  await transaction.done
}

/** deleteSourcesByKeys removes a known subset of persisted source records. */
export async function deleteSourcesByKeys(keys: string[]) {
  if (keys.length === 0) {
    return
  }

  const database = await databasePromise
  const transaction = database.transaction('sources', 'readwrite')
  for (const key of keys) {
    await transaction.store.delete(key)
  }
  await transaction.done
}

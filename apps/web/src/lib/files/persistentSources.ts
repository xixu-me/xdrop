/**
 * Local source-file persistence used to resume uploads after refreshes or restarts.
 */

import type { PersistedSourceRecord } from '@/lib/indexeddb/db'

type FileSystemWriteChunk =
  | BufferSource
  | Blob
  | string
  | {
      type: 'write'
      position?: number
      data: BufferSource | Blob | string
    }
  | {
      type: 'seek'
      position: number
    }
  | {
      type: 'truncate'
      size: number
    }

type FileSystemWritableLike = WritableStream<Uint8Array> & {
  write: (data: FileSystemWriteChunk) => Promise<void>
  close: () => Promise<void>
  abort: (reason?: unknown) => Promise<void>
}

type FileSystemFileHandleLike = {
  getFile: () => Promise<File>
  createWritable: (options?: { keepExistingData?: boolean }) => Promise<FileSystemWritableLike>
}

type FileSystemDirectoryHandleLike = {
  getDirectoryHandle: (
    name: string,
    options?: { create?: boolean },
  ) => Promise<FileSystemDirectoryHandleLike>
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<FileSystemFileHandleLike>
  removeEntry: (name: string, options?: { recursive?: boolean }) => Promise<void>
}

type StorageWithDirectory = StorageManager & {
  getDirectory?: () => Promise<FileSystemDirectoryHandleLike>
}

const OPFS_ROOT = 'xdrop-sources'

/** supportsOpfsSourcePersistence detects whether the browser exposes OPFS storage APIs. */
export function supportsOpfsSourcePersistence() {
  return (
    typeof navigator !== 'undefined' &&
    typeof (navigator.storage as StorageWithDirectory | undefined)?.getDirectory === 'function'
  )
}

/** persistSourceToOpfs writes a source file into OPFS and returns its metadata record. */
export async function persistSourceToOpfs(args: {
  transferId: string
  fileId: string
  relativePath: string
  file: File
}): Promise<PersistedSourceRecord | null> {
  const transferDirectory = await getTransferDirectory(args.transferId, true)
  if (!transferDirectory) {
    return null
  }

  const filename = `${args.fileId}.bin`
  const fileHandle = await transferDirectory.getFileHandle(filename, { create: true })
  await writeFileToHandle(args.file, fileHandle)

  return {
    key: `${args.fileId}:source`,
    transferId: args.transferId,
    fileId: args.fileId,
    relativePath: args.relativePath,
    storage: 'opfs',
    opfsPath: `${args.transferId}/${filename}`,
    name: args.file.name,
    type: args.file.type,
    lastModified: args.file.lastModified,
    size: args.file.size,
  }
}

/** createIndexedDbSourceRecord stores small files inline as a fallback persistence record. */
export function createIndexedDbSourceRecord(args: {
  transferId: string
  fileId: string
  relativePath: string
  file: File
}): PersistedSourceRecord {
  return {
    key: `${args.fileId}:source`,
    transferId: args.transferId,
    fileId: args.fileId,
    relativePath: args.relativePath,
    storage: 'indexeddb',
    file: args.file,
    name: args.file.name,
    type: args.file.type,
    lastModified: args.file.lastModified,
    size: args.file.size,
  }
}

/** loadPersistedSourceFile recreates a File object from either IndexedDB or OPFS storage. */
export async function loadPersistedSourceFile(record: PersistedSourceRecord) {
  if (record.storage !== 'opfs') {
    if (!record.file) {
      return null
    }
    return new File([record.file], record.name, {
      type: record.type,
      lastModified: record.lastModified,
    })
  }

  const fileHandle = await getOpfsFileHandle(record)
  if (!fileHandle) {
    return null
  }

  try {
    const file = await fileHandle.getFile()
    return new File([file], record.name, {
      type: record.type,
      lastModified: record.lastModified,
    })
  } catch {
    return null
  }
}

/** deletePersistedTransferSources removes any OPFS files belonging to a finished transfer. */
export async function deletePersistedTransferSources(transferId: string) {
  const rootDirectory = await getSourcesRoot(false)
  if (!rootDirectory) {
    return
  }

  try {
    await rootDirectory.removeEntry(transferId, { recursive: true })
  } catch {
    // Browsers may already have evicted or removed the directory.
  }
}

/** writeFileToHandle streams a File into an OPFS handle without buffering it all in memory. */
async function writeFileToHandle(file: File, fileHandle: FileSystemFileHandleLike) {
  const writable = await fileHandle.createWritable({ keepExistingData: false })
  const reader = file.stream().getReader()

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      if (value) {
        await writable.write(value)
      }
    }
    await writable.close()
  } catch (error) {
    await writable.abort(error)
    throw error
  } finally {
    reader.releaseLock()
  }
}

async function getOpfsFileHandle(record: PersistedSourceRecord) {
  if (!record.opfsPath) {
    return null
  }

  const [transferId, filename] = record.opfsPath.split('/')
  if (!transferId || !filename) {
    return null
  }

  const directory = await getTransferDirectory(transferId, false)
  if (!directory) {
    return null
  }

  try {
    return await directory.getFileHandle(filename)
  } catch {
    return null
  }
}

async function getTransferDirectory(transferId: string, create: boolean) {
  const rootDirectory = await getSourcesRoot(create)
  if (!rootDirectory) {
    return null
  }

  try {
    return await rootDirectory.getDirectoryHandle(transferId, { create })
  } catch {
    return null
  }
}

async function getSourcesRoot(create: boolean) {
  if (typeof navigator === 'undefined') {
    return null
  }

  const directory = await (navigator.storage as StorageWithDirectory | undefined)?.getDirectory?.()
  if (!directory) {
    return null
  }

  try {
    return await directory.getDirectoryHandle(OPFS_ROOT, { create })
  } catch {
    return null
  }
}

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PersistedSourceRecord } from '@/lib/indexeddb/db'
import {
  createIndexedDbSourceRecord,
  deletePersistedTransferSources,
  loadPersistedSourceFile,
  persistSourceToOpfs,
  supportsOpfsSourcePersistence,
} from './persistentSources'

const originalStorage = navigator.storage

function stubStorage(value: unknown) {
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value,
  })
}

function createOpfsHarness() {
  const writeChunks: Uint8Array[] = []
  const writable = {
    abort: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    write: vi.fn(async (chunk: Uint8Array) => {
      writeChunks.push(chunk)
    }),
  }
  const fileHandle = {
    createWritable: vi.fn(async () => writable),
    getFile: vi.fn(async () => new File(['payload'], 'stored.bin', { lastModified: 77 })),
  }
  const transferDirectory = {
    getDirectoryHandle: vi.fn(),
    getFileHandle: vi.fn(async () => fileHandle),
    removeEntry: vi.fn(async () => {}),
  }
  const rootDirectory = {
    getDirectoryHandle: vi.fn(async () => transferDirectory),
    getFileHandle: vi.fn(),
    removeEntry: vi.fn(async () => {}),
  }
  const storage = {
    getDirectory: vi.fn(async () => ({
      getDirectoryHandle: vi.fn(async () => rootDirectory),
      getFileHandle: vi.fn(),
      removeEntry: vi.fn(async () => {}),
    })),
  }

  return { fileHandle, rootDirectory, storage, transferDirectory, writable, writeChunks }
}

describe('persistentSources', () => {
  afterEach(() => {
    stubStorage(originalStorage)
  })

  it('detects OPFS support from navigator.storage', () => {
    stubStorage({})
    expect(supportsOpfsSourcePersistence()).toBe(false)

    stubStorage({ getDirectory: vi.fn() })
    expect(supportsOpfsSourcePersistence()).toBe(true)
  })

  it('creates indexeddb-backed source records', () => {
    const file = new File(['payload'], 'example.txt', { type: 'text/plain', lastModified: 12 })

    expect(
      createIndexedDbSourceRecord({
        file,
        fileId: 'file-1',
        relativePath: 'docs/example.txt',
        transferId: 'transfer-1',
      }),
    ).toMatchObject({
      file,
      fileId: 'file-1',
      key: 'file-1:source',
      name: 'example.txt',
      relativePath: 'docs/example.txt',
      storage: 'indexeddb',
      transferId: 'transfer-1',
    })
  })

  it('persists OPFS-backed files and returns source metadata', async () => {
    const harness = createOpfsHarness()
    stubStorage(harness.storage)

    const file = Object.assign(
      new File(['hello'], 'draft.txt', { type: 'text/plain', lastModified: 12 }),
      {
        stream: () =>
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('hello'))
              controller.close()
            },
          }),
      },
    )
    const record = await persistSourceToOpfs({
      file,
      fileId: 'file-1',
      relativePath: 'draft.txt',
      transferId: 'transfer-1',
    })

    expect(record).toMatchObject({
      fileId: 'file-1',
      key: 'file-1:source',
      name: 'draft.txt',
      opfsPath: 'transfer-1/file-1.bin',
      relativePath: 'draft.txt',
      storage: 'opfs',
      transferId: 'transfer-1',
    })
    expect(harness.fileHandle.createWritable).toHaveBeenCalledWith({ keepExistingData: false })
    expect(harness.writable.write).toHaveBeenCalled()
    expect(harness.writable.close).toHaveBeenCalled()
    expect(Buffer.from(harness.writeChunks[0] ?? [])).toEqual(Buffer.from('hello'))
  })

  it('returns null when OPFS storage is unavailable', async () => {
    stubStorage({})

    await expect(
      persistSourceToOpfs({
        file: new File(['hello'], 'draft.txt'),
        fileId: 'file-1',
        relativePath: 'draft.txt',
        transferId: 'transfer-1',
      }),
    ).resolves.toBeNull()
  })

  it('restores indexeddb-backed files and handles missing files', async () => {
    const file = new File(['payload'], 'example.txt', { type: 'text/plain', lastModified: 5 })

    await expect(
      loadPersistedSourceFile({
        file,
        fileId: 'file-1',
        key: 'file-1:source',
        lastModified: 99,
        name: 'renamed.txt',
        relativePath: 'renamed.txt',
        size: 7,
        storage: 'indexeddb',
        transferId: 'transfer-1',
        type: 'text/plain',
      }),
    ).resolves.toMatchObject({
      lastModified: 99,
      name: 'renamed.txt',
      type: 'text/plain',
    })

    await expect(
      loadPersistedSourceFile({
        fileId: 'file-1',
        key: 'file-1:source',
        lastModified: 99,
        name: 'renamed.txt',
        relativePath: 'renamed.txt',
        size: 7,
        storage: 'indexeddb',
        transferId: 'transfer-1',
        type: 'text/plain',
      }),
    ).resolves.toBeNull()
  })

  it('restores the original file name for OPFS-backed sources', async () => {
    const harness = createOpfsHarness()
    harness.fileHandle.getFile.mockResolvedValueOnce(
      new File(['payload'], '4d9c9b3f.bin', {
        type: 'application/octet-stream',
        lastModified: 99,
      }),
    )

    stubStorage(harness.storage)

    const record: PersistedSourceRecord = {
      key: 'draft:source',
      transferId: '__upload-selection__',
      fileId: 'draft',
      relativePath: 'Desktop/Antigravity.exe',
      storage: 'opfs',
      opfsPath: '__upload-selection__/4d9c9b3f.bin',
      name: 'Antigravity.exe',
      type: 'application/octet-stream',
      lastModified: 42,
      size: 7,
    }

    const restoredFile = await loadPersistedSourceFile(record)

    expect(restoredFile?.name).toBe('Antigravity.exe')
    expect(restoredFile?.lastModified).toBe(42)
    expect(await restoredFile?.text()).toBe('payload')
  })

  it('returns null for invalid OPFS paths or missing file handles', async () => {
    const harness = createOpfsHarness()
    stubStorage(harness.storage)

    await expect(
      loadPersistedSourceFile({
        fileId: 'file-1',
        key: 'file-1:source',
        lastModified: 99,
        name: 'renamed.txt',
        relativePath: 'renamed.txt',
        size: 7,
        storage: 'opfs',
        transferId: 'transfer-1',
        type: 'text/plain',
      }),
    ).resolves.toBeNull()

    harness.transferDirectory.getFileHandle.mockRejectedValueOnce(new Error('missing'))
    await expect(
      loadPersistedSourceFile({
        fileId: 'file-1',
        key: 'file-1:source',
        lastModified: 99,
        name: 'renamed.txt',
        opfsPath: 'transfer-1/file-1.bin',
        relativePath: 'renamed.txt',
        size: 7,
        storage: 'opfs',
        transferId: 'transfer-1',
        type: 'text/plain',
      }),
    ).resolves.toBeNull()
  })

  it('returns null when OPFS file reads fail', async () => {
    const harness = createOpfsHarness()
    harness.fileHandle.getFile.mockRejectedValueOnce(new Error('broken'))
    stubStorage(harness.storage)

    await expect(
      loadPersistedSourceFile({
        fileId: 'file-1',
        key: 'file-1:source',
        lastModified: 99,
        name: 'renamed.txt',
        opfsPath: 'transfer-1/file-1.bin',
        relativePath: 'renamed.txt',
        size: 7,
        storage: 'opfs',
        transferId: 'transfer-1',
        type: 'text/plain',
      }),
    ).resolves.toBeNull()
  })

  it('deletes persisted transfer sources when the transfer directory exists', async () => {
    const harness = createOpfsHarness()
    stubStorage(harness.storage)

    await deletePersistedTransferSources('transfer-1')

    expect(harness.rootDirectory.removeEntry).toHaveBeenCalledWith('transfer-1', {
      recursive: true,
    })
  })

  it('ignores missing OPFS roots and removal failures', async () => {
    stubStorage({})
    await expect(deletePersistedTransferSources('transfer-1')).resolves.toBeUndefined()

    const harness = createOpfsHarness()
    harness.rootDirectory.removeEntry.mockRejectedValueOnce(new Error('gone'))
    stubStorage(harness.storage)

    await expect(deletePersistedTransferSources('transfer-1')).resolves.toBeUndefined()
  })

  it('aborts the writable stream when persisting a file fails mid-write', async () => {
    const harness = createOpfsHarness()
    const writeError = new Error('disk full')
    harness.writable.write.mockRejectedValueOnce(writeError)
    stubStorage(harness.storage)

    const file = Object.assign(
      new File(['hello'], 'draft.txt', { type: 'text/plain', lastModified: 12 }),
      {
        stream: () =>
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('hello'))
              controller.close()
            },
          }),
      },
    )

    await expect(
      persistSourceToOpfs({
        file,
        fileId: 'file-1',
        relativePath: 'draft.txt',
        transferId: 'transfer-1',
      }),
    ).rejects.toThrow('disk full')

    expect(harness.writable.abort).toHaveBeenCalledWith(writeError)
    expect(harness.writable.close).not.toHaveBeenCalled()
  })

  it('returns null for malformed OPFS paths and missing transfer directories', async () => {
    const harness = createOpfsHarness()
    stubStorage(harness.storage)

    await expect(
      loadPersistedSourceFile({
        fileId: 'file-1',
        key: 'file-1:source',
        lastModified: 99,
        name: 'renamed.txt',
        opfsPath: 'transfer-1',
        relativePath: 'renamed.txt',
        size: 7,
        storage: 'opfs',
        transferId: 'transfer-1',
        type: 'text/plain',
      }),
    ).resolves.toBeNull()

    harness.rootDirectory.getDirectoryHandle.mockRejectedValueOnce(new Error('missing-dir'))

    await expect(
      loadPersistedSourceFile({
        fileId: 'file-1',
        key: 'file-1:source',
        lastModified: 99,
        name: 'renamed.txt',
        opfsPath: 'transfer-1/file-1.bin',
        relativePath: 'renamed.txt',
        size: 7,
        storage: 'opfs',
        transferId: 'transfer-1',
        type: 'text/plain',
      }),
    ).resolves.toBeNull()
  })
})

import {
  DEFAULT_CHUNK_SIZE,
  MAX_FILE_COUNT,
  MAX_TRANSFER_BYTES,
  SOURCE_BLOB_PERSIST_LIMIT,
} from '@xdrop/shared'
import { render } from '@testing-library/react'
import { createElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ManifestFileEntry } from '@/lib/api/types'
import type { LocalTransferRecord, PersistedSourceRecord } from '@/lib/indexeddb/db'

const {
  createIndexedDbSourceRecordMock,
  deleteSourcesForTransferMock,
  generateSecretMock,
  listTransfersMock,
  loadPersistedSourceFileMock,
  persistSourceToOpfsMock,
  putTransferMock,
  stripMetadataMock,
  supportsOpfsSourcePersistenceMock,
} = vi.hoisted(() => ({
  createIndexedDbSourceRecordMock: vi.fn(
    (args: { file: File; fileId: string; relativePath: string; transferId: string }) => ({
      file: args.file,
      fileId: args.fileId,
      key: `${args.fileId}:source`,
      lastModified: args.file.lastModified,
      name: args.file.name,
      relativePath: args.relativePath,
      size: args.file.size,
      storage: 'indexeddb' as const,
      transferId: args.transferId,
      type: args.file.type,
    }),
  ),
  deleteSourcesForTransferMock: vi.fn(async () => {}),
  generateSecretMock: vi.fn(
    async (length: number) => new Uint8Array(Array.from({ length }, (_, i) => i + 1)),
  ),
  listTransfersMock: vi.fn(async (): Promise<LocalTransferRecord[]> => []),
  loadPersistedSourceFileMock: vi.fn(
    async (source: PersistedSourceRecord): Promise<File | null> => {
      void source
      return new File(['payload'], 'restored.txt')
    },
  ),
  persistSourceToOpfsMock: vi.fn(async (): Promise<PersistedSourceRecord | null> => null),
  putTransferMock: vi.fn(async () => {}),
  stripMetadataMock: vi.fn(async (file: File) => ({ file, stripped: false })),
  supportsOpfsSourcePersistenceMock: vi.fn(() => false),
}))

vi.mock('@/lib/crypto/envelope', () => ({
  generateSecret: generateSecretMock,
}))

vi.mock('@/lib/files/metadata', () => ({
  stripMetadata: stripMetadataMock,
}))

vi.mock('@/lib/files/persistentSources', () => ({
  createIndexedDbSourceRecord: createIndexedDbSourceRecordMock,
  deletePersistedTransferSources: vi.fn(async () => {}),
  loadPersistedSourceFile: loadPersistedSourceFileMock,
  persistSourceToOpfs: persistSourceToOpfsMock,
  supportsOpfsSourcePersistence: supportsOpfsSourcePersistenceMock,
}))

vi.mock('@/lib/workers/cryptoClient', () => ({
  cryptoWorker: {
    decryptChunk: vi.fn(),
    decryptManifest: vi.fn(),
    encryptChunk: vi.fn(),
    encryptManifest: vi.fn(),
    unwrapRootKey: vi.fn(),
    wrapRootKey: vi.fn(),
  },
}))

vi.mock('@/lib/indexeddb/db', () => ({
  deleteSourcesForTransfer: deleteSourcesForTransferMock,
  getSourcesForTransfer: vi.fn(async () => []),
  getTransfer: vi.fn(async () => undefined),
  listTransfers: listTransfersMock,
  putSources: vi.fn(async () => {}),
  putTransfer: putTransferMock,
}))

import { __test__, defaultTransferName, useTransfers } from './TransferContext'

function makeSelectedSource(relativePath: string, size = 7, type = 'text/plain') {
  const name = relativePath.split('/').at(-1) ?? relativePath
  return {
    file: new File([new Uint8Array(size)], name, { lastModified: 2, type }),
    relativePath,
  }
}

function makeManifestFile(overrides: Partial<ManifestFileEntry> = {}): ManifestFileEntry {
  return {
    chunkSize: 4,
    ciphertextSizes: [20, 20],
    fileId: 'file-1',
    metadataStripped: false,
    mimeType: 'text/plain',
    modifiedAt: 2,
    name: 'example.txt',
    noncePrefix: 'AQIDBA',
    plaintextSize: 8,
    relativePath: 'docs/example.txt',
    totalChunks: 2,
    ...overrides,
  }
}

function makeTransferRecord(
  status: LocalTransferRecord['status'],
  overrides: Partial<LocalTransferRecord> = {},
): LocalTransferRecord {
  return {
    clearLocalSecretsOnReady: false,
    createdAt: '2026-03-19T08:00:00.000Z',
    displayName: 'Example',
    expiresAt: '2026-03-20T08:00:00.000Z',
    files: [makeManifestFile()],
    id: 't1',
    linkKeyBase64Url: 'AQID',
    localManagementCleared: false,
    manageToken: 'manage-token',
    metadataStrippingEnabled: false,
    rootKeyBase64Url: 'AQID',
    shareUrl: 'https://example.com/t/t1',
    sourcePersisted: true,
    status,
    totalBytes: 40,
    totalFiles: 1,
    uploadedBytes: 0,
    ...overrides,
  }
}

describe('TransferContext helpers', () => {
  beforeEach(() => {
    createIndexedDbSourceRecordMock.mockClear()
    deleteSourcesForTransferMock.mockClear()
    generateSecretMock.mockClear()
    listTransfersMock.mockReset()
    listTransfersMock.mockResolvedValue([])
    loadPersistedSourceFileMock.mockReset()
    loadPersistedSourceFileMock.mockImplementation(
      async (source: PersistedSourceRecord): Promise<File | null> => {
        void source
        return new File(['payload'], 'restored.txt')
      },
    )
    persistSourceToOpfsMock.mockReset()
    persistSourceToOpfsMock.mockResolvedValue(null)
    putTransferMock.mockReset()
    putTransferMock.mockResolvedValue(undefined)
    stripMetadataMock.mockReset()
    stripMetadataMock.mockImplementation(async (file: File) => ({ file, stripped: false }))
    supportsOpfsSourcePersistenceMock.mockReset()
    supportsOpfsSourcePersistenceMock.mockReturnValue(false)
  })

  it('prepares sources using indexeddb persistence', async () => {
    const prepared = await __test__.prepareSources(
      'transfer-1',
      [makeSelectedSource('docs/example.txt', 5, '')],
      DEFAULT_CHUNK_SIZE,
      false,
    )

    expect(stripMetadataMock).toHaveBeenCalledWith(expect.any(File), false)
    expect(createIndexedDbSourceRecordMock).toHaveBeenCalledTimes(1)
    expect(prepared.files).toEqual([
      expect.objectContaining({
        mimeType: 'application/octet-stream',
        name: 'example.txt',
        plaintextSize: 5,
        relativePath: 'docs/example.txt',
      }),
    ])
    expect(prepared.persistedSources).toHaveLength(1)
    expect(prepared.totalCiphertextBytes).toBe(21)
  })

  it('prefers OPFS persistence when available', async () => {
    supportsOpfsSourcePersistenceMock.mockReturnValueOnce(true)
    persistSourceToOpfsMock.mockResolvedValueOnce({
      fileId: 'file-opfs',
      key: 'file-opfs:source',
      lastModified: 2,
      name: 'image.png',
      opfsPath: 'transfer-1/file-opfs.bin',
      relativePath: 'images/image.png',
      size: 9,
      storage: 'opfs',
      transferId: 'transfer-1',
      type: 'image/png',
    } satisfies PersistedSourceRecord)
    stripMetadataMock.mockResolvedValueOnce({
      file: new File(['cleaned'], 'image.png', { lastModified: 4, type: 'image/png' }),
      stripped: true,
    })

    const prepared = await __test__.prepareSources(
      'transfer-1',
      [makeSelectedSource('images/image.png', 9, 'image/png')],
      DEFAULT_CHUNK_SIZE,
      true,
    )

    expect(persistSourceToOpfsMock).toHaveBeenCalledTimes(1)
    expect(createIndexedDbSourceRecordMock).not.toHaveBeenCalled()
    expect(prepared.files[0]).toEqual(
      expect.objectContaining({
        metadataStripped: true,
        mimeType: 'image/png',
      }),
    )
  })

  it('rejects oversized or over-limit source selections', async () => {
    await expect(
      __test__.prepareSources(
        'transfer-1',
        Array.from({ length: MAX_FILE_COUNT + 1 }, (_, index) =>
          makeSelectedSource(`docs/file-${index}.txt`),
        ),
        DEFAULT_CHUNK_SIZE,
        false,
      ),
    ).rejects.toThrow(`This selection has ${MAX_FILE_COUNT + 1} items.`)

    await expect(
      __test__.prepareSources(
        'transfer-1',
        [makeSelectedSource('too-large.bin', SOURCE_BLOB_PERSIST_LIMIT + 1)],
        DEFAULT_CHUNK_SIZE,
        false,
      ),
    ).rejects.toThrow('To keep uploads going after refresh')

    await expect(
      __test__.prepareSources(
        'transfer-1',
        [makeSelectedSource('too-large.bin', MAX_TRANSFER_BYTES)],
        DEFAULT_CHUNK_SIZE,
        false,
      ),
    ).rejects.toThrow('The limit is 256 MiB per transfer.')
  })

  it('builds manifests, chunk tasks, and finalized transfer records', async () => {
    const record = makeTransferRecord('uploading', {
      clearLocalSecretsOnReady: true,
      files: [
        makeManifestFile(),
        makeManifestFile({
          fileId: 'file-2',
          noncePrefix: 'BQYHCA',
          totalChunks: 1,
        }),
      ],
    })
    const manifest = __test__.buildManifest(record, 'Shared files')
    const tasks = __test__.buildChunkTasks(
      record.files,
      [
        {
          ...makeManifestFile(),
          file: new File(['payload'], 'example.txt'),
          key: 'file-1:source',
          storage: 'indexeddb',
          transferId: 't1',
          type: 'text/plain',
          lastModified: 2,
          size: 8,
        },
      ],
      { 'file-1': [0] },
    )
    const finalized = __test__.finalizeCompletedTransfer(record, 'wrapped-root-key')

    expect(manifest).toMatchObject({
      chunkSize: 4,
      displayName: 'Shared files',
      version: 1,
    })
    expect(tasks).toEqual([
      expect.objectContaining({
        chunkIndex: 1,
        fileId: 'file-1',
        noncePrefix: expect.any(Uint8Array),
      }),
    ])
    expect(finalized).toMatchObject({
      localManagementCleared: true,
      manageToken: '',
      sourcePersisted: false,
      status: 'ready',
      totalBytes: 40,
      uploadedBytes: 40,
    })
    expect(finalized.files).toEqual([])
    expect(finalized.wrappedRootKey).toBeUndefined()
  })

  it('uses default manifest chunk sizes and keeps local controls when privacy mode is off', () => {
    const record = makeTransferRecord('uploading', {
      clearLocalSecretsOnReady: false,
      files: [],
    })

    expect(__test__.buildManifest(record)).toMatchObject({
      chunkSize: DEFAULT_CHUNK_SIZE,
      displayName: 'Example',
      files: [],
    })
    expect(__test__.finalizeCompletedTransfer(record, 'wrapped-root-key')).toMatchObject({
      files: [],
      localManagementCleared: false,
      manageToken: 'manage-token',
      status: 'ready',
      wrappedRootKey: 'wrapped-root-key',
    })
  })

  it('hydrates persisted sources and handles missing files', async () => {
    const source: PersistedSourceRecord = {
      fileId: 'file-1',
      key: 'file-1:source',
      lastModified: 2,
      name: 'restored.txt',
      relativePath: 'restored.txt',
      size: 7,
      storage: 'indexeddb',
      transferId: 'transfer-1',
      type: 'text/plain',
    }

    await expect(__test__.hydrateUploadSource(source)).resolves.toEqual(
      expect.objectContaining({
        file: expect.any(File),
        key: 'file-1:source',
      }),
    )

    loadPersistedSourceFileMock.mockResolvedValueOnce(null)
    await expect(__test__.hydrateUploadSource(source)).resolves.toBeNull()
  })

  it('recovers interrupted transfers and updates only in-flight records', async () => {
    listTransfersMock.mockResolvedValueOnce([
      makeTransferRecord('uploading'),
      makeTransferRecord('paused', {
        id: 't2',
        lastError:
          'This page was closed or refreshed. Upload will continue automatically when you return here in the same browser on this device.',
      }),
      makeTransferRecord('ready', { id: 't3' }),
    ])

    await expect(__test__.recoverInterruptedTransfers()).resolves.toEqual(['t1', 't2'])
    expect(putTransferMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 't1',
        lastError:
          'This page was closed or refreshed. Upload will continue automatically when you return here in the same browser on this device.',
        status: 'paused',
      }),
    )
  })

  it('reports OPFS-specific persistence failures when local storage is unavailable', async () => {
    supportsOpfsSourcePersistenceMock.mockReturnValueOnce(true)
    persistSourceToOpfsMock.mockResolvedValueOnce(null)

    await expect(
      __test__.prepareSources(
        'transfer-1',
        [makeSelectedSource('large.bin', SOURCE_BLOB_PERSIST_LIMIT + 1)],
        DEFAULT_CHUNK_SIZE,
        false,
      ),
    ).rejects.toThrow("This browser couldn't reserve enough local storage")
  })

  it('limits concurrency, formats byte counts, and handles abort helpers', async () => {
    const order: number[] = []
    const results = await __test__.parallelLimit([1, 2, 3], 2, async (value, index) => {
      order.push(index)
      return value * 2
    })

    expect(results.sort()).toEqual([2, 4, 6])
    expect(order.sort()).toEqual([0, 1, 2])
    expect(__test__.formatTransferBytes(999)).toBe('999 B')
    expect(__test__.formatTransferBytes(2048)).toBe('2 KiB')
    expect(__test__.formatTransferBytes(3 * 1024 * 1024)).toBe('3 MiB')
    expect(__test__.formatTransferBytes(3 * 1024 * 1024 * 1024)).toBe('3.0 GiB')

    const runtime = __test__.createRuntimeState()
    runtime.controller = new AbortController()
    __test__.abortRuntime(runtime, 'navigation')
    expect(runtime.abortReason).toBe('navigation')
    expect(runtime.controller.signal.aborted).toBe(true)
    expect(__test__.isAbortLike(new DOMException('aborted', 'AbortError'))).toBe(true)
    expect(__test__.isAbortLike(new Error('boom'))).toBe(false)

    const signalController = new AbortController()
    signalController.abort()
    expect(() => __test__.throwIfAborted(signalController.signal)).toThrow(
      'The operation was aborted.',
    )
    await expect(
      __test__.parallelLimit([1, 2, 3], 2, async (value) => value, signalController.signal),
    ).rejects.toThrow('The operation was aborted.')
    await expect(
      __test__.parallelLimit([1, undefined, 3] as unknown as number[], 2, async (value) => value),
    ).resolves.toEqual([1, 3])
  })

  it('guards manage access, converts buffers, and derives default transfer names', () => {
    expect(() =>
      __test__.ensureManageAccess(makeTransferRecord('ready', { manageToken: '' }), 'blocked'),
    ).toThrow('blocked')

    const slice = __test__.toArrayBuffer(new Uint8Array([1, 2, 3]))
    expect(Array.from(new Uint8Array(slice))).toEqual([1, 2, 3])
    expect(__test__.fromBase64Url('AQIDBA')).toEqual(new Uint8Array([1, 2, 3, 4]))
    expect(__test__.getCommonRootDirectory([makeSelectedSource('folder/photo.png')])).toBe('folder')
    expect(__test__.getCommonRootDirectory([makeSelectedSource('../')])).toBeNull()
    expect(defaultTransferName([])).toBe('Untitled transfer')
    expect(defaultTransferName([makeSelectedSource('folder/photo.png')])).toBe('photo.png')
    expect(
      defaultTransferName([makeSelectedSource('brief.pdf'), makeSelectedSource('notes.txt')]),
    ).toBe('brief.pdf and 1 more item')
  })

  it('throws when the transfer hook is used outside the provider', () => {
    function OrphanProbe() {
      useTransfers()
      return null
    }

    expect(() => render(createElement(OrphanProbe))).toThrow(
      'useTransfers must be used inside a TransferProvider',
    )
  })
})

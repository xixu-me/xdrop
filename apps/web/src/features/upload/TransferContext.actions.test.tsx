import { act, render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ManifestFileEntry } from '@/lib/api/types'
import type { LocalTransferRecord, PersistedSourceRecord } from '@/lib/indexeddb/db'

const {
  completeChunksMock,
  createIndexedDbSourceRecordMock,
  createTransferApiMock,
  createUploadUrlsMock,
  deletePersistedTransferSourcesMock,
  deleteRemoteTransferMock,
  deleteSourcesForTransferMock,
  deleteTransferRecordMock,
  encryptChunkMock,
  encryptManifestMock,
  finalizeTransferMock,
  generateSecretMock,
  getSourcesForTransferMock,
  getTransferMock,
  listTransfersMock,
  loadPersistedSourceFileMock,
  putSourcesMock,
  persistSourceToOpfsMock,
  putTransferMock,
  registerFilesMock,
  resumeTransferMock,
  sourcesStore,
  supportsOpfsSourcePersistenceMock,
  transfersStore,
  updateTransferMock,
  uploadManifestMock,
  wrapRootKeyMock,
} = vi.hoisted(() => {
  const transferMap = new Map<string, LocalTransferRecord>()
  const sourceMap = new Map<string, PersistedSourceRecord>()

  return {
    transfersStore: transferMap,
    sourcesStore: sourceMap,
    completeChunksMock: vi.fn(async () => {}),
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
    createTransferApiMock: vi.fn(async () => ({
      expiresAt: '2026-03-21T08:00:00.000Z',
      manageToken: 'manage-token',
      transferId: 't-created',
      uploadConfig: { chunkSize: 8 },
    })),
    createUploadUrlsMock: vi.fn(
      async (
        _transferId: string,
        _manageToken: string,
        chunks: Array<{ fileId: string; chunkIndex: number }>,
      ) =>
        chunks.map((chunk) => ({
          ...chunk,
          url: `https://upload.test/${chunk.fileId}/${chunk.chunkIndex}`,
        })),
    ),
    deletePersistedTransferSourcesMock: vi.fn(async () => {}),
    deleteRemoteTransferMock: vi.fn(async () => {}),
    deleteSourcesForTransferMock: vi.fn(async (transferId: string) => {
      for (const [key, source] of sourceMap.entries()) {
        if (source.transferId === transferId) {
          sourceMap.delete(key)
        }
      }
    }),
    deleteTransferRecordMock: vi.fn(async (transferId: string) => {
      transferMap.delete(transferId)
    }),
    encryptChunkMock: vi.fn(async ({ plaintext }: { plaintext: Uint8Array }) => ({
      checksumHex: 'checksum',
      ciphertext: new Uint8Array(plaintext.byteLength + 16).fill(7),
    })),
    encryptManifestMock: vi.fn(async () => new Uint8Array([1, 2, 3])),
    finalizeTransferMock: vi.fn(async () => {}),
    generateSecretMock: vi.fn(
      async (length: number) => new Uint8Array(Array.from({ length }, (_, index) => index + 1)),
    ),
    getSourcesForTransferMock: vi.fn(async (transferId: string) =>
      Array.from(sourceMap.values()).filter((source) => source.transferId === transferId),
    ),
    getTransferMock: vi.fn(async (transferId: string) => transferMap.get(transferId)),
    listTransfersMock: vi.fn(async () => Array.from(transferMap.values())),
    loadPersistedSourceFileMock: vi.fn(
      async (source: PersistedSourceRecord) => source.file ?? null,
    ),
    persistSourceToOpfsMock: vi.fn<
      (args: {
        transferId: string
        fileId: string
        relativePath: string
        file: File
      }) => Promise<PersistedSourceRecord | null>
    >(async () => null),
    putSourcesMock: vi.fn(async (records: PersistedSourceRecord[]) => {
      for (const record of records) {
        sourceMap.set(record.key, record)
      }
    }),
    putTransferMock: vi.fn(async (record: LocalTransferRecord) => {
      transferMap.set(record.id, record)
    }),
    registerFilesMock: vi.fn(async () => {}),
    resumeTransferMock: vi.fn(async () => ({ uploadedChunks: {} })),
    supportsOpfsSourcePersistenceMock: vi.fn(() => false),
    updateTransferMock: vi.fn(async () => {}),
    uploadManifestMock: vi.fn(async () => {}),
    wrapRootKeyMock: vi.fn(async () => 'wrapped-root'),
  }
})

vi.mock('@/lib/api/client', () => ({
  apiClient: {
    completeChunks: completeChunksMock,
    createDownloadUrls: vi.fn(),
    createTransfer: createTransferApiMock,
    createUploadUrls: createUploadUrlsMock,
    deleteTransfer: deleteRemoteTransferMock,
    finalizeTransfer: finalizeTransferMock,
    getManageTransfer: vi.fn(),
    getPublicTransfer: vi.fn(),
    registerFiles: registerFilesMock,
    resumeTransfer: resumeTransferMock,
    updateTransfer: updateTransferMock,
    uploadManifest: uploadManifestMock,
  },
}))

vi.mock('@/lib/crypto/envelope', () => ({
  generateSecret: generateSecretMock,
}))

vi.mock('@/lib/files/metadata', () => ({
  stripMetadata: vi.fn(async (file: File) => ({ file, stripped: false })),
}))

vi.mock('@/lib/files/persistentSources', () => ({
  createIndexedDbSourceRecord: createIndexedDbSourceRecordMock,
  deletePersistedTransferSources: deletePersistedTransferSourcesMock,
  loadPersistedSourceFile: loadPersistedSourceFileMock,
  persistSourceToOpfs: persistSourceToOpfsMock,
  supportsOpfsSourcePersistence: supportsOpfsSourcePersistenceMock,
}))

vi.mock('@/lib/indexeddb/db', () => ({
  deleteSourcesByKeys: vi.fn(async () => {}),
  deleteSourcesForTransfer: deleteSourcesForTransferMock,
  deleteTransfer: deleteTransferRecordMock,
  getSourcesForTransfer: getSourcesForTransferMock,
  getTransfer: getTransferMock,
  listTransfers: listTransfersMock,
  putSources: putSourcesMock,
  putTransfer: putTransferMock,
}))

vi.mock('@/lib/workers/cryptoClient', () => ({
  cryptoWorker: {
    decryptChunk: vi.fn(),
    decryptManifest: vi.fn(),
    encryptChunk: encryptChunkMock,
    encryptManifest: encryptManifestMock,
    unwrapRootKey: vi.fn(),
    wrapRootKey: wrapRootKeyMock,
  },
}))

import { TransferProvider, useTransfers } from './TransferContext'

let latestContext: ReturnType<typeof useTransfers> | null = null

function ContextProbe() {
  const value = useTransfers()

  useEffect(() => {
    latestContext = value
  }, [value])

  return (
    <div>
      {value.transfers.map((transfer) => (
        <p key={transfer.id}>
          {transfer.id}:{transfer.status}:{transfer.lastError ?? 'none'}
        </p>
      ))}
    </div>
  )
}

function makeSelectedSource(relativePath: string, contents = 'hello') {
  const name = relativePath.split('/').at(-1) ?? relativePath
  return {
    file: new File([contents], name, { lastModified: 2, type: 'text/plain' }),
    relativePath,
  }
}

function makeFileEntry(overrides: Partial<ManifestFileEntry> = {}): ManifestFileEntry {
  return {
    chunkSize: 8,
    ciphertextSizes: [21],
    fileId: 'file-1',
    metadataStripped: false,
    mimeType: 'text/plain',
    modifiedAt: 2,
    name: 'example.txt',
    noncePrefix: 'AQIDBA',
    plaintextSize: 5,
    relativePath: 'docs/example.txt',
    totalChunks: 1,
    ...overrides,
  }
}

function makeTransferRecord(
  status: LocalTransferRecord['status'],
  overrides: Partial<LocalTransferRecord> = {},
): LocalTransferRecord {
  return {
    clearLocalSecretsOnReady: false,
    createdAt: '2026-03-20T08:00:00.000Z',
    displayName: 'Example transfer',
    expiresAt: '2026-03-21T08:00:00.000Z',
    files: [makeFileEntry()],
    id: 't1',
    linkKeyBase64Url: 'AQIDBA',
    localManagementCleared: false,
    manageToken: 'manage-token',
    metadataStrippingEnabled: false,
    rootKeyBase64Url: 'AQIDBA',
    shareUrl: 'https://example.com/t/t1',
    sourcePersisted: true,
    status,
    totalBytes: 21,
    totalFiles: 1,
    uploadedBytes: 0,
    ...overrides,
  }
}

function makeSourceRecord(
  transferId: string,
  overrides: Partial<PersistedSourceRecord> = {},
): PersistedSourceRecord {
  return {
    file: new File(['hello'], 'example.txt', { lastModified: 2, type: 'text/plain' }),
    fileId: 'file-1',
    key: `${transferId}:file-1`,
    lastModified: 2,
    name: 'example.txt',
    relativePath: 'docs/example.txt',
    size: 5,
    storage: 'indexeddb',
    transferId,
    type: 'text/plain',
    ...overrides,
  }
}

function renderProvider() {
  latestContext = null
  return render(
    <TransferProvider>
      <ContextProbe />
    </TransferProvider>,
  )
}

describe('TransferProvider actions', () => {
  beforeEach(() => {
    latestContext = null
    transfersStore.clear()
    sourcesStore.clear()

    completeChunksMock.mockClear()
    createIndexedDbSourceRecordMock.mockClear()
    createTransferApiMock.mockReset()
    createTransferApiMock.mockResolvedValue({
      expiresAt: '2026-03-21T08:00:00.000Z',
      manageToken: 'manage-token',
      transferId: 't-created',
      uploadConfig: { chunkSize: 8 },
    })
    createUploadUrlsMock.mockReset()
    createUploadUrlsMock.mockImplementation(
      async (
        _transferId: string,
        _manageToken: string,
        chunks: Array<{ fileId: string; chunkIndex: number }>,
      ) =>
        chunks.map((chunk) => ({
          ...chunk,
          url: `https://upload.test/${chunk.fileId}/${chunk.chunkIndex}`,
        })),
    )
    deletePersistedTransferSourcesMock.mockClear()
    deleteRemoteTransferMock.mockReset()
    deleteRemoteTransferMock.mockResolvedValue(undefined)
    deleteSourcesForTransferMock.mockClear()
    deleteTransferRecordMock.mockClear()
    encryptChunkMock.mockReset()
    encryptChunkMock.mockImplementation(async ({ plaintext }: { plaintext: Uint8Array }) => ({
      checksumHex: 'checksum',
      ciphertext: new Uint8Array(plaintext.byteLength + 16).fill(7),
    }))
    encryptManifestMock.mockReset()
    encryptManifestMock.mockResolvedValue(new Uint8Array([1, 2, 3]))
    finalizeTransferMock.mockReset()
    finalizeTransferMock.mockResolvedValue(undefined)
    generateSecretMock.mockReset()
    generateSecretMock.mockImplementation(
      async (length: number) => new Uint8Array(Array.from({ length }, (_, index) => index + 1)),
    )
    getSourcesForTransferMock.mockClear()
    getTransferMock.mockClear()
    listTransfersMock.mockClear()
    loadPersistedSourceFileMock.mockReset()
    loadPersistedSourceFileMock.mockImplementation(
      async (source: PersistedSourceRecord) => source.file ?? null,
    )
    persistSourceToOpfsMock.mockReset()
    persistSourceToOpfsMock.mockResolvedValue(null)
    putSourcesMock.mockClear()
    putTransferMock.mockClear()
    registerFilesMock.mockReset()
    registerFilesMock.mockResolvedValue(undefined)
    resumeTransferMock.mockReset()
    resumeTransferMock.mockResolvedValue({ uploadedChunks: {} })
    supportsOpfsSourcePersistenceMock.mockReset()
    supportsOpfsSourcePersistenceMock.mockReturnValue(false)
    updateTransferMock.mockReset()
    updateTransferMock.mockResolvedValue(undefined)
    uploadManifestMock.mockReset()
    uploadManifestMock.mockResolvedValue(undefined)
    wrapRootKeyMock.mockReset()
    wrapRootKeyMock.mockResolvedValue('wrapped-root')

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
      })),
    )
  })

  it('creates, uploads, and finalizes a transfer', async () => {
    renderProvider()
    await waitFor(() => expect(latestContext).not.toBeNull())

    await act(async () => {
      await latestContext?.createTransfer([makeSelectedSource('docs/example.txt')], {
        clearLocalSecretsOnReady: false,
        displayName: 'Shared docs',
        expiresInSeconds: 3600,
        stripMetadata: false,
      })
    })

    await waitFor(() => {
      expect(screen.getByText('t-created:ready:none')).toBeInTheDocument()
    })

    expect(registerFilesMock).toHaveBeenCalled()
    expect(putSourcesMock).toHaveBeenCalled()
    expect(createUploadUrlsMock).toHaveBeenCalled()
    expect(completeChunksMock).toHaveBeenCalled()
    expect(uploadManifestMock).toHaveBeenCalled()
    expect(finalizeTransferMock).toHaveBeenCalled()
    expect(wrapRootKeyMock).toHaveBeenCalled()
    expect(transfersStore.get('t-created')?.status).toBe('ready')
  })

  it('rejects empty selections and cleans up failed creations', async () => {
    renderProvider()
    await waitFor(() => expect(latestContext).not.toBeNull())

    await expect(
      latestContext?.createTransfer([], {
        clearLocalSecretsOnReady: false,
        displayName: '',
        expiresInSeconds: 3600,
        stripMetadata: false,
      }) ?? Promise.resolve(),
    ).rejects.toThrow('Choose at least one file or folder.')

    registerFilesMock.mockRejectedValueOnce(new Error('register failed'))

    await expect(
      latestContext?.createTransfer([makeSelectedSource('docs/example.txt')], {
        clearLocalSecretsOnReady: false,
        displayName: 'Shared docs',
        expiresInSeconds: 3600,
        stripMetadata: false,
      }) ?? Promise.resolve(),
    ).rejects.toThrow('register failed')

    expect(deletePersistedTransferSourcesMock).toHaveBeenCalledWith('t-created')
    expect(deleteRemoteTransferMock).toHaveBeenCalledWith('t-created', 'manage-token')
  })

  it('rejects source selections that exceed the app transfer limit before creating a transfer', async () => {
    renderProvider()
    await waitFor(() => expect(latestContext).not.toBeNull())

    const oversizedFile = new File(['payload'], 'huge.bin', {
      lastModified: 2,
      type: 'application/octet-stream',
    })
    Object.defineProperty(oversizedFile, 'size', {
      configurable: true,
      value: 268_435_456,
    })

    await expect(
      latestContext?.createTransfer(
        [
          {
            file: oversizedFile,
            relativePath: 'huge.bin',
          },
        ],
        {
          clearLocalSecretsOnReady: false,
          displayName: 'Huge transfer',
          expiresInSeconds: 3600,
          stripMetadata: false,
        },
      ) ?? Promise.resolve(),
    ).rejects.toThrow('The limit is 256 MiB per transfer.')

    expect(createTransferApiMock).not.toHaveBeenCalled()
  })

  it('rejects prepared transfers that exceed the limit after smaller chunk sizing is applied', async () => {
    renderProvider()
    await waitFor(() => expect(latestContext).not.toBeNull())

    createTransferApiMock.mockResolvedValueOnce({
      expiresAt: '2026-03-21T08:00:00.000Z',
      manageToken: 'manage-token',
      transferId: 't-prepared-limit',
      uploadConfig: { chunkSize: 1_048_576 },
    })
    supportsOpfsSourcePersistenceMock.mockReturnValueOnce(true)

    const virtualLargeFile = new File(['payload'], 'virtual-large.bin', {
      lastModified: 2,
      type: 'application/octet-stream',
    })
    Object.defineProperty(virtualLargeFile, 'size', {
      configurable: true,
      value: 268_434_000,
    })
    persistSourceToOpfsMock.mockResolvedValueOnce({
      fileId: 'file-1',
      key: 'file-1:source',
      lastModified: 2,
      name: 'virtual-large.bin',
      opfsPath: 't-prepared-limit/file-1.bin',
      relativePath: 'virtual-large.bin',
      size: 268_434_000,
      storage: 'opfs',
      transferId: 't-prepared-limit',
      type: 'application/octet-stream',
    } satisfies PersistedSourceRecord)

    await expect(
      latestContext?.createTransfer(
        [
          {
            file: virtualLargeFile,
            relativePath: 'virtual-large.bin',
          },
        ],
        {
          clearLocalSecretsOnReady: false,
          displayName: 'Prepared limit transfer',
          expiresInSeconds: 3600,
          stripMetadata: false,
        },
      ) ?? Promise.resolve(),
    ).rejects.toThrow('This transfer would upload')

    expect(registerFilesMock).not.toHaveBeenCalled()
    expect(deletePersistedTransferSourcesMock).toHaveBeenCalledWith('t-prepared-limit')
    expect(deleteRemoteTransferMock).toHaveBeenCalledWith('t-prepared-limit', 'manage-token')
  })

  it('extends saved transfers and blocks transfers without manage access', async () => {
    transfersStore.set('t1', makeTransferRecord('ready'))

    renderProvider()
    await waitFor(() => expect(latestContext).not.toBeNull())

    await act(async () => {
      await latestContext?.extendTransfer('t1', 7200)
    })

    expect(updateTransferMock).toHaveBeenCalledWith('t1', 'manage-token', {
      expiresInSeconds: 7200,
    })
    expect(transfersStore.get('t1')?.expiresAt).not.toBe('2026-03-21T08:00:00.000Z')

    transfersStore.set('t2', makeTransferRecord('ready', { id: 't2', manageToken: '' }))
    await expect(latestContext?.extendTransfer('t2', 7200) ?? Promise.resolve()).rejects.toThrow(
      'Expiry changes are no longer available after privacy mode clears local transfer controls.',
    )
  })

  it('deletes transfers locally even when the remote delete fails', async () => {
    transfersStore.set('t1', makeTransferRecord('ready'))
    deleteRemoteTransferMock.mockRejectedValueOnce(new Error('network'))

    renderProvider()
    await waitFor(() => expect(latestContext).not.toBeNull())

    await act(async () => {
      await latestContext?.deleteTransfer('t1')
    })

    expect(deleteRemoteTransferMock).toHaveBeenCalledWith('t1', 'manage-token')
    expect(deletePersistedTransferSourcesMock).toHaveBeenCalledWith('t1')
    expect(deleteTransferRecordMock).toHaveBeenCalledWith('t1')
    expect(transfersStore.has('t1')).toBe(false)
  })

  it('rejects missing transfers and ignores delete requests for unknown records', async () => {
    renderProvider()
    await waitFor(() => expect(latestContext).not.toBeNull())

    await expect(
      latestContext?.extendTransfer('missing', 7200) ?? Promise.resolve(),
    ).rejects.toThrow('This transfer is not saved on this device.')

    await act(async () => {
      await latestContext?.deleteTransfer('missing')
    })

    expect(deleteRemoteTransferMock).not.toHaveBeenCalled()
    expect(deleteTransferRecordMock).not.toHaveBeenCalled()
  })

  it('refreshes transfers in newest-first order', async () => {
    transfersStore.set(
      't-old',
      makeTransferRecord('ready', {
        createdAt: '2026-03-20T08:00:00.000Z',
        id: 't-old',
      }),
    )
    transfersStore.set(
      't-new',
      makeTransferRecord('ready', {
        createdAt: '2026-03-20T09:00:00.000Z',
        id: 't-new',
      }),
    )

    renderProvider()

    await waitFor(() => {
      expect(screen.getByText('t-new:ready:none')).toBeInTheDocument()
      expect(screen.getByText('t-old:ready:none')).toBeInTheDocument()
    })

    const transferRows = Array.from(document.querySelectorAll('p')).map((node) => node.textContent)
    expect(transferRows.slice(0, 2)).toEqual(['t-new:ready:none', 't-old:ready:none'])
  })

  it('marks interrupted uploads as failed when source files are missing', async () => {
    transfersStore.set('t1', makeTransferRecord('uploading'))

    renderProvider()

    await waitFor(() => {
      expect(
        screen.getByText(
          "t1:failed:Source files are no longer on this device, so this transfer can't continue.",
        ),
      ).toBeInTheDocument()
    })
  })

  it('skips resume attempts when a recovered transfer is no longer saved locally', async () => {
    listTransfersMock.mockResolvedValueOnce([
      makeTransferRecord('paused', {
        id: 'ghost',
        lastError:
          'This page was closed or refreshed. Upload will continue automatically when you return here in the same browser on this device.',
      }),
    ])

    renderProvider()

    await waitFor(() => {
      expect(getTransferMock).toHaveBeenCalledWith('ghost')
    })

    expect(screen.queryByText(/ghost:/)).not.toBeInTheDocument()
  })

  it('marks uploads as failed when hydrated source files disappear', async () => {
    transfersStore.set('t1', makeTransferRecord('uploading'))
    sourcesStore.set('t1:file-1', makeSourceRecord('t1'))
    loadPersistedSourceFileMock.mockResolvedValueOnce(null)

    renderProvider()

    await waitFor(() => {
      expect(
        screen.getByText(
          "t1:failed:Source files are no longer on this device, so this transfer can't continue.",
        ),
      ).toBeInTheDocument()
    })
  })

  it('marks uploads as failed when upload URLs are missing', async () => {
    transfersStore.set('t1', makeTransferRecord('uploading'))
    sourcesStore.set('t1:file-1', makeSourceRecord('t1'))
    createUploadUrlsMock.mockResolvedValueOnce([])

    renderProvider()

    await waitFor(() => {
      expect(screen.getByText('t1:failed:Missing an upload URL for one chunk.')).toBeInTheDocument()
    })
  })

  it('fails uploads when a chunk request returns a non-success status', async () => {
    transfersStore.set('t1', makeTransferRecord('uploading'))
    sourcesStore.set('t1:file-1', makeSourceRecord('t1'))

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 503,
      })),
    )

    renderProvider()

    await waitFor(() => {
      expect(screen.getByText('t1:failed:Chunk upload failed with 503')).toBeInTheDocument()
    })
  })

  it('pauses in-flight uploads on pagehide so the browser can resume later', async () => {
    transfersStore.set('t1', makeTransferRecord('uploading'))
    sourcesStore.set('t1:file-1', makeSourceRecord('t1'))

    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise((_, reject) => {
            const signal = init?.signal as AbortSignal | undefined
            signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            )
          }),
      ),
    )

    renderProvider()

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled()
    })

    act(() => {
      window.dispatchEvent(new PageTransitionEvent('pagehide'))
    })

    await waitFor(() => {
      expect(
        screen.getByText(
          't1:paused:This page was closed or refreshed. Upload will continue automatically when you return here in the same browser on this device.',
        ),
      ).toBeInTheDocument()
    })
  })

  it('aborts active upload runtimes when deleting a transfer mid-flight', async () => {
    transfersStore.set('t1', makeTransferRecord('uploading'))
    sourcesStore.set('t1:file-1', makeSourceRecord('t1'))

    let aborts = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise((_, reject) => {
            const signal = init?.signal as AbortSignal | undefined
            signal?.addEventListener('abort', () => {
              aborts += 1
              reject(new DOMException('aborted', 'AbortError'))
            })
          }),
      ),
    )

    renderProvider()

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled()
    })
    await waitFor(() => expect(latestContext).not.toBeNull())

    await act(async () => {
      await latestContext?.deleteTransfer('t1')
    })

    expect(aborts).toBeGreaterThan(0)
    expect(deleteRemoteTransferMock).toHaveBeenCalledWith('t1', 'manage-token')
    expect(deletePersistedTransferSourcesMock).toHaveBeenCalledWith('t1')
    expect(deleteTransferRecordMock).toHaveBeenCalledWith('t1')
    expect(transfersStore.has('t1')).toBe(false)
  })
})

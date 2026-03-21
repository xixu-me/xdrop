import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ManifestFileEntry } from '@/lib/api/types'
import type { LocalTransferRecord, PersistedSourceRecord } from '@/lib/indexeddb/db'

const {
  deletePersistedTransferSourcesMock,
  deleteSourcesForTransferMock,
  encryptManifestMock,
  finalizeTransferMock,
  getSourcesForTransferMock,
  getTransferMock,
  listTransfersMock,
  loadPersistedSourceFileMock,
  putTransferMock,
  resumeTransferMock,
  sourcesStore,
  transfersStore,
  wrapRootKeyMock,
} = vi.hoisted(() => {
  const transferMap = new Map<string, LocalTransferRecord>()
  const sourceMap = new Map<string, PersistedSourceRecord>()

  return {
    transfersStore: transferMap,
    sourcesStore: sourceMap,
    listTransfersMock: vi.fn(async () => Array.from(transferMap.values())),
    getTransferMock: vi.fn(async (id: string) => transferMap.get(id)),
    putTransferMock: vi.fn(async (record: LocalTransferRecord) => {
      transferMap.set(record.id, record)
    }),
    getSourcesForTransferMock: vi.fn(async (transferId: string) =>
      Array.from(sourceMap.values()).filter((source) => source.transferId === transferId),
    ),
    deleteSourcesForTransferMock: vi.fn(async (transferId: string) => {
      for (const [key, source] of sourceMap.entries()) {
        if (source.transferId === transferId) {
          sourceMap.delete(key)
        }
      }
    }),
    deletePersistedTransferSourcesMock: vi.fn(async () => {}),
    loadPersistedSourceFileMock: vi.fn(
      async (source: PersistedSourceRecord) => source.file ?? null,
    ),
    resumeTransferMock: vi.fn(async () => ({
      uploadedChunks: {
        'file-1': [0],
      },
    })),
    uploadManifestMock: vi.fn(async () => {}),
    finalizeTransferMock: vi.fn(async () => {}),
    encryptManifestMock: vi.fn(async () => new Uint8Array([1, 2, 3])),
    wrapRootKeyMock: vi.fn(async () => 'wrapped-root'),
  }
})

vi.mock('@/lib/indexeddb/db', () => ({
  deleteTransfer: vi.fn(async () => {}),
  deleteSourcesForTransfer: deleteSourcesForTransferMock,
  getSourcesForTransfer: getSourcesForTransferMock,
  getTransfer: getTransferMock,
  listTransfers: listTransfersMock,
  putSources: vi.fn(async () => {}),
  putTransfer: putTransferMock,
}))

vi.mock('@/lib/files/persistentSources', () => ({
  createIndexedDbSourceRecord: vi.fn(),
  deletePersistedTransferSources: deletePersistedTransferSourcesMock,
  loadPersistedSourceFile: loadPersistedSourceFileMock,
  persistSourceToOpfs: vi.fn(),
  supportsOpfsSourcePersistence: vi.fn(() => false),
}))

vi.mock('@/lib/api/client', () => ({
  apiClient: {
    completeChunks: vi.fn(async () => {}),
    createDownloadUrls: vi.fn(),
    createTransfer: vi.fn(),
    createUploadUrls: vi.fn(async () => []),
    deleteTransfer: vi.fn(async () => {}),
    finalizeTransfer: finalizeTransferMock,
    getManageTransfer: vi.fn(),
    getPublicTransfer: vi.fn(),
    registerFiles: vi.fn(async () => {}),
    resumeTransfer: resumeTransferMock,
    updateTransfer: vi.fn(async () => {}),
    uploadManifest: vi.fn(async () => {}),
  },
}))

vi.mock('@/lib/workers/cryptoClient', () => ({
  cryptoWorker: {
    decryptChunk: vi.fn(),
    decryptManifest: vi.fn(),
    encryptChunk: vi.fn(),
    encryptManifest: encryptManifestMock,
    unwrapRootKey: vi.fn(),
    wrapRootKey: wrapRootKeyMock,
  },
}))

import { TransferProvider, defaultTransferName, useTransfers } from './TransferContext'

function TransferStateProbe() {
  const { transfers } = useTransfers()
  return (
    <div>
      {transfers.map((transfer) => (
        <p key={transfer.id}>
          {transfer.id}:{transfer.status}:{transfer.lastError ?? 'none'}
        </p>
      ))}
    </div>
  )
}

function createFileEntry(overrides: Partial<ManifestFileEntry> = {}): ManifestFileEntry {
  return {
    fileId: 'file-1',
    name: 'example.txt',
    relativePath: 'example.txt',
    mimeType: 'text/plain',
    plaintextSize: 5,
    modifiedAt: 1,
    chunkSize: 8,
    totalChunks: 1,
    ciphertextSizes: [21],
    noncePrefix: 'AQIDBA',
    metadataStripped: false,
    ...overrides,
  }
}

function createTransferRecord(
  status: LocalTransferRecord['status'],
  overrides: Partial<LocalTransferRecord> = {},
): LocalTransferRecord {
  return {
    id: 't1',
    displayName: 'Transfer 3/19/2026',
    createdAt: '2026-03-19T08:00:00.000Z',
    expiresAt: '2026-03-20T08:00:00.000Z',
    status,
    shareUrl: 'https://example.com/t/t1#k=test',
    manageToken: 'manage-token',
    linkKeyBase64Url: 'AQIDBA',
    rootKeyBase64Url: 'AQIDBA',
    metadataStrippingEnabled: false,
    clearLocalSecretsOnReady: false,
    localManagementCleared: false,
    totalFiles: 1,
    totalBytes: 21,
    uploadedBytes: 0,
    sourcePersisted: true,
    files: [createFileEntry()],
    ...overrides,
  }
}

function createSourceRecord(): PersistedSourceRecord {
  return {
    key: 't1:file-1',
    transferId: 't1',
    fileId: 'file-1',
    relativePath: 'example.txt',
    storage: 'indexeddb',
    file: new File(['hello'], 'example.txt', { type: 'text/plain', lastModified: 1 }),
    name: 'example.txt',
    type: 'text/plain',
    lastModified: 1,
    size: 5,
  }
}

describe('TransferProvider', () => {
  beforeEach(() => {
    transfersStore.clear()
    sourcesStore.clear()

    listTransfersMock.mockClear()
    getTransferMock.mockClear()
    putTransferMock.mockClear()
    getSourcesForTransferMock.mockClear()
    deleteSourcesForTransferMock.mockClear()
    deletePersistedTransferSourcesMock.mockClear()
    loadPersistedSourceFileMock.mockClear()
    resumeTransferMock.mockClear()
    encryptManifestMock.mockClear()
    finalizeTransferMock.mockClear()
    wrapRootKeyMock.mockClear()
  })

  it('automatically resumes transfers interrupted by a refresh', async () => {
    transfersStore.set('t1', createTransferRecord('uploading'))
    sourcesStore.set('t1:file-1', createSourceRecord())

    render(
      <TransferProvider>
        <TransferStateProbe />
      </TransferProvider>,
    )

    await waitFor(() => {
      expect(resumeTransferMock).toHaveBeenCalledWith(
        't1',
        'manage-token',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      )
    })

    await waitFor(() => {
      expect(screen.getByText('t1:ready:none')).toBeInTheDocument()
    })

    expect(transfersStore.get('t1')?.status).toBe('ready')
    expect(transfersStore.get('t1')?.uploadedBytes).toBe(21)
    expect(wrapRootKeyMock).toHaveBeenCalled()
    expect(finalizeTransferMock).toHaveBeenCalled()
  })

  it('automatically resumes interrupted transfers already marked for recovery', async () => {
    transfersStore.set(
      't1',
      createTransferRecord('paused', {
        lastError:
          'This page was closed or refreshed. Upload will continue automatically when you return here in the same browser on this device.',
      }),
    )
    sourcesStore.set('t1:file-1', createSourceRecord())

    render(
      <TransferProvider>
        <TransferStateProbe />
      </TransferProvider>,
    )

    await waitFor(() => {
      expect(resumeTransferMock).toHaveBeenCalledWith(
        't1',
        'manage-token',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      )
    })

    await waitFor(() => {
      expect(screen.getByText('t1:ready:none')).toBeInTheDocument()
    })
  })

  it('does not auto-resume transfers that are already waiting for user action', async () => {
    transfersStore.set(
      't1',
      createTransferRecord('paused', {
        lastError: 'Upload is waiting for a manual check.',
      }),
    )
    sourcesStore.set('t1:file-1', createSourceRecord())

    render(
      <TransferProvider>
        <TransferStateProbe />
      </TransferProvider>,
    )

    await waitFor(() => {
      expect(
        screen.getByText('t1:paused:Upload is waiting for a manual check.'),
      ).toBeInTheDocument()
    })

    expect(resumeTransferMock).not.toHaveBeenCalled()
  })
})

describe('defaultTransferName', () => {
  it('uses the top-level folder name for a folder selection', () => {
    expect(
      defaultTransferName([
        createSelectedSource('Photos/IMG_0001.jpg'),
        createSelectedSource('Photos/Trips/IMG_0002.jpg'),
      ]),
    ).toBe('Photos')
  })

  it('summarizes mixed selections with the first item name', () => {
    expect(
      defaultTransferName([
        createSelectedSource('brief.pdf'),
        createSelectedSource('notes.txt'),
        createSelectedSource('screenshots/home.png'),
      ]),
    ).toBe('brief.pdf and 2 more items')
  })
})

function createSelectedSource(relativePath: string) {
  const fileName = relativePath.split('/').at(-1) ?? relativePath
  return {
    file: new File(['payload'], fileName, { type: 'application/octet-stream', lastModified: 1 }),
    relativePath,
  }
}

import { DEFAULT_EXPIRY_SECONDS, SOURCE_BLOB_PERSIST_LIMIT, type ExpiryOption } from '@xdrop/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PersistedSourceRecord } from '@/lib/indexeddb/db'

const {
  createIndexedDbSourceRecordMock,
  deleteSourcesByKeysMock,
  deleteSourcesForTransferMock,
  getSourcesForTransferMock,
  loadPersistedSourceFileMock,
  persistSourceToOpfsMock,
  putSourcesMock,
  recordsStore,
  supportsOpfsSourcePersistenceMock,
} = vi.hoisted(() => {
  const records: PersistedSourceRecord[] = []

  return {
    recordsStore: records,
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
    deleteSourcesByKeysMock: vi.fn(async (keys: string[]) => {
      for (let index = records.length - 1; index >= 0; index -= 1) {
        if (keys.includes(records[index]?.key ?? '')) {
          records.splice(index, 1)
        }
      }
    }),
    deleteSourcesForTransferMock: vi.fn(async (transferId: string) => {
      for (let index = records.length - 1; index >= 0; index -= 1) {
        if (records[index]?.transferId === transferId) {
          records.splice(index, 1)
        }
      }
    }),
    getSourcesForTransferMock: vi.fn(
      async (transferId: string): Promise<PersistedSourceRecord[]> =>
        records.filter((record) => record.transferId === transferId),
    ),
    loadPersistedSourceFileMock: vi.fn(
      async (record: PersistedSourceRecord): Promise<File | null> =>
        record.file
          ? new File([record.file], record.name, { lastModified: record.lastModified })
          : null,
    ),
    persistSourceToOpfsMock: vi.fn(async (): Promise<PersistedSourceRecord | null> => null),
    putSourcesMock: vi.fn(async (nextRecords: PersistedSourceRecord[]) => {
      records.push(...nextRecords)
    }),
    supportsOpfsSourcePersistenceMock: vi.fn(() => false),
  }
})

vi.mock('@/lib/files/persistentSources', () => ({
  createIndexedDbSourceRecord: createIndexedDbSourceRecordMock,
  loadPersistedSourceFile: loadPersistedSourceFileMock,
  persistSourceToOpfs: persistSourceToOpfsMock,
  supportsOpfsSourcePersistence: supportsOpfsSourcePersistenceMock,
}))

vi.mock('@/lib/indexeddb/db', () => ({
  deleteSourcesByKeys: deleteSourcesByKeysMock,
  deleteSourcesForTransfer: deleteSourcesForTransferMock,
  getSourcesForTransfer: getSourcesForTransferMock,
  putSources: putSourcesMock,
}))

import {
  clearUploadSelectionDraft,
  loadUploadSelectionDraft,
  persistUploadSelectionDraftSources,
  saveUploadSelectionDraftSettings,
} from './uploadSelectionDraft'

function makeRecord(overrides: Partial<PersistedSourceRecord> = {}): PersistedSourceRecord {
  const record: PersistedSourceRecord = {
    file: new File(['payload'], 'draft.txt', { lastModified: 1, type: 'text/plain' }),
    fileId: 'file-1',
    key: 'file-1:source',
    lastModified: 1,
    name: 'draft.txt',
    relativePath: 'draft.txt',
    size: 7,
    storage: 'indexeddb',
    transferId: '__upload-selection__',
    type: 'text/plain',
    ...overrides,
  }

  if ('file' in overrides && overrides.file === undefined) {
    delete record.file
  }
  if ('opfsPath' in overrides && overrides.opfsPath === undefined) {
    delete record.opfsPath
  }

  return record
}

function makeSource(relativePath: string, draftKey?: string, size = 7) {
  const name = relativePath.split('/').at(-1) ?? relativePath
  return {
    ...(draftKey ? { draftKey } : {}),
    file: new File([new Uint8Array(size)], name, { lastModified: 2, type: 'text/plain' }),
    relativePath,
  }
}

describe('uploadSelectionDraft', () => {
  beforeEach(() => {
    recordsStore.splice(0, recordsStore.length)
    window.localStorage.clear()

    createIndexedDbSourceRecordMock.mockClear()
    deleteSourcesByKeysMock.mockClear()
    deleteSourcesForTransferMock.mockClear()
    getSourcesForTransferMock.mockClear()
    loadPersistedSourceFileMock.mockClear()
    persistSourceToOpfsMock.mockClear()
    putSourcesMock.mockClear()
    supportsOpfsSourcePersistenceMock.mockReset()
    supportsOpfsSourcePersistenceMock.mockReturnValue(false)
  })

  it('loads the saved selection and prunes missing persisted files', async () => {
    const missingRecord = makeRecord({
      fileId: 'file-2',
      key: 'file-2:source',
      name: 'missing.txt',
      relativePath: 'missing.txt',
    })
    delete missingRecord.file

    recordsStore.push(makeRecord(), missingRecord)
    window.localStorage.setItem(
      'xdrop:upload-selection:draft',
      JSON.stringify({
        clearLocalSecretsOnReady: true,
        displayName: 'Draft name',
        expiresInSeconds: 3600 as ExpiryOption,
        stripMetadata: false,
      }),
    )

    const draft = await loadUploadSelectionDraft()

    expect(draft.sources).toEqual([
      expect.objectContaining({
        draftKey: 'file-1:source',
        relativePath: 'draft.txt',
      }),
    ])
    expect(draft.settings).toEqual({
      displayName: 'Draft name',
      expiresInSeconds: 3600,
      stripMetadata: false,
    })
    expect(deleteSourcesByKeysMock).toHaveBeenCalledWith(['file-2:source'])
  })

  it('falls back to default settings when saved settings are missing or invalid', async () => {
    await expect(loadUploadSelectionDraft()).resolves.toMatchObject({
      settings: {
        displayName: '',
        expiresInSeconds: DEFAULT_EXPIRY_SECONDS,
        stripMetadata: true,
      },
    })

    window.localStorage.setItem(
      'xdrop:upload-selection:draft',
      '{"displayName":42,"expiresInSeconds":"bad"}',
    )

    await expect(loadUploadSelectionDraft()).resolves.toMatchObject({
      settings: {
        displayName: '',
        expiresInSeconds: DEFAULT_EXPIRY_SECONDS,
        stripMetadata: true,
      },
    })

    window.localStorage.setItem('xdrop:upload-selection:draft', '{bad json')

    await expect(loadUploadSelectionDraft()).resolves.toMatchObject({
      settings: {
        displayName: '',
        expiresInSeconds: DEFAULT_EXPIRY_SECONDS,
        stripMetadata: true,
      },
    })
  })

  it('persists new draft sources, reuses existing ones, and deletes stale records', async () => {
    recordsStore.push(
      makeRecord({ key: 'keep:source', fileId: 'keep-file' }),
      makeRecord({ key: 'stale:source', fileId: 'stale-file' }),
    )

    const kept = makeSource('keep.txt', 'keep:source')
    const added = makeSource('docs/new.txt')

    const nextSources = await persistUploadSelectionDraftSources([kept, added])

    expect(nextSources).toEqual([
      kept,
      expect.objectContaining({
        draftKey: expect.stringMatching(/:source$/),
        relativePath: 'docs/new.txt',
      }),
    ])
    expect(createIndexedDbSourceRecordMock).toHaveBeenCalledTimes(1)
    expect(putSourcesMock).toHaveBeenCalledTimes(1)
    expect(deleteSourcesByKeysMock).toHaveBeenCalledWith(['stale:source'])
  })

  it('uses OPFS persistence when available', async () => {
    supportsOpfsSourcePersistenceMock.mockReturnValue(true)
    const opfsRecord = makeRecord({
      key: 'opfs:source',
      opfsPath: '__upload-selection__/opfs.bin',
      storage: 'opfs',
    })
    delete opfsRecord.file
    persistSourceToOpfsMock.mockResolvedValueOnce(opfsRecord)

    const [nextSource] = await persistUploadSelectionDraftSources([makeSource('image.png')])

    expect(persistSourceToOpfsMock).toHaveBeenCalledTimes(1)
    expect(createIndexedDbSourceRecordMock).not.toHaveBeenCalled()
    expect(nextSource?.draftKey).toBe('opfs:source')
  })

  it('fails with a helpful error when the browser cannot persist the selection', async () => {
    supportsOpfsSourcePersistenceMock.mockReturnValue(true)
    persistSourceToOpfsMock.mockResolvedValueOnce(null)

    await expect(
      persistUploadSelectionDraftSources([
        makeSource('huge.bin', undefined, SOURCE_BLOB_PERSIST_LIMIT + 1),
      ]),
    ).rejects.toThrow("This browser couldn't reserve enough local storage")

    supportsOpfsSourcePersistenceMock.mockReturnValue(false)
    await expect(
      persistUploadSelectionDraftSources([
        makeSource('huge.bin', undefined, SOURCE_BLOB_PERSIST_LIMIT + 1),
      ]),
    ).rejects.toThrow('use a browser with OPFS support or choose smaller files')
  })

  it('saves and clears draft settings and sources', async () => {
    recordsStore.push(makeRecord())

    saveUploadSelectionDraftSettings({
      displayName: 'Saved transfer',
      expiresInSeconds: DEFAULT_EXPIRY_SECONDS,
      stripMetadata: false,
    })
    expect(JSON.parse(window.localStorage.getItem('xdrop:upload-selection:draft') ?? '{}')).toEqual(
      {
        displayName: 'Saved transfer',
        expiresInSeconds: DEFAULT_EXPIRY_SECONDS,
        stripMetadata: false,
      },
    )

    await clearUploadSelectionDraft()

    expect(window.localStorage.getItem('xdrop:upload-selection:draft')).toBeNull()
    expect(deleteSourcesForTransferMock).toHaveBeenCalledWith('__upload-selection__')
  })

  it('avoids touching localStorage when window is unavailable', async () => {
    const originalWindow = globalThis.window

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: undefined,
    })

    expect(() =>
      saveUploadSelectionDraftSettings({
        displayName: 'Saved transfer',
        expiresInSeconds: DEFAULT_EXPIRY_SECONDS,
        stripMetadata: false,
      }),
    ).not.toThrow()
    await expect(loadUploadSelectionDraft()).resolves.toMatchObject({
      settings: {
        displayName: '',
        expiresInSeconds: DEFAULT_EXPIRY_SECONDS,
        stripMetadata: true,
      },
    })

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    })
  })

  it('falls back to a timestamp-based draft id when randomUUID is unavailable', async () => {
    const originalCrypto = globalThis.crypto

    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {},
    })

    const [source] = await persistUploadSelectionDraftSources([makeSource('docs/new.txt')])

    expect(source?.draftKey).toMatch(/^draft-/)

    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: originalCrypto,
    })
  })
})

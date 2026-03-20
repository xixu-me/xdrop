import { describe, expect, it } from 'vitest'

import {
  deleteSourcesByKeys,
  deleteSourcesForTransfer,
  deleteTransfer,
  getSourcesForTransfer,
  getTransfer,
  listTransfers,
  putTransfer,
  putSources,
} from './db'

describe('indexeddb history persistence', () => {
  it('stores and removes transfer state with persisted sources', async () => {
    await putTransfer({
      id: 't1',
      displayName: 'Capsule',
      createdAt: new Date().toISOString(),
      expiresAt: new Date().toISOString(),
      status: 'uploading',
      manageToken: 'manage',
      linkKeyBase64Url: 'AQID',
      rootKeyBase64Url: 'AQID',
      metadataStrippingEnabled: true,
      clearLocalSecretsOnReady: false,
      localManagementCleared: false,
      totalFiles: 1,
      totalBytes: 42,
      uploadedBytes: 21,
      sourcePersisted: true,
      files: [],
    })

    await putSources([
      {
        key: 'source:t1',
        transferId: 't1',
        fileId: 'f1',
        relativePath: 'docs/readme.txt',
        storage: 'indexeddb',
        file: new Blob(['payload']),
        name: 'readme.txt',
        type: 'text/plain',
        lastModified: 12,
        size: 7,
      },
    ])

    expect((await getTransfer('t1'))?.status).toBe('uploading')
    expect(await listTransfers()).toEqual([
      expect.objectContaining({
        id: 't1',
        status: 'uploading',
      }),
    ])
    expect(await getSourcesForTransfer('t1')).toEqual([
      expect.objectContaining({
        key: 'source:t1',
        transferId: 't1',
      }),
    ])

    await deleteTransfer('t1')
    expect(await getTransfer('t1')).toBeUndefined()
    expect(await getSourcesForTransfer('t1')).toEqual([])
  })

  it('deletes individual sources by key and no-ops for empty input', async () => {
    await putSources([
      {
        key: 'source:one',
        transferId: 't-source',
        fileId: 'f1',
        relativePath: 'docs/one.txt',
        storage: 'indexeddb',
        file: new Blob(['one']),
        name: 'one.txt',
        type: 'text/plain',
        lastModified: 1,
        size: 3,
      },
      {
        key: 'source:two',
        transferId: 't-source',
        fileId: 'f2',
        relativePath: 'docs/two.txt',
        storage: 'indexeddb',
        file: new Blob(['two']),
        name: 'two.txt',
        type: 'text/plain',
        lastModified: 2,
        size: 3,
      },
    ])

    await deleteSourcesByKeys([])
    await deleteSourcesByKeys(['source:one'])

    expect(await getSourcesForTransfer('t-source')).toEqual([
      expect.objectContaining({ key: 'source:two' }),
    ])

    await deleteSourcesForTransfer('t-source')
    expect(await getSourcesForTransfer('t-source')).toEqual([])
  })
})

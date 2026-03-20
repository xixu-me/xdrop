import { describe, expect, it, vi } from 'vitest'

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

import { __test__ } from './UploadStudio'

type EntryLike = Parameters<(typeof __test__)['readEntry']>[0]

function makeSource(relativePath: string, draftKey?: string) {
  const fileName = relativePath.split('/').at(-1) ?? relativePath
  return {
    ...(draftKey ? { draftKey } : {}),
    file: new File(['payload'], fileName, { lastModified: 1, type: 'text/plain' }),
    relativePath,
  }
}

describe('UploadStudio helpers', () => {
  it('creates stable selection keys and de-duplicates merged selections', () => {
    const existing = makeSource('docs/readme.txt', 'draft-1')
    const replacement = makeSource('docs/readme.txt')
    const other = makeSource('docs/guide.txt')

    expect(__test__.selectionKey(existing)).toBe('docs/readme.txt:7:1')
    expect(__test__.mergeSelectedSources([existing], [replacement, other])).toEqual([
      replacement,
      other,
    ])
  })

  it('compares draft selections by order, key, and file identity', () => {
    const left = [makeSource('docs/readme.txt', 'draft-1')]
    const same = [makeSource('docs/readme.txt', 'draft-1')]
    const different = [makeSource('docs/readme.txt', 'draft-2')]

    expect(__test__.hasSameDraftSelection(left, same)).toBe(true)
    expect(__test__.hasSameDraftSelection(left, different)).toBe(false)
    expect(__test__.hasSameDraftSelection(left, [])).toBe(false)
  })

  it('reads dropped file entries and nested directory entries', async () => {
    const file = new File(['hello'], 'hello.txt', { type: 'text/plain', lastModified: 2 })
    const fileEntry: EntryLike = {
      isDirectory: false,
      isFile: true,
      name: 'hello.txt',
      file: (callback: (value: File) => void) => callback(file),
    }
    const nestedEntry: EntryLike = {
      isDirectory: false,
      isFile: true,
      name: 'image.png',
      file: (callback: (value: File) => void) =>
        callback(new File(['img'], 'image.png', { type: 'image/png', lastModified: 3 })),
    }
    const directoryEntry: EntryLike = {
      isDirectory: true,
      isFile: false,
      name: 'photos',
      createReader: () => ({
        readEntries: (callback: (entries: EntryLike[]) => void) => callback([nestedEntry]),
      }),
    }

    await expect(__test__.readEntry(fileEntry)).resolves.toEqual([
      { file, relativePath: 'hello.txt' },
    ])
    await expect(__test__.readEntry(directoryEntry)).resolves.toEqual([
      {
        file: expect.any(File),
        relativePath: 'photos/image.png',
      },
    ])
    await expect(
      __test__.collectDropItems([
        { webkitGetAsEntry: () => fileEntry },
        { webkitGetAsEntry: () => directoryEntry },
        { webkitGetAsEntry: () => null },
      ] as unknown as DataTransferItemList),
    ).resolves.toEqual([
      { file, relativePath: 'hello.txt' },
      {
        file: expect.any(File),
        relativePath: 'photos/image.png',
      },
    ])

    await expect(
      __test__.readEntry({
        isDirectory: false,
        isFile: false,
        name: 'mystery',
      }),
    ).resolves.toEqual([])
  })
})

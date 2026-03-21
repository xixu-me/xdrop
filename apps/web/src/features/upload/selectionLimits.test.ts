import { DEFAULT_CHUNK_SIZE, MAX_FILE_COUNT, MAX_TRANSFER_BYTES } from '@xdrop/shared'
import { describe, expect, it } from 'vitest'

import {
  estimateEncryptedTransferBytes,
  getPreparedTransferLimitError,
  getTransferSelectionLimitError,
} from './selectionLimits'

function makeSource(size: number) {
  return { file: { size } as Pick<File, 'size'> }
}

describe('selection limits', () => {
  it('rejects selections above the file count limit', () => {
    const sources = Array.from({ length: MAX_FILE_COUNT + 1 }, () => makeSource(1))

    expect(getTransferSelectionLimitError(sources)).toBe(
      `This selection has ${MAX_FILE_COUNT + 1} items. The limit is ${MAX_FILE_COUNT}.`,
    )
  })

  it('rejects selections above the encrypted transfer size limit', () => {
    const sources = [makeSource(MAX_TRANSFER_BYTES)]

    expect(estimateEncryptedTransferBytes(sources, DEFAULT_CHUNK_SIZE)).toBeGreaterThan(
      MAX_TRANSFER_BYTES,
    )
    expect(getTransferSelectionLimitError(sources)).toContain(`The limit is 256 MiB per transfer.`)
  })

  it('rejects prepared transfers that exceed the server size limit', () => {
    expect(getPreparedTransferLimitError(1, MAX_TRANSFER_BYTES + 16)).toBe(
      'This transfer would upload 256 MiB after encryption. The limit is 256 MiB per transfer.',
    )
  })

  it('rejects prepared transfers above the file count limit', () => {
    expect(getPreparedTransferLimitError(MAX_FILE_COUNT + 1, 1024)).toBe(
      `This selection has ${MAX_FILE_COUNT + 1} items. The limit is ${MAX_FILE_COUNT}.`,
    )
  })

  it('allows selections within limits', () => {
    expect(getTransferSelectionLimitError([makeSource(1024)])).toBeUndefined()
    expect(getPreparedTransferLimitError(1, 1024 + 16)).toBeUndefined()
  })
})

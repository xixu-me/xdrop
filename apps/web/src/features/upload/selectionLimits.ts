import { DEFAULT_CHUNK_SIZE, MAX_FILE_COUNT, MAX_TRANSFER_BYTES } from '@xdrop/shared'
import { formatBytes } from '@/lib/files/formatBytes'

type SourceLike = {
  file: Pick<File, 'size'>
}

/** getTransferSelectionLimitError estimates whether a staged selection exceeds app limits. */
export function getTransferSelectionLimitError(
  sources: SourceLike[],
  chunkSize = DEFAULT_CHUNK_SIZE,
) {
  if (sources.length > MAX_FILE_COUNT) {
    return `This selection has ${sources.length} items. The limit is ${MAX_FILE_COUNT}.`
  }

  const estimatedCiphertextBytes = estimateEncryptedTransferBytes(sources, chunkSize)
  if (estimatedCiphertextBytes > MAX_TRANSFER_BYTES) {
    return `This selection would upload about ${formatBytes(estimatedCiphertextBytes)} after encryption. The limit is ${formatBytes(MAX_TRANSFER_BYTES)} per transfer.`
  }

  return undefined
}

/** getPreparedTransferLimitError validates fully prepared manifest data against hard limits. */
export function getPreparedTransferLimitError(totalFiles: number, totalCiphertextBytes: number) {
  if (totalFiles > MAX_FILE_COUNT) {
    return `This selection has ${totalFiles} items. The limit is ${MAX_FILE_COUNT}.`
  }

  if (totalCiphertextBytes > MAX_TRANSFER_BYTES) {
    return `This transfer would upload ${formatBytes(totalCiphertextBytes)} after encryption. The limit is ${formatBytes(MAX_TRANSFER_BYTES)} per transfer.`
  }

  return undefined
}

/** estimateEncryptedTransferBytes includes the AES-GCM authentication tag for each chunk. */
export function estimateEncryptedTransferBytes(
  sources: SourceLike[],
  chunkSize = DEFAULT_CHUNK_SIZE,
) {
  return sources.reduce(
    (sum, source) => sum + estimateEncryptedFileBytes(source.file.size, chunkSize),
    0,
  )
}

/** estimateEncryptedFileBytes approximates ciphertext size before actual encryption runs. */
function estimateEncryptedFileBytes(plaintextBytes: number, chunkSize: number) {
  const chunkCount = Math.max(1, Math.ceil(plaintextBytes / chunkSize))
  return plaintextBytes + chunkCount * 16
}

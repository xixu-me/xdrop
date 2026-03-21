/**
 * Download and decrypt helpers for recipient-side file retrieval.
 */

import type { ManifestFileEntry } from '@/lib/api/types'
import { apiClient } from '@/lib/api/client'
import { fromBase64Url } from '@/lib/crypto/base64'
import { cryptoWorker } from '@/lib/workers/cryptoClient'

type ProgressCallback = (completedBytes: number, totalBytes: number) => void

type DecryptFileArgs = {
  transferId: string
  file: ManifestFileEntry
  rootKey: Uint8Array
  onProgress?: ProgressCallback
}

/** decryptFileChunks yields plaintext chunks in order as they are downloaded and decrypted. */
export async function* decryptFileChunks({
  transferId,
  file,
  rootKey,
  onProgress,
}: DecryptFileArgs): AsyncGenerator<Uint8Array, void, void> {
  const chunks = Array.from({ length: file.totalChunks }, (_, chunkIndex) => ({
    fileId: file.fileId,
    chunkIndex,
  }))
  const urls = await apiClient.createDownloadUrls(transferId, chunks)
  const urlMap = new Map(urls.map((item) => [`${item.fileId}:${item.chunkIndex}`, item.url]))
  const noncePrefix = fromBase64Url(file.noncePrefix)
  let completedBytes = 0

  for (let index = 0; index < file.totalChunks; index += 1) {
    const url = urlMap.get(`${file.fileId}:${index}`)
    if (!url) {
      throw new Error('Missing chunk URL during download.')
    }

    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Chunk download failed with ${response.status}`)
    }

    const ciphertext = new Uint8Array(await response.arrayBuffer())
    const plaintextChunkSize = Math.min(file.chunkSize, file.plaintextSize - index * file.chunkSize)
    const plaintext = await cryptoWorker.decryptChunk({
      rootKey,
      transferId,
      fileId: file.fileId,
      chunkIndex: index,
      noncePrefix,
      plaintextChunkSize,
      ciphertext,
    })

    completedBytes += plaintext.byteLength
    onProgress?.(completedBytes, file.plaintextSize)
    yield plaintext
  }
}

/** createDecryptedReadableStream adapts the async chunk generator to a stream consumer. */
export function createDecryptedReadableStream(args: DecryptFileArgs) {
  let iterator: AsyncGenerator<Uint8Array, void, void> | undefined

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      iterator ??= decryptFileChunks(args)
      const { done, value } = await iterator.next()
      if (done) {
        controller.close()
        return
      }

      controller.enqueue(value)
    },
    async cancel() {
      if (iterator?.return) {
        await iterator.return()
      }
    },
  })
}

/** decryptFileToBlob buffers a fully decrypted file into a Blob for simple downloads. */
export async function decryptFileToBlob(args: DecryptFileArgs) {
  const chunks: BlobPart[] = []
  for await (const chunk of decryptFileChunks(args)) {
    chunks.push(toArrayBuffer(chunk))
  }

  return new Blob(chunks, {
    type: args.file.mimeType || 'application/octet-stream',
  })
}

function toArrayBuffer(input: Uint8Array) {
  return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer
}

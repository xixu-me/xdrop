/**
 * ZIP creation helpers for download-all flows and small generated archives.
 */

import { TextReader, Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from '@zip.js/zip.js'

import { sanitizePath } from '@/lib/files/paths'

export type ZipEntryInput = {
  path: string
  blob: Blob
}

export type ZipStreamEntryInput = {
  path: string
  readable: ReadableStream<Uint8Array>
  size: number
  modifiedAt?: number
  onComplete?: () => void
}

/** buildZip adapts Blob entries into streams before producing the final ZIP Blob. */
export async function buildZip(entries: ZipEntryInput[]) {
  return buildZipFromStreams(
    entries.map((entry) => ({
      path: entry.path,
      readable: blobToReadable(entry.blob),
      size: entry.blob.size,
      ...(entry.blob instanceof File ? { modifiedAt: entry.blob.lastModified } : {}),
    })),
  )
}

/** writeZipStream incrementally writes ZIP entries into a caller-provided writable stream. */
export async function writeZipStream(
  entries: ZipStreamEntryInput[],
  writable: WritableStream<Uint8Array>,
) {
  const writer = new ZipWriter(writable)

  for (const entry of entries) {
    await writer.add(sanitizePath(entry.path), entry.readable, {
      level: 0,
      ...(entry.modifiedAt !== undefined ? { lastModDate: new Date(entry.modifiedAt) } : {}),
    })
    entry.onComplete?.()
  }

  await writer.close()
}

/** buildZipFromStreams writes streamed ZIP content into a Blob without buffering each entry first. */
export async function buildZipFromStreams(entries: ZipStreamEntryInput[]) {
  const stream = new TransformStream<Uint8Array, Uint8Array>()
  const zipBlobPromise = new Response(stream.readable, {
    headers: { 'Content-Type': 'application/zip' },
  }).blob()

  await writeZipStream(entries, stream.writable)
  return zipBlobPromise
}

/** buildTextZip creates a small ZIP archive containing one UTF-8 text file. */
export async function buildTextZip(path: string, content: string) {
  const writer = new ZipWriter(new Uint8ArrayWriter())
  await writer.add(sanitizePath(path), new TextReader(content))
  const bytes = await writer.close()
  return new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)], {
    type: 'application/zip',
  })
}

function blobToReadable(blob: Blob) {
  if (typeof blob.stream === 'function') {
    return blob.stream() as ReadableStream<Uint8Array>
  }

  if (typeof blob.arrayBuffer === 'function') {
    return new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(new Uint8Array(await blob.arrayBuffer()))
        controller.close()
      },
    })
  }

  const response = new Response(blob as BlobPart)
  if (response.body) {
    return response.body as ReadableStream<Uint8Array>
  }

  throw new Error('Blob stream is unavailable.')
}

/** buildBinaryZip creates a small ZIP archive containing one binary file. */
export async function buildBinaryZip(path: string, content: Uint8Array) {
  const writer = new ZipWriter(new Uint8ArrayWriter())
  await writer.add(sanitizePath(path), new Uint8ArrayReader(content))
  const bytes = await writer.close()
  return new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)], {
    type: 'application/zip',
  })
}

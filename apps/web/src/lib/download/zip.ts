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

/** buildZip buffers a full set of blobs into a single ZIP Blob. */
export async function buildZip(entries: ZipEntryInput[]) {
  const writer = new ZipWriter(new Uint8ArrayWriter())

  for (const entry of entries) {
    const path = sanitizePath(entry.path)
    const buffer =
      'arrayBuffer' in entry.blob
        ? await entry.blob.arrayBuffer()
        : await new Response(entry.blob).arrayBuffer()
    await writer.add(path, new Uint8ArrayReader(new Uint8Array(buffer)))
  }

  const bytes = await writer.close()
  return new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)], {
    type: 'application/zip',
  })
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
      ...(entry.modifiedAt ? { lastModDate: new Date(entry.modifiedAt) } : {}),
    })
    entry.onComplete?.()
  }

  await writer.close()
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

/** buildBinaryZip creates a small ZIP archive containing one binary file. */
export async function buildBinaryZip(path: string, content: Uint8Array) {
  const writer = new ZipWriter(new Uint8ArrayWriter())
  await writer.add(sanitizePath(path), new Uint8ArrayReader(content))
  const bytes = await writer.close()
  return new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)], {
    type: 'application/zip',
  })
}

import { describe, expect, it } from 'vitest'

import { sanitizePath } from '@/lib/files/paths'
import { buildBinaryZip, buildTextZip, buildZip, writeZipStream } from './zip'

describe('zip builder', () => {
  it('preserves sanitized folder structure', async () => {
    const zipBlob = await buildZip([
      { path: '../folder/photo.png', blob: new Blob(['a']) },
      { path: 'docs/readme.txt', blob: new Blob(['b']) },
    ])

    expect(sanitizePath('../folder/photo.png')).toBe('folder/photo.png')
    expect(sanitizePath('docs/readme.txt')).toBe('docs/readme.txt')
    expect(zipBlob.type).toBe('application/zip')
    expect(zipBlob.size).toBeGreaterThan(0)
  })

  it('streams zip output to a writable stream', async () => {
    const stream = new TransformStream<Uint8Array, Uint8Array>()
    const zipBlobPromise = new Response(stream.readable, {
      headers: { 'Content-Type': 'application/zip' },
    }).blob()
    const encoder = new TextEncoder()
    let completed = 0

    await writeZipStream(
      [
        {
          path: 'folder/hello.txt',
          onComplete: () => {
            completed += 1
          },
          size: 5,
          readable: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(encoder.encode('hello'))
              controller.close()
            },
          }),
          modifiedAt: Date.UTC(2026, 0, 1),
        },
      ],
      stream.writable,
    )

    const zipBlob = await zipBlobPromise
    expect(completed).toBe(1)
    expect(zipBlob.type).toBe('application/zip')
    expect(zipBlob.size).toBeGreaterThan(0)
  })

  it('builds text and binary zip archives', async () => {
    const textZip = await buildTextZip('../notes.txt', 'hello')
    const binaryZip = await buildBinaryZip('bin/payload.bin', new Uint8Array([1, 2, 3]))

    expect(textZip.type).toBe('application/zip')
    expect(binaryZip.type).toBe('application/zip')
    expect(textZip.size).toBeGreaterThan(0)
    expect(binaryZip.size).toBeGreaterThan(0)
  })

  it('supports blob-like inputs without arrayBuffer and stream entries without modifiedAt', async () => {
    const blobLike = {
      size: 5,
      stream: () =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('hello'))
            controller.close()
          },
        }),
      type: 'text/plain',
    } as unknown as Blob

    const zipBlob = await buildZip([{ path: 'fallback/data.txt', blob: blobLike }])
    expect(zipBlob.type).toBe('application/zip')
    expect(zipBlob.size).toBeGreaterThan(0)

    const chunks: Uint8Array[] = []
    await expect(
      writeZipStream(
        [
          {
            path: 'fallback/data.txt',
            readable: new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new TextEncoder().encode('hello'))
                controller.close()
              },
            }),
            size: 5,
          },
        ],
        new WritableStream<Uint8Array>({
          write(chunk) {
            chunks.push(chunk)
          },
        }),
      ),
    ).resolves.toBeUndefined()
    expect(chunks.length).toBeGreaterThan(0)
  })
})

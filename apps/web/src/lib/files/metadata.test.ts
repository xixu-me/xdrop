import { afterEach, describe, expect, it, vi } from 'vitest'

import { stripMetadata } from './metadata'

describe('metadata stripping', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('re-encodes supported images when enabled', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 1, height: 1 })),
    )
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        width: number
        height: number

        constructor(width: number, height: number) {
          this.width = width
          this.height = height
        }

        getContext() {
          return {
            drawImage: vi.fn(),
          }
        }

        async convertToBlob() {
          return new Blob(['clean'], { type: 'image/png' })
        }
      },
    )

    const file = new File(['raw'], 'image.png', { type: 'image/png', lastModified: 123 })
    const result = await stripMetadata(file, true)

    expect(result.stripped).toBe(true)
    expect(result.file.size).toBeGreaterThan(0)
    expect(result.file.type).toBe('image/png')
    expect(result.file.name).toBe('image.png')
  })

  it('returns the original file when stripping is disabled or unsupported', async () => {
    const file = new File(['raw'], 'clip.mov', { type: 'video/quicktime', lastModified: 123 })

    await expect(stripMetadata(file, false)).resolves.toEqual({ file, stripped: false })
    await expect(stripMetadata(file, true)).resolves.toEqual({ file, stripped: false })
  })

  it('returns the original file when no drawing context is available', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 1, height: 1 })),
    )
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        constructor(width: number, height: number) {
          void width
          void height
        }

        getContext() {
          return null
        }
      },
    )

    const file = new File(['raw'], 'image.webp', { type: 'image/webp', lastModified: 321 })

    await expect(stripMetadata(file, true)).resolves.toEqual({ file, stripped: false })
  })

  it('falls back to HTML canvas export when OffscreenCanvas is unavailable', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 2, height: 3 })),
    )
    vi.stubGlobal('OffscreenCanvas', undefined)

    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation(() => {
      return {
        width: 0,
        height: 0,
        getContext: () => ({
          drawImage: vi.fn(),
        }),
        toBlob: (callback: (blob: Blob | null) => void) =>
          callback(new Blob(['clean'], { type: 'image/jpeg' })),
      } as unknown as HTMLCanvasElement
    })

    const file = new File(['raw'], 'image.jpg', { type: 'image/jpeg', lastModified: 456 })
    const result = await stripMetadata(file, true)

    expect(createElementSpy).toHaveBeenCalledWith('canvas')
    expect(result.stripped).toBe(true)
    expect(result.file.type).toBe('image/jpeg')
  })

  it('falls back to the original type when canvas export omits one', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 1, height: 1 })),
    )
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        constructor(width: number, height: number) {
          void width
          void height
        }

        getContext() {
          return {
            drawImage: vi.fn(),
          }
        }

        async convertToBlob() {
          return new Blob(['clean'])
        }
      },
    )

    const file = new File(['raw'], 'image.png', { type: 'image/png', lastModified: 321 })
    const result = await stripMetadata(file, true)

    expect(result.stripped).toBe(true)
    expect(result.file.type).toBe('image/png')
  })

  it('surfaces HTML canvas export failures', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 2, height: 3 })),
    )
    vi.stubGlobal('OffscreenCanvas', undefined)

    vi.spyOn(document, 'createElement').mockImplementation(() => {
      return {
        width: 0,
        height: 0,
        getContext: () => ({
          drawImage: vi.fn(),
        }),
        toBlob: (callback: (blob: Blob | null) => void) => callback(null),
      } as unknown as HTMLCanvasElement
    })

    const file = new File(['raw'], 'image.jpg', { type: 'image/jpeg', lastModified: 456 })

    await expect(stripMetadata(file, true)).rejects.toThrow('Canvas export failed')
  })
})

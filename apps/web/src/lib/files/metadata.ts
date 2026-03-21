/**
 * Client-side helpers for removing metadata before encryption.
 */

/** MetadataStripResult reports whether the returned file differs from the original input. */
export type MetadataStripResult = {
  file: File
  stripped: boolean
}

const STRIPPABLE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

/** stripMetadata redraws supported image types to drop removable metadata like EXIF blocks. */
export async function stripMetadata(file: File, enabled: boolean): Promise<MetadataStripResult> {
  if (!enabled || !STRIPPABLE_IMAGE_TYPES.has(file.type)) {
    return { file, stripped: false }
  }

  const bitmap = await createImageBitmap(file)
  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(bitmap.width, bitmap.height)
      : Object.assign(document.createElement('canvas'), {
          width: bitmap.width,
          height: bitmap.height,
        })

  const context = canvas.getContext('2d')
  if (!context) {
    return { file, stripped: false }
  }

  context.drawImage(bitmap, 0, 0)

  const blob =
    'convertToBlob' in canvas
      ? await (canvas as OffscreenCanvas).convertToBlob({ type: file.type, quality: 0.95 })
      : await new Promise<Blob>((resolve, reject) => {
          ;(canvas as HTMLCanvasElement).toBlob(
            (result) => {
              if (result) {
                resolve(result)
                return
              }
              reject(new Error('Canvas export failed'))
            },
            file.type,
            0.95,
          )
        })

  return {
    file: new File([blob], file.name, {
      type: blob.type || file.type,
      lastModified: file.lastModified,
    }),
    stripped: true,
  }
}

/** videoMetadataStripEnabled keeps the unfinished video path behind an explicit feature flag. */
export const videoMetadataStripEnabled = import.meta.env.VITE_ENABLE_VIDEO_METADATA_STRIP === 'true'

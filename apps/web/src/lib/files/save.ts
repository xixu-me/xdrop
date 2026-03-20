/**
 * Download helpers that use the File System Access API when available and anchor downloads otherwise.
 */

type FilePickerAcceptTypeLike = {
  description?: string
  accept: Record<string, string[]>
}

type FileSystemWriteChunk =
  | BufferSource
  | Blob
  | string
  | {
      type: 'write'
      position?: number
      data: BufferSource | Blob | string
    }
  | {
      type: 'seek'
      position: number
    }
  | {
      type: 'truncate'
      size: number
    }

export type FileSystemWritableLike = WritableStream<Uint8Array> & {
  write: (data: FileSystemWriteChunk) => Promise<void>
  close: () => Promise<void>
  abort: (reason?: unknown) => Promise<void>
}

type FileSystemFileHandleLike = {
  createWritable: (options?: { keepExistingData?: boolean }) => Promise<FileSystemWritableLike>
}

type WindowWithSavePicker = Window & {
  showSaveFilePicker?: (options?: {
    suggestedName?: string
    types?: FilePickerAcceptTypeLike[]
    excludeAcceptAllOption?: boolean
  }) => Promise<FileSystemFileHandleLike>
}

/** supportsStreamingSave detects whether the browser can stream directly to a picked file. */
export function supportsStreamingSave() {
  return (
    typeof window !== 'undefined' &&
    typeof (window as WindowWithSavePicker).showSaveFilePicker === 'function'
  )
}

/** openSaveWritable opens a writable file handle for streaming downloads when supported. */
export async function openSaveWritable(suggestedName: string, options?: { mimeType?: string }) {
  const picker = (window as WindowWithSavePicker).showSaveFilePicker
  if (!picker) {
    return null
  }

  const type = buildPickerType(suggestedName, options?.mimeType)
  const handle = await picker(
    type
      ? {
          suggestedName,
          types: [type],
        }
      : { suggestedName },
  )

  return handle.createWritable({ keepExistingData: false })
}

/** saveBlob falls back to a standard browser download using an object URL. */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

/** isAbortError normalizes user-cancelled file picker errors for callers. */
export function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

function buildPickerType(
  suggestedName: string,
  mimeType?: string,
): FilePickerAcceptTypeLike | undefined {
  const extension = extensionFromName(suggestedName)
  if (!mimeType || !extension) {
    return undefined
  }

  return {
    description: mimeType,
    accept: {
      [mimeType]: [extension],
    },
  }
}

function extensionFromName(filename: string) {
  const dot = filename.lastIndexOf('.')
  if (dot <= 0) {
    return undefined
  }

  return filename.slice(dot)
}

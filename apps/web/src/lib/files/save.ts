/**
 * Download helpers that hand files to the browser's normal download manager.
 */

/** saveBlob triggers a standard browser download using an object URL. */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')

  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  anchor.click()

  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

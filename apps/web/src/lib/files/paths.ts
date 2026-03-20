/** sanitizePath removes traversal segments and unsupported filename characters. */
export function sanitizePath(input: string) {
  return input
    .split(/[\\/]+/u)
    .filter((segment) => segment && segment !== '.' && segment !== '..')
    .map((segment) =>
      Array.from(segment.replace(/[<>:"|?*]/gu, '_'))
        .map((char) => ((char.codePointAt(0) ?? 0) < 32 ? '_' : char))
        .join(''),
    )
    .join('/')
}

/** safeDownloadName returns a sanitized basename suitable for `download=` attributes. */
export function safeDownloadName(path: string) {
  const sanitized = sanitizePath(path)
  const parts = sanitized.split('/')
  return parts.at(-1) || 'download.bin'
}

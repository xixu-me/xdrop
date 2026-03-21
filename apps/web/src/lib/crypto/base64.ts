/**
 * Small helpers for browser-safe base64 and base64url conversions.
 */

/** toBase64Url serializes bytes for URL fragments without padding. */
export function toBase64Url(input: Uint8Array): string {
  const binary = Array.from(input, (byte) => String.fromCharCode(byte)).join('')
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '')
}

/** fromBase64Url restores bytes from a URL-safe base64 string. */
export function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  const binary = atob(padded)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

/** toBase64 serializes bytes into standard base64 text. */
export function toBase64(input: Uint8Array): string {
  const binary = Array.from(input, (byte) => String.fromCharCode(byte)).join('')
  return btoa(binary)
}

/** fromBase64 restores bytes from a standard base64 string. */
export function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

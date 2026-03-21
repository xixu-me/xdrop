import { fromBase64Url, toBase64Url } from './base64'

/** serializeLinkKey formats the recipient decryption key for the `#k=` URL fragment. */
export function serializeLinkKey(linkKey: Uint8Array) {
  return toBase64Url(linkKey)
}

/** parseLinkKey extracts the recipient decryption key from a hash fragment. */
export function parseLinkKey(fragment: string | undefined) {
  if (!fragment) {
    return null
  }

  const normalized = fragment.startsWith('#') ? fragment.slice(1) : fragment
  const params = new URLSearchParams(normalized)
  const key = params.get('k')
  if (!key) {
    return null
  }

  try {
    return fromBase64Url(key)
  } catch {
    return null
  }
}

/**
 * Browser-side cryptography for manifests, chunk payloads, and shared-link key wrapping.
 */

import { MANIFEST_VERSION, WRAP_VERSION } from '@xdrop/shared'

import type { EncryptedManifestEnvelope, ManifestV1, WrappedRootEnvelope } from '@/lib/api/types'
import { fromBase64Url, toBase64, toBase64Url } from './base64'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** generateSecret returns cryptographically secure random bytes for keys, IVs, and nonces. */
export async function generateSecret(bytes = 32) {
  const buffer = new Uint8Array(bytes)
  crypto.getRandomValues(buffer)
  return buffer
}

/** wrapRootKey encrypts the transfer root key with the recipient link key. */
export async function wrapRootKey(rootKey: Uint8Array, linkKey: Uint8Array): Promise<string> {
  const wrappingKey = await deriveHkdfKey(linkKey, 'wrap-root')
  const iv = await generateSecret(12)
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(iv),
    },
    wrappingKey,
    toArrayBuffer(rootKey),
  )

  const envelope: WrappedRootEnvelope = {
    version: WRAP_VERSION,
    iv: toBase64Url(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
  }

  return JSON.stringify(envelope)
}

/** unwrapRootKey decrypts the serialized root-key envelope carried inside the share link. */
export async function unwrapRootKey(
  serializedEnvelope: string,
  linkKey: Uint8Array,
): Promise<Uint8Array> {
  const envelope = JSON.parse(serializedEnvelope) as WrappedRootEnvelope
  const wrappingKey = await deriveHkdfKey(linkKey, 'wrap-root')
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(fromBase64Url(envelope.iv)),
    },
    wrappingKey,
    toArrayBuffer(Uint8Array.from(atob(envelope.ciphertext), (char) => char.charCodeAt(0))),
  )

  return new Uint8Array(plaintext)
}

/** encryptManifest encrypts the JSON manifest that recipients use to reconstruct file metadata. */
export async function encryptManifest(
  rootKey: Uint8Array,
  manifest: ManifestV1,
): Promise<Uint8Array> {
  const manifestKey = await deriveHkdfKey(rootKey, 'manifest')
  const iv = await generateSecret(12)
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(iv),
    },
    manifestKey,
    toArrayBuffer(encoder.encode(JSON.stringify(manifest))),
  )

  const envelope: EncryptedManifestEnvelope = {
    version: MANIFEST_VERSION,
    iv: toBase64Url(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
  }

  return encoder.encode(JSON.stringify(envelope))
}

/** decryptManifest reverses manifest encryption after the recipient unwraps the root key. */
export async function decryptManifest(
  rootKey: Uint8Array,
  envelopeBytes: Uint8Array,
): Promise<ManifestV1> {
  const envelope = JSON.parse(decoder.decode(envelopeBytes)) as EncryptedManifestEnvelope
  const manifestKey = await deriveHkdfKey(rootKey, 'manifest')
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(fromBase64Url(envelope.iv)),
    },
    manifestKey,
    toArrayBuffer(Uint8Array.from(atob(envelope.ciphertext), (char) => char.charCodeAt(0))),
  )

  return JSON.parse(decoder.decode(plaintext)) as ManifestV1
}

/** encryptChunk encrypts one plaintext chunk and returns ciphertext plus an integrity checksum. */
export async function encryptChunk(options: {
  rootKey: Uint8Array
  transferId: string
  fileId: string
  chunkIndex: number
  noncePrefix: Uint8Array
  plaintextChunkSize: number
  plaintext: Uint8Array
}) {
  const fileKey = await deriveHkdfKey(options.rootKey, `file:${options.fileId}`)
  const iv = buildChunkIv(options.noncePrefix, options.chunkIndex)
  // Bind chunk metadata into AES-GCM so chunks cannot be replayed across files or transfers.
  const additionalData = encoder.encode(
    [
      options.transferId,
      options.fileId,
      options.chunkIndex,
      options.plaintextChunkSize,
      MANIFEST_VERSION,
    ].join('|'),
  )
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(iv),
      additionalData: toArrayBuffer(additionalData),
    },
    fileKey,
    toArrayBuffer(options.plaintext),
  )

  const checksum = await crypto.subtle.digest('SHA-256', ciphertext)

  return {
    ciphertext: new Uint8Array(ciphertext),
    checksumHex: Array.from(new Uint8Array(checksum), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join(''),
  }
}

/** decryptChunk validates the authenticated metadata and returns the original plaintext bytes. */
export async function decryptChunk(options: {
  rootKey: Uint8Array
  transferId: string
  fileId: string
  chunkIndex: number
  noncePrefix: Uint8Array
  plaintextChunkSize: number
  ciphertext: Uint8Array
}) {
  const fileKey = await deriveHkdfKey(options.rootKey, `file:${options.fileId}`)
  const iv = buildChunkIv(options.noncePrefix, options.chunkIndex)
  const additionalData = encoder.encode(
    [
      options.transferId,
      options.fileId,
      options.chunkIndex,
      options.plaintextChunkSize,
      MANIFEST_VERSION,
    ].join('|'),
  )
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(iv),
      additionalData: toArrayBuffer(additionalData),
    },
    fileKey,
    toArrayBuffer(options.ciphertext),
  )

  return new Uint8Array(plaintext)
}

/** buildChunkIv combines the per-file nonce prefix with the chunk index. */
export function buildChunkIv(noncePrefix: Uint8Array, chunkIndex: number) {
  const iv = new Uint8Array(12)
  iv.set(noncePrefix.slice(0, 8), 0)
  new DataView(iv.buffer).setUint32(8, chunkIndex, false)
  return iv
}

/** deriveHkdfKey scopes a secret into a purpose-specific AES-GCM key. */
export async function deriveHkdfKey(source: Uint8Array, info: string) {
  const sourceKey = await crypto.subtle.importKey('raw', toArrayBuffer(source), 'HKDF', false, [
    'deriveKey',
  ])
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(),
      info: encoder.encode(info),
    },
    sourceKey,
    {
      name: 'AES-GCM',
      length: 256,
    },
    false,
    ['encrypt', 'decrypt'],
  )
}

function toArrayBuffer(input: Uint8Array) {
  return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer
}

import { describe, expect, it } from 'vitest'

import type { ManifestV1 } from '@/lib/api/types'
import {
  buildChunkIv,
  decryptChunk,
  decryptManifest,
  encryptChunk,
  encryptManifest,
  generateSecret,
  unwrapRootKey,
  wrapRootKey,
} from './envelope'
import { fromBase64Url } from './base64'

describe('crypto envelope', () => {
  it('wraps and unwraps the transfer root key', async () => {
    const rootKey = await generateSecret(32)
    const linkKey = await generateSecret(32)

    const wrapped = await wrapRootKey(rootKey, linkKey)
    const unwrapped = await unwrapRootKey(wrapped, linkKey)

    expect(Array.from(unwrapped)).toEqual(Array.from(rootKey))
  })

  it('encrypts and decrypts the manifest', async () => {
    const rootKey = await generateSecret(32)
    const manifest: ManifestV1 = {
      version: 1,
      displayName: 'Capsule',
      createdAt: new Date().toISOString(),
      chunkSize: 8 * 1024 * 1024,
      files: [
        {
          fileId: 'f1',
          name: 'photo.png',
          relativePath: 'family/photo.png',
          mimeType: 'image/png',
          plaintextSize: 42,
          modifiedAt: 123,
          chunkSize: 1024,
          totalChunks: 1,
          ciphertextSizes: [58],
          noncePrefix: 'AQIDBAUGBwg',
          metadataStripped: true,
        },
      ],
    }

    const encrypted = await encryptManifest(rootKey, manifest)
    const decrypted = await decryptManifest(rootKey, encrypted)

    expect(decrypted).toEqual(manifest)
  })

  it('encrypts and decrypts a chunk with authenticated additional data', async () => {
    const rootKey = await generateSecret(32)
    const noncePrefix = fromBase64Url('AQIDBAUGBwg')
    const plaintext = new TextEncoder().encode('hello encrypted world')

    const encrypted = await encryptChunk({
      rootKey,
      transferId: 'transfer-1',
      fileId: 'file-1',
      chunkIndex: 0,
      noncePrefix,
      plaintextChunkSize: plaintext.byteLength,
      plaintext,
    })

    const decrypted = await decryptChunk({
      rootKey,
      transferId: 'transfer-1',
      fileId: 'file-1',
      chunkIndex: 0,
      noncePrefix,
      plaintextChunkSize: plaintext.byteLength,
      ciphertext: encrypted.ciphertext,
    })

    expect(new TextDecoder().decode(decrypted)).toBe('hello encrypted world')
    expect(Array.from(buildChunkIv(noncePrefix, 0))).toHaveLength(12)
  })
})

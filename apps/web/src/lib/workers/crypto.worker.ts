/// <reference lib="webworker" />

/**
 * Dedicated crypto worker that keeps encryption and decryption off the main thread.
 */

import type { ManifestV1 } from '@/lib/api/types'
import {
  decryptChunk,
  decryptManifest,
  encryptChunk,
  encryptManifest,
  unwrapRootKey,
  wrapRootKey,
} from '@/lib/crypto/envelope'

type RequestMessage =
  | {
      id: number
      type: 'wrap-root'
      payload: { rootKey: Uint8Array; linkKey: Uint8Array }
    }
  | {
      id: number
      type: 'unwrap-root'
      payload: { wrappedRootKey: string; linkKey: Uint8Array }
    }
  | {
      id: number
      type: 'encrypt-manifest'
      payload: { rootKey: Uint8Array; manifest: ManifestV1 }
    }
  | {
      id: number
      type: 'decrypt-manifest'
      payload: { rootKey: Uint8Array; envelopeBytes: Uint8Array }
    }
  | {
      id: number
      type: 'encrypt-chunk'
      payload: {
        rootKey: Uint8Array
        transferId: string
        fileId: string
        chunkIndex: number
        noncePrefix: Uint8Array
        plaintextChunkSize: number
        plaintext: Uint8Array
      }
    }
  | {
      id: number
      type: 'decrypt-chunk'
      payload: {
        rootKey: Uint8Array
        transferId: string
        fileId: string
        chunkIndex: number
        noncePrefix: Uint8Array
        plaintextChunkSize: number
        ciphertext: Uint8Array
      }
    }

type ResponseMessage = {
  id: number
  ok: boolean
  payload?: unknown
  error?: string
}

/** Each message performs one crypto operation and posts a matching success or error response. */
self.onmessage = async (event: MessageEvent<RequestMessage>) => {
  const message = event.data

  try {
    switch (message.type) {
      case 'wrap-root': {
        const payload = await wrapRootKey(message.payload.rootKey, message.payload.linkKey)
        postMessage({ id: message.id, ok: true, payload } satisfies ResponseMessage)
        return
      }
      case 'unwrap-root': {
        const payload = await unwrapRootKey(message.payload.wrappedRootKey, message.payload.linkKey)
        postMessage({ id: message.id, ok: true, payload }, [payload.buffer])
        return
      }
      case 'encrypt-manifest': {
        const payload = await encryptManifest(message.payload.rootKey, message.payload.manifest)
        postMessage({ id: message.id, ok: true, payload }, [payload.buffer])
        return
      }
      case 'decrypt-manifest': {
        const payload = await decryptManifest(
          message.payload.rootKey,
          message.payload.envelopeBytes,
        )
        postMessage({ id: message.id, ok: true, payload } satisfies ResponseMessage)
        return
      }
      case 'encrypt-chunk': {
        const payload = await encryptChunk(message.payload)
        postMessage({ id: message.id, ok: true, payload }, [payload.ciphertext.buffer])
        return
      }
      case 'decrypt-chunk': {
        const payload = await decryptChunk(message.payload)
        postMessage({ id: message.id, ok: true, payload }, [payload.buffer])
        return
      }
    }
  } catch (error) {
    postMessage({
      id: message.id,
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown worker error',
    } satisfies ResponseMessage)
  }
}

/**
 * Main-thread wrapper around the crypto web worker.
 */

import type { ManifestV1 } from '@/lib/api/types'

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (reason?: unknown) => void
}

/** CryptoWorkerClient marshals crypto jobs into a dedicated worker thread. */
class CryptoWorkerClient {
  private readonly worker = new Worker(new URL('./crypto.worker.ts', import.meta.url), {
    type: 'module',
  })
  private readonly pending = new Map<number, PendingRequest>()
  private requestId = 0

  constructor() {
    this.worker.onmessage = (
      event: MessageEvent<{ id: number; ok: boolean; payload?: unknown; error?: string }>,
    ) => {
      const handler = this.pending.get(event.data.id)
      if (!handler) {
        return
      }

      this.pending.delete(event.data.id)
      if (event.data.ok) {
        handler.resolve(event.data.payload)
        return
      }

      handler.reject(new Error(event.data.error ?? 'Worker request failed'))
    }
  }

  wrapRootKey(rootKey: Uint8Array, linkKey: Uint8Array) {
    return this.request<string>('wrap-root', { rootKey, linkKey })
  }

  unwrapRootKey(wrappedRootKey: string, linkKey: Uint8Array) {
    return this.request<Uint8Array>('unwrap-root', { wrappedRootKey, linkKey })
  }

  encryptManifest(rootKey: Uint8Array, manifest: ManifestV1) {
    return this.request<Uint8Array>('encrypt-manifest', { rootKey, manifest })
  }

  decryptManifest(rootKey: Uint8Array, envelopeBytes: Uint8Array) {
    return this.request<ManifestV1>('decrypt-manifest', { rootKey, envelopeBytes })
  }

  encryptChunk(payload: {
    rootKey: Uint8Array
    transferId: string
    fileId: string
    chunkIndex: number
    noncePrefix: Uint8Array
    plaintextChunkSize: number
    plaintext: Uint8Array
  }) {
    return this.request<{ ciphertext: Uint8Array; checksumHex: string }>('encrypt-chunk', payload, [
      payload.plaintext.buffer,
    ])
  }

  decryptChunk(payload: {
    rootKey: Uint8Array
    transferId: string
    fileId: string
    chunkIndex: number
    noncePrefix: Uint8Array
    plaintextChunkSize: number
    ciphertext: Uint8Array
  }) {
    return this.request<Uint8Array>('decrypt-chunk', payload, [payload.ciphertext.buffer])
  }

  /** request posts a typed message to the worker and resolves when the matching reply arrives. */
  private request<T>(
    type: string,
    payload: Record<string, unknown>,
    transferables: Transferable[] = [],
  ) {
    const id = ++this.requestId
    const promise = new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      })
    })

    this.worker.postMessage({ id, type, payload }, transferables)
    return promise
  }
}

/** cryptoWorker is the shared worker client used by upload and download flows. */
export const cryptoWorker = new CryptoWorkerClient()

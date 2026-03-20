/**
 * Shared browser-side types for the HTTP API and encrypted manifest payloads.
 */

import type { ExpiryOption } from '@xdrop/shared'

export type UploadConfig = {
  chunkSize: number
  maxParallel: number
  maxFileCount: number
  maxTransferBytes: number
}

export type CreateTransferResponse = {
  transferId: string
  manageToken: string
  uploadConfig: UploadConfig
  expiresAt: string
}

export type RegisterFileRequest = {
  fileId: string
  totalChunks: number
  ciphertextBytes: number
  plaintextBytes: number
  chunkSize: number
}

export type UploadChunkRequest = {
  fileId: string
  chunkIndex: number
}

export type UploadURLItem = UploadChunkRequest & {
  objectKey: string
  url: string
}

export type CompleteChunkRequest = UploadChunkRequest & {
  ciphertextSize: number
  checksumSha256: string
}

/** PublicTransferDescriptor is the only transfer metadata visible to recipients. */
export type PublicTransferDescriptor = {
  id: string
  status: 'ready' | 'expired' | 'deleted' | 'incomplete'
  expiresAt: string
  wrappedRootKey?: string
  manifestUrl?: string
  manifestCiphertextSize?: number
  downloadConfig?: {
    presignTtlSeconds: number
  }
}

/** ManageTransferResponse powers sender-side resume, progress, and cleanup controls. */
export type ManageTransferResponse = {
  id: string
  status: string
  expiresAt: string
  createdAt: string
  updatedAt: string
  finalizedAt?: string
  manifestCiphertextSize: number
  totalFiles: number
  totalCiphertextBytes: number
  files: Array<{
    fileId: string
    totalChunks: number
    ciphertextBytes: number
    chunkSize: number
    uploadStatus: string
  }>
  uploadedChunks?: Record<string, number[]>
}

export type UpdateTransferRequest = {
  expiresInSeconds?: ExpiryOption
  ciphertextBase64?: string
}

export type EncryptedManifestEnvelope = {
  version: number
  iv: string
  ciphertext: string
}

export type WrappedRootEnvelope = {
  version: number
  iv: string
  ciphertext: string
}

/** ManifestFileEntry describes one file inside the encrypted manifest. */
export type ManifestFileEntry = {
  fileId: string
  name: string
  relativePath: string
  mimeType: string
  plaintextSize: number
  modifiedAt: number
  chunkSize: number
  totalChunks: number
  ciphertextSizes: number[]
  noncePrefix: string
  metadataStripped: boolean
}

/** ManifestV1 is the decrypted file listing downloaded by recipients. */
export type ManifestV1 = {
  version: number
  displayName: string
  createdAt: string
  chunkSize: number
  files: ManifestFileEntry[]
}

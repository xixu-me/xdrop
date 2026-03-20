/**
 * Thin browser client for the Xdrop HTTP API.
 */

import type {
  CompleteChunkRequest,
  CreateTransferResponse,
  ManageTransferResponse,
  PublicTransferDescriptor,
  RegisterFileRequest,
  UpdateTransferRequest,
  UploadChunkRequest,
  UploadURLItem,
} from './types'

type JSONValue = Record<string, unknown> | unknown[] | string | number | boolean | null
type RequestOptions = { signal?: AbortSignal }

/** APIClient centralizes JSON request handling and auth header wiring for the browser app. */
export class APIClient {
  private readonly baseUrl: string

  constructor(baseUrl = import.meta.env.VITE_API_BASE_URL ?? '/api/v1') {
    this.baseUrl = baseUrl
  }

  async createTransfer(expiresInSeconds: number, options?: RequestOptions) {
    return this.request<CreateTransferResponse>('/transfers', {
      method: 'POST',
      body: { expiresInSeconds },
      ...(options?.signal ? { signal: options.signal } : {}),
    })
  }

  async registerFiles(
    transferId: string,
    manageToken: string,
    files: RegisterFileRequest[],
    options?: RequestOptions,
  ) {
    await this.request(`/transfers/${transferId}/files`, {
      method: 'POST',
      token: manageToken,
      body: files,
      ...(options?.signal ? { signal: options.signal } : {}),
    })
  }

  async createUploadUrls(
    transferId: string,
    manageToken: string,
    chunks: UploadChunkRequest[],
    options?: RequestOptions,
  ) {
    const response = await this.request<{ items: UploadURLItem[] }>(
      `/transfers/${transferId}/upload-urls`,
      {
        method: 'POST',
        token: manageToken,
        body: { chunks },
        ...(options?.signal ? { signal: options.signal } : {}),
      },
    )
    return response.items
  }

  async completeChunks(
    transferId: string,
    manageToken: string,
    chunks: CompleteChunkRequest[],
    options?: RequestOptions,
  ) {
    await this.request(`/transfers/${transferId}/chunks/complete`, {
      method: 'POST',
      token: manageToken,
      body: chunks,
      ...(options?.signal ? { signal: options.signal } : {}),
    })
  }

  async uploadManifest(
    transferId: string,
    manageToken: string,
    ciphertextBase64: string,
    options?: RequestOptions,
  ) {
    await this.request(`/transfers/${transferId}/manifest`, {
      method: 'POST',
      token: manageToken,
      body: { ciphertextBase64 },
      ...(options?.signal ? { signal: options.signal } : {}),
    })
  }

  async finalizeTransfer(
    transferId: string,
    manageToken: string,
    wrappedRootKey: string,
    totalFiles: number,
    totalCiphertextBytes: number,
    options?: RequestOptions,
  ) {
    await this.request(`/transfers/${transferId}/finalize`, {
      method: 'POST',
      token: manageToken,
      body: { wrappedRootKey, totalFiles, totalCiphertextBytes },
      ...(options?.signal ? { signal: options.signal } : {}),
    })
  }

  async getManageTransfer(transferId: string, manageToken: string, options?: RequestOptions) {
    return this.request<ManageTransferResponse>(`/transfers/${transferId}`, {
      method: 'GET',
      token: manageToken,
      ...(options?.signal ? { signal: options.signal } : {}),
    })
  }

  async resumeTransfer(transferId: string, manageToken: string, options?: RequestOptions) {
    return this.request<ManageTransferResponse>(`/transfers/${transferId}/resume`, {
      method: 'GET',
      token: manageToken,
      ...(options?.signal ? { signal: options.signal } : {}),
    })
  }

  async updateTransfer(
    transferId: string,
    manageToken: string,
    request: UpdateTransferRequest,
    options?: RequestOptions,
  ) {
    await this.request(`/transfers/${transferId}`, {
      method: 'PATCH',
      token: manageToken,
      body: request,
      ...(options?.signal ? { signal: options.signal } : {}),
    })
  }

  async deleteTransfer(transferId: string, manageToken: string, options?: RequestOptions) {
    await this.request(`/transfers/${transferId}`, {
      method: 'DELETE',
      token: manageToken,
      ...(options?.signal ? { signal: options.signal } : {}),
    })
  }

  async getPublicTransfer(transferId: string, options?: RequestOptions) {
    return this.request<PublicTransferDescriptor>(`/public/transfers/${transferId}`, {
      method: 'GET',
      ...(options?.signal ? { signal: options.signal } : {}),
    })
  }

  async createDownloadUrls(
    transferId: string,
    chunks: UploadChunkRequest[],
    options?: RequestOptions,
  ) {
    const response = await this.request<{ items: Array<UploadChunkRequest & { url: string }> }>(
      `/public/transfers/${transferId}/download-urls`,
      {
        method: 'POST',
        body: { chunks },
        ...(options?.signal ? { signal: options.signal } : {}),
      },
    )
    return response.items
  }

  /** request performs a JSON fetch and normalizes API errors into thrown Error objects. */
  private async request<T = void>(
    path: string,
    options: {
      method: string
      token?: string
      body?: JSONValue
      signal?: AbortSignal
    },
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: options.method,
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      headers: {
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
    })

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as {
        message?: string
        error?: string
      }
      throw new Error(payload.message ?? payload.error ?? `Request failed with ${response.status}`)
    }

    if (response.status === 204) {
      return undefined as T
    }

    return (await response.json()) as T
  }
}

/** apiClient is the shared singleton used throughout the browser application. */
export const apiClient = new APIClient()

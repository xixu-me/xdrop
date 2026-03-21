import { afterEach, describe, expect, it, vi } from 'vitest'

import { APIClient } from './client'

describe('APIClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends authenticated JSON requests for write operations', async () => {
    const fetchMock = vi.fn(async () => ({
      json: async () => ({
        expiresAt: '2026-03-21T08:00:00.000Z',
        manageToken: 'manage-token',
        transferId: 't1',
        uploadConfig: { chunkSize: 8 },
      }),
      ok: true,
      status: 200,
    }))
    vi.stubGlobal('fetch', fetchMock)

    const client = new APIClient('/api/test')
    await expect(client.createTransfer(3600)).resolves.toMatchObject({
      transferId: 't1',
      uploadConfig: { chunkSize: 8 },
    })

    await client.registerFiles('t1', 'manage-token', [
      {
        chunkSize: 8,
        ciphertextBytes: 24,
        fileId: 'file-1',
        plaintextBytes: 8,
        totalChunks: 1,
      },
    ])
    await client.completeChunks('t1', 'manage-token', [
      {
        checksumSha256: 'abc',
        chunkIndex: 0,
        ciphertextSize: 24,
        fileId: 'file-1',
      },
    ])
    await client.uploadManifest('t1', 'manage-token', 'ciphertext')
    await client.finalizeTransfer('t1', 'manage-token', 'wrapped', 1, 24)
    await client.updateTransfer('t1', 'manage-token', { expiresInSeconds: 7200 })
    await client.deleteTransfer('t1', 'manage-token')

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/test/transfers',
      expect.objectContaining({
        body: JSON.stringify({ expiresInSeconds: 3600 }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }),
    )
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/test/transfers/t1/files',
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer manage-token',
          'Content-Type': 'application/json',
        },
        method: 'POST',
      }),
    )
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/test/transfers/t1',
      expect.objectContaining({
        headers: { Authorization: 'Bearer manage-token' },
        method: 'DELETE',
      }),
    )
  })

  it('returns list payloads for read operations', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/upload-urls')) {
        return {
          json: async () => ({
            items: [{ chunkIndex: 0, fileId: 'file-1', url: 'https://upload' }],
          }),
          ok: true,
          status: 200,
        }
      }
      if (url.endsWith('/download-urls')) {
        return {
          json: async () => ({
            items: [{ chunkIndex: 0, fileId: 'file-1', url: 'https://download' }],
          }),
          ok: true,
          status: 200,
        }
      }
      return {
        json: async () => ({ files: [], id: 't1', status: 'ready' }),
        ok: true,
        status: 200,
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    const client = new APIClient('/api/test')

    await expect(
      client.createUploadUrls('t1', 'manage-token', [{ chunkIndex: 0, fileId: 'file-1' }]),
    ).resolves.toEqual([{ chunkIndex: 0, fileId: 'file-1', url: 'https://upload' }])
    await expect(client.getManageTransfer('t1', 'manage-token')).resolves.toMatchObject({
      id: 't1',
    })
    await expect(client.resumeTransfer('t1', 'manage-token')).resolves.toMatchObject({
      status: 'ready',
    })
    await expect(client.getPublicTransfer('t1')).resolves.toMatchObject({
      id: 't1',
    })
    await expect(
      client.createDownloadUrls('t1', [{ chunkIndex: 0, fileId: 'file-1' }]),
    ).resolves.toEqual([{ chunkIndex: 0, fileId: 'file-1', url: 'https://download' }])
  })

  it('returns undefined for no-content responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 204,
      })),
    )

    const client = new APIClient('/api/test')

    await expect(client.deleteTransfer('t1', 'manage-token')).resolves.toBeUndefined()
  })

  it('passes abort signals through every request helper and uses the default base url', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/transfers')) {
        return {
          json: async () => ({
            expiresAt: '2026-03-21T08:00:00.000Z',
            manageToken: 'manage-token',
            transferId: 't1',
            uploadConfig: { chunkSize: 8 },
          }),
          ok: true,
          status: 200,
        }
      }
      if (url.endsWith('/upload-urls')) {
        return {
          json: async () => ({
            items: [{ chunkIndex: 0, fileId: 'file-1', url: 'https://upload' }],
          }),
          ok: true,
          status: 200,
        }
      }
      if (url.endsWith('/download-urls')) {
        return {
          json: async () => ({
            items: [{ chunkIndex: 0, fileId: 'file-1', url: 'https://download' }],
          }),
          ok: true,
          status: 200,
        }
      }
      if (
        url.includes('/public/transfers/') ||
        url.endsWith('/resume') ||
        /^\/api\/v1\/transfers\/t1$/u.test(url)
      ) {
        return {
          json: async () => ({
            expiresAt: '2026-03-21T08:00:00.000Z',
            files: [],
            id: 't1',
            status: 'ready',
          }),
          ok: true,
          status: 200,
        }
      }

      return {
        ok: true,
        status: 204,
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    const client = new APIClient()
    const signal = new AbortController().signal

    await client.createTransfer(3600, { signal })
    await client.registerFiles(
      't1',
      'manage-token',
      [{ chunkSize: 8, ciphertextBytes: 24, fileId: 'file-1', plaintextBytes: 8, totalChunks: 1 }],
      { signal },
    )
    await client.createUploadUrls('t1', 'manage-token', [{ chunkIndex: 0, fileId: 'file-1' }], {
      signal,
    })
    await client.completeChunks(
      't1',
      'manage-token',
      [{ checksumSha256: 'abc', chunkIndex: 0, ciphertextSize: 24, fileId: 'file-1' }],
      { signal },
    )
    await client.uploadManifest('t1', 'manage-token', 'ciphertext', { signal })
    await client.finalizeTransfer('t1', 'manage-token', 'wrapped', 1, 24, { signal })
    await client.getManageTransfer('t1', 'manage-token', { signal })
    await client.resumeTransfer('t1', 'manage-token', { signal })
    await client.updateTransfer('t1', 'manage-token', { expiresInSeconds: 7200 }, { signal })
    await client.deleteTransfer('t1', 'manage-token', { signal })
    await client.getPublicTransfer('t1', { signal })
    await client.createDownloadUrls('t1', [{ chunkIndex: 0, fileId: 'file-1' }], { signal })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/transfers',
      expect.objectContaining({ method: 'POST', signal }),
    )
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/public/transfers/t1',
      expect.objectContaining({ method: 'GET', signal }),
    )
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/transfers/t1',
      expect.objectContaining({
        headers: { Authorization: 'Bearer manage-token' },
        method: 'DELETE',
        signal,
      }),
    )
  })

  it('uses server messages or status codes for failed requests', async () => {
    const jsonErrorFetch = vi.fn(async () => ({
      json: async () => ({ message: 'bad request' }),
      ok: false,
      status: 400,
    }))
    vi.stubGlobal('fetch', jsonErrorFetch)

    const client = new APIClient('/api/test')
    await expect(client.getPublicTransfer('t1')).rejects.toThrow('bad request')

    const fallbackFetch = vi.fn(async () => ({
      json: async () => {
        throw new Error('not json')
      },
      ok: false,
      status: 503,
    }))
    vi.stubGlobal('fetch', fallbackFetch)

    await expect(client.getPublicTransfer('t1')).rejects.toThrow('Request failed with 503')
  })

  it('falls back to the server error field when no message is present', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        json: async () => ({ error: 'token expired' }),
        ok: false,
        status: 401,
      })),
    )

    const client = new APIClient('/api/test')

    await expect(client.getManageTransfer('t1', 'manage-token')).rejects.toThrow('token expired')
  })
})

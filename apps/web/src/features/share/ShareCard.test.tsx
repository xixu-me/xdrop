import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { LocalTransferRecord } from '@/lib/indexeddb/db'

const { toDataUrlMock } = vi.hoisted(() => ({
  toDataUrlMock: vi.fn(async () => 'data:image/png;base64,qr'),
}))

vi.mock('qrcode', () => ({
  default: {
    toDataURL: toDataUrlMock,
  },
}))

import { ShareCard } from './ShareCard'

function createTransfer(
  id: string,
  displayName: string,
  expiresAt: string,
  overrides: Partial<LocalTransferRecord> = {},
): LocalTransferRecord {
  return {
    clearLocalSecretsOnReady: false,
    createdAt: '2026-03-20T08:00:00.000Z',
    displayName,
    expiresAt,
    files: [],
    id,
    linkKeyBase64Url: 'AQID',
    localManagementCleared: false,
    manageToken: 'manage-token',
    metadataStrippingEnabled: false,
    rootKeyBase64Url: 'AQID',
    shareUrl: `https://example.com/t/${id}#k=test`,
    sourcePersisted: false,
    status: 'ready',
    totalBytes: 2048,
    totalFiles: 2,
    uploadedBytes: 2048,
    ...overrides,
  }
}

describe('ShareCard', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-20T10:00:00.000Z'))
    toDataUrlMock.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps the normal share actions for active transfers', async () => {
    render(
      <MemoryRouter>
        <ShareCard
          transfer={createTransfer('active-1', 'Active transfer', '2026-03-21T10:00:00.000Z')}
        />
      </MemoryRouter>,
    )

    await act(async () => {
      await Promise.resolve()
    })

    expect(screen.getByRole('heading', { name: /Share the full link/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Copy link/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Share link/i })).toBeInTheDocument()
    expect(screen.getByAltText('Transfer QR code')).toBeInTheDocument()
    expect(toDataUrlMock).toHaveBeenCalledTimes(1)
  })

  it('switches expired transfers into an archive-style state', () => {
    render(
      <MemoryRouter>
        <ShareCard
          transfer={createTransfer('expired-1', 'Expired transfer', '2026-03-19T10:00:00.000Z')}
        />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: /This transfer expired/i })).toBeInTheDocument()
    expect(screen.getByText('Expired transfer')).toBeInTheDocument()
    expect(screen.getByText(/Recipients opening the saved/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Copy link/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Share link/i })).not.toBeInTheDocument()
    expect(screen.queryByAltText('Transfer QR code')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Manage transfers/i })).toBeInTheDocument()
    expect(toDataUrlMock).not.toHaveBeenCalled()
  })
})

import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { LocalTransferRecord } from '@/lib/indexeddb/db'

const { deleteTransferMock, extendTransferMock, transfersState } = vi.hoisted(() => ({
  transfersState: [] as LocalTransferRecord[],
  deleteTransferMock: vi.fn(async () => {}),
  extendTransferMock: vi.fn(async () => {}),
}))

vi.mock('@/features/upload/TransferContext', () => ({
  useTransfers: () => ({
    transfers: transfersState,
    deleteTransfer: deleteTransferMock,
    extendTransfer: extendTransferMock,
  }),
}))

import { HistoryBoard } from './HistoryBoard'

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
    shareUrl: `https://example.com/t/${id}`,
    sourcePersisted: false,
    status: 'ready',
    totalBytes: 2048,
    totalFiles: 2,
    uploadedBytes: 2048,
    ...overrides,
  }
}

describe('HistoryBoard', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-20T10:00:00.000Z'))
    transfersState.splice(0, transfersState.length)
    deleteTransferMock.mockClear()
    extendTransferMock.mockClear()
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn(async () => {}),
      },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function renderBoard() {
    return render(
      <MemoryRouter>
        <HistoryBoard />
      </MemoryRouter>,
    )
  }

  it('collapses expired transfers by default and expands them on demand', async () => {
    transfersState.splice(
      0,
      transfersState.length,
      createTransfer('active-1', 'Active transfer', '2026-03-21T10:00:00.000Z'),
      createTransfer('expired-1', 'Expired transfer', '2026-03-19T10:00:00.000Z'),
    )

    renderBoard()

    expect(screen.getByText('Active transfer')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Expired transfers/i })).toBeInTheDocument()
    expect(screen.queryByText('Expired transfer')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Expired transfers/i }))

    const expiredCard = screen.getByText('Expired transfer').closest('.history-transfer-card')

    expect(expiredCard).not.toBeNull()
    expect(screen.getByText('Expired transfer')).toBeInTheDocument()
    expect(
      within(expiredCard as HTMLElement).queryByRole('button', { name: /Copy link/i }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Restore for 1 week/i })).not.toBeInTheDocument()
  })

  it('does not show the empty state when only expired transfers exist', () => {
    transfersState.splice(
      0,
      transfersState.length,
      createTransfer('expired-1', 'Expired transfer', '2026-03-19T10:00:00.000Z'),
    )

    renderBoard()

    expect(screen.queryByText('No transfers on this device')).not.toBeInTheDocument()
  })

  it('shows the empty state when no transfers exist', () => {
    renderBoard()

    expect(screen.getByText('No transfers on this device')).toBeInTheDocument()
  })

  it('copies links, shows progress, and renders local warnings for active transfers', async () => {
    transfersState.splice(
      0,
      transfersState.length,
      createTransfer('uploading-1', 'Uploading transfer', '2026-03-21T10:00:00.000Z', {
        lastError: 'Upload paused by network',
        localManagementCleared: true,
        status: 'uploading',
        totalBytes: 4000,
        uploadedBytes: 1000,
      }),
      createTransfer('local-only-1', 'Local only transfer', '2026-03-21T10:00:00.000Z', {
        manageToken: '',
      }),
    )

    renderBoard()

    expect(screen.getByText('25% uploaded')).toBeInTheDocument()
    expect(screen.getByText(/Privacy mode removed local transfer controls/i)).toBeInTheDocument()
    expect(screen.getByText('Upload paused by network')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Forget local copy' })).toBeInTheDocument()

    const uploadingCard = screen.getByText('Uploading transfer').closest('.card')
    expect(uploadingCard).not.toBeNull()
    expect(
      within(uploadingCard as HTMLElement).getByRole('link', { name: 'Open share page' }),
    ).toHaveAttribute('href', '/share/uploading-1')

    fireEvent.click(within(uploadingCard as HTMLElement).getByRole('button', { name: 'Copy link' }))

    await act(async () => {
      await Promise.resolve()
    })

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://example.com/t/uploading-1')
    expect(
      within(uploadingCard as HTMLElement).getByRole('button', { name: 'Copied' }),
    ).toBeInTheDocument()

    await act(async () => {
      vi.advanceTimersByTime(1800)
    })

    expect(
      within(uploadingCard as HTMLElement).getByRole('button', { name: 'Copy link' }),
    ).toBeInTheDocument()
  })

  it('surfaces async action failures and clears stale errors before retrying', async () => {
    transfersState.splice(
      0,
      transfersState.length,
      createTransfer('ready-1', 'Ready transfer', '2026-03-21T10:00:00.000Z'),
    )
    extendTransferMock.mockRejectedValueOnce(new Error('Extend failed'))
    deleteTransferMock.mockRejectedValueOnce('unexpected')

    renderBoard()

    fireEvent.click(screen.getByRole('button', { name: /Set expiry to 1 week from now/i }))

    await act(async () => {
      await Promise.resolve()
    })

    expect(screen.getByText('Extend failed')).toBeInTheDocument()
    expect(extendTransferMock).toHaveBeenCalledWith('ready-1', expect.any(Number))

    extendTransferMock.mockResolvedValueOnce(undefined)
    fireEvent.click(screen.getByRole('button', { name: /Set expiry to 1 week from now/i }))

    await act(async () => {
      await Promise.resolve()
    })

    expect(screen.queryByText('Extend failed')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(
      screen.getByText(/Confirm delete to remove this transfer from this device/i),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))

    await act(async () => {
      await Promise.resolve()
    })

    expect(screen.getByText('Could not update this transfer right now.')).toBeInTheDocument()
    expect(deleteTransferMock).toHaveBeenCalledWith('ready-1')
  })

  it('shows a scoped fallback when clipboard access is unavailable', async () => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn(async () => {
          throw new Error('denied')
        }),
      },
    })
    transfersState.splice(
      0,
      transfersState.length,
      createTransfer('ready-2', 'Ready transfer', '2026-03-21T10:00:00.000Z'),
    )

    renderBoard()

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))

    await act(async () => {
      await Promise.resolve()
    })

    expect(
      screen.getByText(/Open the share page to copy the full link manually/i),
    ).toBeInTheDocument()
  })
})

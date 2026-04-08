import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { LocalTransferRecord } from '@/lib/indexeddb/db'

const { deleteTransferMock, transfersState } = vi.hoisted(() => ({
  transfersState: [] as LocalTransferRecord[],
  deleteTransferMock: vi.fn(async () => {}),
}))

vi.mock('@/features/upload/TransferContext', () => ({
  useTransfers: () => ({
    transfers: transfersState,
    deleteTransfer: deleteTransferMock,
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
      screen.queryByRole('button', { name: /Set expiry to 1 week from now/i }),
    ).not.toBeInTheDocument()
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

  it('shows progress and renders local warnings for active transfers', () => {
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
  })

  it('surfaces async action failures and clears stale errors before retrying', async () => {
    transfersState.splice(
      0,
      transfersState.length,
      createTransfer('ready-1', 'Ready transfer', '2026-03-21T10:00:00.000Z'),
    )
    deleteTransferMock.mockRejectedValueOnce('unexpected')

    renderBoard()

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))

    await act(async () => {
      await Promise.resolve()
    })

    expect(screen.getByText('Could not update this transfer right now.')).toBeInTheDocument()
    expect(deleteTransferMock).toHaveBeenCalledWith('ready-1')
  })

  it('lets local-only transfers cancel a pending forget action and clears stale errors on retry', async () => {
    transfersState.splice(
      0,
      transfersState.length,
      createTransfer('local-only-2', 'Forgotten transfer', '2026-03-21T10:00:00.000Z', {
        manageToken: '',
      }),
    )
    deleteTransferMock.mockRejectedValueOnce(new Error('Delete failed'))
    deleteTransferMock.mockResolvedValueOnce(undefined)

    renderBoard()

    fireEvent.click(screen.getByRole('button', { name: 'Forget local copy' }))
    expect(screen.getByText(/Confirm forget to remove this local record/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm forget' }))

    await act(async () => {
      await Promise.resolve()
    })

    expect(screen.getByText('Delete failed')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('button', { name: 'Confirm forget' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Forget local copy' }))
    expect(screen.queryByText('Delete failed')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm forget' }))

    await act(async () => {
      await Promise.resolve()
    })

    expect(deleteTransferMock).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('button', { name: 'Confirm forget' })).not.toBeInTheDocument()
  })
})

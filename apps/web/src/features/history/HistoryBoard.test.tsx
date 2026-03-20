import { fireEvent, render, screen, within } from '@testing-library/react'
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
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('collapses expired transfers by default and expands them on demand', async () => {
    transfersState.splice(
      0,
      transfersState.length,
      createTransfer('active-1', 'Active transfer', '2026-03-21T10:00:00.000Z'),
      createTransfer('expired-1', 'Expired transfer', '2026-03-19T10:00:00.000Z'),
    )

    render(<HistoryBoard />)

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

    render(<HistoryBoard />)

    expect(screen.queryByText('No transfers on this device')).not.toBeInTheDocument()
  })
})

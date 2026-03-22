import { act, fireEvent, render, screen } from '@testing-library/react'
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
  const extendTransferMock = vi.fn(async () => {})

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-20T10:00:00.000Z'))
    toDataUrlMock.mockClear()
    extendTransferMock.mockClear()
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn(async () => {}),
      },
      share: undefined,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps the normal share actions for active transfers', async () => {
    render(
      <MemoryRouter>
        <ShareCard
          transfer={createTransfer('active-1', 'Active transfer', '2026-03-21T10:00:00.000Z')}
          onExtendTransfer={extendTransferMock}
        />
      </MemoryRouter>,
    )

    await act(async () => {
      await Promise.resolve()
    })

    expect(screen.getByRole('heading', { name: /Share this transfer/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Copy link/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Share link/i })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Set expiry to 1 week from now/i }),
    ).toBeInTheDocument()
    expect(
      screen.queryByDisplayValue('https://example.com/t/active-1#k=test'),
    ).not.toBeInTheDocument()
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

  it('renders a missing-transfer state when no local record exists', () => {
    render(
      <MemoryRouter>
        <ShareCard transfer={undefined} />
      </MemoryRouter>,
    )

    expect(screen.getByText('Transfer not on this device')).toBeInTheDocument()
    expect(
      screen.getByText('Open it in the same browser on the device that created it.'),
    ).toBeInTheDocument()
  })

  it('copies the full link and resets the copied state', async () => {
    render(
      <MemoryRouter>
        <ShareCard
          transfer={createTransfer('active-2', 'Copied transfer', '2026-03-21T10:00:00.000Z')}
          onExtendTransfer={extendTransferMock}
        />
      </MemoryRouter>,
    )

    await act(async () => {
      await Promise.resolve()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))

    await act(async () => {
      await Promise.resolve()
    })

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      'https://example.com/t/active-2#k=test',
    )
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument()

    await act(async () => {
      vi.advanceTimersByTime(1800)
    })

    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument()
  })

  it('uses the platform share sheet when available', async () => {
    const shareMock = vi.fn(async () => {})
    Object.assign(navigator, { share: shareMock })

    render(
      <MemoryRouter>
        <ShareCard
          transfer={createTransfer('active-3', 'Shared transfer', '2026-03-21T10:00:00.000Z')}
          onExtendTransfer={extendTransferMock}
        />
      </MemoryRouter>,
    )

    await act(async () => {
      await Promise.resolve()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Share link' }))

    await act(async () => {
      await Promise.resolve()
    })

    expect(shareMock).toHaveBeenCalledWith({
      text: 'Encrypted files via Xdrop',
      title: 'Shared transfer',
      url: 'https://example.com/t/active-3#k=test',
    })
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
  })

  it('falls back to copying when the share sheet is unavailable', async () => {
    render(
      <MemoryRouter>
        <ShareCard
          transfer={createTransfer('active-4', 'Fallback transfer', '2026-03-21T10:00:00.000Z')}
          onExtendTransfer={extendTransferMock}
        />
      </MemoryRouter>,
    )

    await act(async () => {
      await Promise.resolve()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Share link' }))

    await act(async () => {
      await Promise.resolve()
    })

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      'https://example.com/t/active-4#k=test',
    )
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument()
  })

  it('shows a retry-focused fallback when clipboard access fails', async () => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn(async () => {
          throw new Error('denied')
        }),
      },
    })

    render(
      <MemoryRouter>
        <ShareCard
          transfer={createTransfer('active-6', 'Clipboard fallback', '2026-03-21T10:00:00.000Z')}
          onExtendTransfer={extendTransferMock}
        />
      </MemoryRouter>,
    )

    await act(async () => {
      await Promise.resolve()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))

    await act(async () => {
      await Promise.resolve()
    })

    expect(
      screen.getByText(/Use your browser share tools or try again on this device/i),
    ).toBeInTheDocument()
    expect(
      screen.queryByDisplayValue('https://example.com/t/active-6#k=test'),
    ).not.toBeInTheDocument()
  })

  it('ignores canceled share-sheet requests without surfacing an error', async () => {
    const shareMock = vi.fn(async () => {
      throw new DOMException('dismissed', 'AbortError')
    })
    Object.assign(navigator, { share: shareMock })

    render(
      <MemoryRouter>
        <ShareCard
          transfer={createTransfer('active-7', 'Dismissed share', '2026-03-21T10:00:00.000Z')}
          onExtendTransfer={extendTransferMock}
        />
      </MemoryRouter>,
    )

    await act(async () => {
      await Promise.resolve()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Share link' }))

    await act(async () => {
      await Promise.resolve()
    })

    expect(shareMock).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/copy failed/i)).not.toBeInTheDocument()
  })

  it('renders sender guidance for paused, failed, deleted, and uploading transfers', async () => {
    const pausedTransfer = createTransfer(
      'paused-1',
      'Paused transfer',
      '2026-03-21T10:00:00.000Z',
      {
        localManagementCleared: true,
        status: 'paused',
        totalBytes: 4000,
        uploadedBytes: 1000,
      },
    )
    const failedTransfer = createTransfer(
      'failed-1',
      'Failed transfer',
      '2026-03-21T10:00:00.000Z',
      {
        status: 'failed',
        totalBytes: 4000,
        uploadedBytes: 1000,
      },
    )
    const deletedTransfer = createTransfer(
      'deleted-1',
      'Deleted transfer',
      '2026-03-21T10:00:00.000Z',
      {
        status: 'deleted',
      },
    )
    const uploadingTransfer = createTransfer(
      'uploading-1',
      'Uploading transfer',
      '2026-03-21T10:00:00.000Z',
      {
        status: 'uploading',
        totalBytes: 4000,
        uploadedBytes: 1000,
      },
    )

    const { rerender } = render(
      <MemoryRouter>
        <ShareCard transfer={pausedTransfer} onExtendTransfer={extendTransferMock} />
      </MemoryRouter>,
    )

    await act(async () => {
      await Promise.resolve()
    })

    expect(screen.getByText('25% uploaded')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Upload will continue automatically when you return here in the same browser on this device.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText(/Privacy mode removed local transfer controls/i)).toBeInTheDocument()

    rerender(
      <MemoryRouter>
        <ShareCard transfer={failedTransfer} onExtendTransfer={extendTransferMock} />
      </MemoryRouter>,
    )
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByText('Upload stopped in this browser on this device.')).toBeInTheDocument()

    rerender(
      <MemoryRouter>
        <ShareCard transfer={deletedTransfer} onExtendTransfer={extendTransferMock} />
      </MemoryRouter>,
    )
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByText('This transfer was deleted.')).toBeInTheDocument()
    expect(screen.queryByText(/uploaded/i)).not.toBeInTheDocument()

    rerender(
      <MemoryRouter>
        <ShareCard transfer={uploadingTransfer} onExtendTransfer={extendTransferMock} />
      </MemoryRouter>,
    )
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByText('The link will work once the upload finishes.')).toBeInTheDocument()
  })

  it('extends expiry from the share page and surfaces failures locally', async () => {
    extendTransferMock.mockRejectedValueOnce(new Error('Extend failed'))

    const transfer = createTransfer('active-8', 'Extend transfer', '2026-03-21T10:00:00.000Z')
    const { rerender } = render(
      <MemoryRouter>
        <ShareCard transfer={transfer} onExtendTransfer={extendTransferMock} />
      </MemoryRouter>,
    )

    await act(async () => {
      await Promise.resolve()
    })

    fireEvent.click(screen.getByRole('button', { name: /Set expiry to 1 week from now/i }))

    await act(async () => {
      await Promise.resolve()
    })

    expect(extendTransferMock).toHaveBeenCalledWith('active-8', 7 * 24 * 60 * 60)
    expect(screen.getByText('Extend failed')).toBeInTheDocument()

    extendTransferMock.mockResolvedValueOnce(undefined)
    rerender(
      <MemoryRouter>
        <ShareCard transfer={transfer} onExtendTransfer={extendTransferMock} />
      </MemoryRouter>,
    )

    await act(async () => {
      await Promise.resolve()
    })

    fireEvent.click(screen.getByRole('button', { name: /Set expiry to 1 week from now/i }))

    await act(async () => {
      await Promise.resolve()
    })

    expect(screen.queryByText('Extend failed')).not.toBeInTheDocument()
  })

  it('hides the extend action when local management is unavailable', async () => {
    render(
      <MemoryRouter>
        <ShareCard
          transfer={createTransfer('active-9', 'No manage token', '2026-03-21T10:00:00.000Z', {
            manageToken: '',
          })}
          onExtendTransfer={extendTransferMock}
        />
      </MemoryRouter>,
    )

    await act(async () => {
      await Promise.resolve()
    })

    expect(
      screen.queryByRole('button', { name: /Set expiry to 1 week from now/i }),
    ).not.toBeInTheDocument()
  })

  it('keeps the QR placeholder when QR generation fails', async () => {
    toDataUrlMock.mockRejectedValueOnce(new Error('QR failed'))

    render(
      <MemoryRouter>
        <ShareCard
          transfer={createTransfer('active-5', 'Broken QR transfer', '2026-03-21T10:00:00.000Z')}
          onExtendTransfer={extendTransferMock}
        />
      </MemoryRouter>,
    )

    await act(async () => {
      await Promise.resolve()
    })

    expect(screen.queryByAltText('Transfer QR code')).not.toBeInTheDocument()
    expect(document.querySelector('.qr-placeholder')).not.toBeNull()
  })
})

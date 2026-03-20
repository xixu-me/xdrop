import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

const { usePageMetadataMock, useTransfersMock } = vi.hoisted(() => ({
  usePageMetadataMock: vi.fn(),
  useTransfersMock: vi.fn(() => ({
    transfers: [
      {
        id: 't1',
      },
    ],
  })),
}))

const { shareCardMock } = vi.hoisted(() => ({
  shareCardMock: vi.fn(({ transfer }: { transfer?: { id: string } }) => (
    <div>Share {transfer?.id ?? 'missing'}</div>
  )),
}))

vi.mock('@/features/share/ShareCard', () => ({
  ShareCard: shareCardMock,
}))

vi.mock('@/features/upload/TransferContext', () => ({
  useTransfers: useTransfersMock,
}))

vi.mock('@/lib/seo/usePageMetadata', () => ({
  usePageMetadata: usePageMetadataMock,
}))

import { SharePage } from './SharePage'

describe('SharePage', () => {
  it('looks up the transfer from context and renders the share card', () => {
    render(
      <MemoryRouter initialEntries={['/share/t1']}>
        <Routes>
          <Route path="/share/:transferId" element={<SharePage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(usePageMetadataMock).toHaveBeenCalledWith(
      expect.objectContaining({
        exposeUrl: false,
        title: 'Share the Full Link | Xdrop',
      }),
    )
    expect(screen.getByText('Share t1')).toBeInTheDocument()
  })
})

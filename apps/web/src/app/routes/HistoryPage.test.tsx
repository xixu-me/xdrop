import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

const { historyBoardMock, usePageMetadataMock } = vi.hoisted(() => ({
  historyBoardMock: vi.fn(() => <div>History board</div>),
  usePageMetadataMock: vi.fn(),
}))

vi.mock('@/features/history/HistoryBoard', () => ({
  HistoryBoard: historyBoardMock,
}))

vi.mock('@/lib/seo/usePageMetadata', () => ({
  usePageMetadata: usePageMetadataMock,
}))

import { HistoryPage } from './HistoryPage'

describe('HistoryPage', () => {
  it('applies private metadata and renders the history board', () => {
    render(
      <MemoryRouter>
        <HistoryPage />
      </MemoryRouter>,
    )

    expect(usePageMetadataMock).toHaveBeenCalledWith(
      expect.objectContaining({
        description:
          'Manage Xdrop end-to-end encrypted file transfers stored in this browser on this device. Plaintext file names, contents, and keys stay off the server.',
        exposeUrl: false,
        title: 'Manage End-to-End Encrypted Transfers on This Device | Xdrop',
      }),
    )
    expect(screen.getByText('History board')).toBeInTheDocument()
  })
})

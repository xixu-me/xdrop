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
        exposeUrl: false,
        title: 'Manage Transfers on This Device | Xdrop',
      }),
    )
    expect(screen.getByText('History board')).toBeInTheDocument()
  })
})

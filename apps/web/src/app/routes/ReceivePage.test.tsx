import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

const { receiveTransferMock } = vi.hoisted(() => ({
  receiveTransferMock: vi.fn(({ transferId }: { transferId: string }) => (
    <div>Receive {transferId}</div>
  )),
}))

vi.mock('@/features/receive/ReceiveTransfer', () => ({
  ReceiveTransfer: receiveTransferMock,
}))

import { ReceivePage } from './ReceivePage'

describe('ReceivePage', () => {
  it('renders the transfer receiver when the route contains an id', () => {
    render(
      <MemoryRouter initialEntries={['/t/abc123']}>
        <Routes>
          <Route path="/t/:transferId" element={<ReceivePage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByText('Receive abc123')).toBeInTheDocument()
  })

  it('renders nothing when the route does not include a transfer id', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/t']}>
        <Routes>
          <Route path="/t" element={<ReceivePage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(container).toBeEmptyDOMElement()
  })
})

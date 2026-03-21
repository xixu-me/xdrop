import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { NotFoundPage } from './NotFoundPage'

describe('NotFoundPage', () => {
  it('shows recovery guidance', () => {
    render(
      <MemoryRouter initialEntries={['/missing-route?from=test']}>
        <NotFoundPage />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: 'This page was not found.' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Try these checks' })).toBeInTheDocument()
    expect(
      screen.getByText('Try the device and browser that created the transfer'),
    ).toBeInTheDocument()
  })
})

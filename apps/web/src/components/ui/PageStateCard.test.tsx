import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { PageStateCard } from './PageStateCard'

describe('PageStateCard', () => {
  it('renders the default eyebrow and optional children', () => {
    render(
      <PageStateCard body="Body copy" title="Working">
        <button type="button">Retry</button>
      </PageStateCard>,
    )

    expect(screen.getByText('Status')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Working' })).toBeInTheDocument()
    expect(screen.getByText('Body copy')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })
})

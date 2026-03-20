import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { StatusBadge } from './StatusBadge'

describe('StatusBadge', () => {
  it.each([
    ['draft', 'Draft'],
    ['preparing', 'Preparing'],
    ['uploading', 'Uploading'],
    ['paused', 'Continuing'],
    ['ready', 'Ready'],
    ['failed', 'Failed'],
    ['expired', 'Expired'],
    ['deleted', 'Deleted'],
    ['custom', 'custom'],
  ])('renders %s as %s', (status, label) => {
    render(<StatusBadge status={status} />)

    const badge = screen.getByText(label)
    expect(badge).toHaveClass(`status-badge--${status}`)
  })
})

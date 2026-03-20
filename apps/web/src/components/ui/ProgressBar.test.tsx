import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ProgressBar } from './ProgressBar'

describe('ProgressBar', () => {
  it('renders a label and clamps values above 100', () => {
    const { container } = render(<ProgressBar value={125} label="Uploaded" />)

    expect(screen.getByText('Uploaded')).toBeInTheDocument()
    expect(container.querySelector('.progress__fill')).toHaveStyle({ width: '100%' })
  })

  it('omits the label and clamps values below 0', () => {
    const { container } = render(<ProgressBar value={-5} />)

    expect(screen.queryByText(/uploaded/i)).not.toBeInTheDocument()
    expect(container.querySelector('.progress__fill')).toHaveStyle({ width: '0%' })
  })
})

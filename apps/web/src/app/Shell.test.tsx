import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { AUTHOR_NAME, AUTHOR_URL, LICENSE_URL, REPOSITORY_URL } from '@/lib/seo/site'

import { Shell } from './Shell'

describe('Shell', () => {
  it('renders navigation and the nested outlet', () => {
    render(
      <MemoryRouter initialEntries={['/transfers']}>
        <Routes>
          <Route element={<Shell />}>
            <Route path="/transfers" element={<div>Transfers content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: 'Xdrop' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: 'Send' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: 'Transfers' })).toHaveAttribute('href', '/transfers')
    expect(screen.getByText('End-to-end encrypted file transfer')).toBeInTheDocument()
    expect(screen.getByText('Transfers content')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View the license' }).closest('p')).toHaveTextContent(
      `Developed by ${AUTHOR_NAME} and released under the GNU Affero General Public License v3.0 only.`,
    )
    expect(screen.getByRole('link', { name: 'View the license' }).closest('p')).toHaveTextContent(
      'more information and source code on GitHub.',
    )
    expect(screen.getByRole('link', { name: 'View the license' })).toHaveAttribute(
      'href',
      LICENSE_URL,
    )
    expect(screen.getByRole('link', { name: 'GitHub' })).toHaveAttribute('href', REPOSITORY_URL)
    expect(screen.getByRole('link', { name: AUTHOR_NAME })).toHaveAttribute('href', AUTHOR_URL)
  })
})

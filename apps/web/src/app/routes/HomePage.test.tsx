import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

const { uploadStudioMock, usePageMetadataMock } = vi.hoisted(() => ({
  uploadStudioMock: vi.fn(() => <div>Upload studio</div>),
  usePageMetadataMock: vi.fn(),
}))

vi.mock('@/features/upload/UploadStudio', () => ({
  UploadStudio: uploadStudioMock,
}))

vi.mock('@/lib/seo/usePageMetadata', () => ({
  usePageMetadata: usePageMetadataMock,
}))

import { HomePage } from './HomePage'

describe('HomePage', () => {
  it('applies homepage metadata and renders the upload studio', () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    )

    expect(usePageMetadataMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Open Source End-to-End Encrypted File Transfer for Humans and Agents | Xdrop',
        structuredData: expect.arrayContaining([
          expect.objectContaining({
            '@type': 'Organization',
            name: 'Xdrop',
            logo: expect.objectContaining({
              url: expect.stringContaining('/brand-symbol-512.png'),
            }),
          }),
        ]),
      }),
    )
    expect(screen.getByText('Upload studio')).toBeInTheDocument()
  })
})

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  DEFAULT_EXPIRY_SECONDS,
  EXPIRY_OPTIONS,
  MAX_TRANSFER_BYTES,
  type ExpiryOption,
} from '@xdrop/shared'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { LocalTransferRecord } from '@/lib/indexeddb/db'

const {
  clearDraftMock,
  createTransferMock,
  draftState,
  loadDraftMock,
  navigateMock,
  persistDraftMock,
  saveDraftSettingsMock,
  transfersState,
} = vi.hoisted(() => {
  const transfers: LocalTransferRecord[] = []
  const state = {
    settings: {
      displayName: '',
      expiresInSeconds: 3600 as ExpiryOption,
      stripMetadata: true,
    },
    sources: [] as Array<{
      draftKey?: string
      file: File
      relativePath: string
    }>,
  }

  return {
    transfersState: transfers,
    draftState: state,
    createTransferMock: vi.fn(),
    navigateMock: vi.fn(),
    loadDraftMock: vi.fn(async () => ({
      settings: { ...state.settings },
      sources: state.sources.map((source) => ({ ...source })),
    })),
    persistDraftMock: vi.fn(async (sources: typeof state.sources) => {
      state.sources = sources.map((source, index) => ({
        ...source,
        draftKey: source.draftKey ?? `draft-${index + 1}`,
      }))
      return state.sources.map((source) => ({ ...source }))
    }),
    clearDraftMock: vi.fn(async () => {
      state.sources = []
    }),
    saveDraftSettingsMock: vi.fn((settings: typeof state.settings) => {
      state.settings = { ...settings }
    }),
  }
})

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()

  return {
    ...actual,
    useNavigate: () => navigateMock,
  }
})

vi.mock('./TransferContext', async () => {
  return {
    defaultTransferName: (sources: Array<{ relativePath: string }>) =>
      sources[0]?.relativePath.split('/').at(-1) ?? 'Untitled transfer',
    useTransfers: () => ({
      createTransfer: createTransferMock,
      deleteTransfer: vi.fn(),
      extendTransfer: vi.fn(),
      refreshTransfers: vi.fn(),
      transfers: transfersState,
    }),
  }
})

vi.mock('./uploadSelectionDraft', () => ({
  clearUploadSelectionDraft: clearDraftMock,
  loadUploadSelectionDraft: loadDraftMock,
  persistUploadSelectionDraftSources: persistDraftMock,
  saveUploadSelectionDraftSettings: saveDraftSettingsMock,
}))

import { UploadStudio } from './UploadStudio'

function renderStudio() {
  return render(
    <MemoryRouter>
      <UploadStudio />
    </MemoryRouter>,
  )
}

function createTransferRecord(
  status: LocalTransferRecord['status'],
  overrides: Partial<LocalTransferRecord> = {},
): LocalTransferRecord {
  return {
    clearLocalSecretsOnReady: false,
    createdAt: '2026-03-20T10:00:00.000Z',
    displayName: 'Transfer 1',
    expiresAt: '2026-03-21T10:00:00.000Z',
    files: [],
    id: 't1',
    linkKeyBase64Url: 'AQID',
    localManagementCleared: false,
    manageToken: 'manage-token',
    metadataStrippingEnabled: false,
    rootKeyBase64Url: 'AQID',
    shareUrl: 'https://example.com/t/t1',
    sourcePersisted: true,
    status,
    totalBytes: 2048,
    totalFiles: 2,
    uploadedBytes: 512,
    ...overrides,
  }
}

describe('UploadStudio', () => {
  beforeEach(() => {
    createTransferMock.mockReset()
    createTransferMock.mockResolvedValue('t-created')
    loadDraftMock.mockReset()
    loadDraftMock.mockImplementation(async () => ({
      settings: { ...draftState.settings },
      sources: draftState.sources.map((source) => ({ ...source })),
    }))
    persistDraftMock.mockReset()
    persistDraftMock.mockImplementation(async (sources: typeof draftState.sources) => {
      draftState.sources = sources.map((source, index) => ({
        ...source,
        draftKey: source.draftKey ?? `draft-${index + 1}`,
      }))
      return draftState.sources.map((source) => ({ ...source }))
    })
    clearDraftMock.mockReset()
    clearDraftMock.mockImplementation(async () => {
      draftState.sources = []
    })
    saveDraftSettingsMock.mockReset()
    saveDraftSettingsMock.mockImplementation((settings: typeof draftState.settings) => {
      draftState.settings = { ...settings }
    })
    navigateMock.mockReset()
    transfersState.splice(0, transfersState.length)
    draftState.settings = {
      displayName: '',
      expiresInSeconds: DEFAULT_EXPIRY_SECONDS,
      stripMetadata: true,
    }
    draftState.sources = []
  })

  it('shows messaging-aligned positioning for humans and agents', async () => {
    renderStudio()

    expect(await screen.findByText('End-to-end encrypted file transfer.')).toBeInTheDocument()
    expect(
      screen.getByText(
        /end-to-end encrypted file transfer app for humans and agents, keeping plaintext file names, contents, and keys off the server\./,
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        /Humans can use Xdrop in the browser for direct sharing, and agents can use Xdrop/i,
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'through an agent' })).toHaveAttribute(
      'href',
      'https://github.com/xixu-me/xdrop?tab=readme-ov-file#use-via-agents',
    )
    expect(
      screen.getByText(
        /Use the web app to drop files or a folder\. Names, paths, and file contents are encrypted in this browser before upload\./,
      ),
    ).toBeInTheDocument()
  })

  it('blocks selections that exceed the transfer size limit', async () => {
    const { container } = renderStudio()

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    const oversizedFile = {
      name: 'oversized.bin',
      size: MAX_TRANSFER_BYTES + 1,
      lastModified: 1,
      type: 'application/octet-stream',
      webkitRelativePath: '',
    } as File

    fireEvent.change(fileInput, { target: { files: [oversizedFile] } })

    expect(
      await screen.findByText(
        /This selection would upload about .* The limit is 256 MiB per transfer\./,
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start transfer' })).toBeDisabled()
    expect(screen.getByText('Nothing selected')).toBeInTheDocument()
    expect(createTransferMock).not.toHaveBeenCalled()
  })

  it('restores the current selection after a refresh', async () => {
    draftState.sources = [
      {
        draftKey: 'draft-1',
        file: new File(['hello'], 'draft.txt', { lastModified: 12, type: 'text/plain' }),
        relativePath: 'draft.txt',
      },
    ]

    renderStudio()

    expect(await screen.findByText('draft.txt')).toBeInTheDocument()
    expect(screen.queryByText('Nothing selected')).not.toBeInTheDocument()
  })

  it('shows a recovery error when draft restoration fails', async () => {
    loadDraftMock.mockRejectedValueOnce(new Error('restore failed'))

    renderStudio()

    expect(await screen.findByText('restore failed')).toBeInTheDocument()
  })

  it('falls back to default messages for non-Error draft restoration and launch failures', async () => {
    loadDraftMock.mockRejectedValueOnce('boom')

    const { container } = renderStudio()

    expect(await screen.findByText("Couldn't restore the previous selection.")).toBeInTheDocument()

    createTransferMock.mockRejectedValueOnce('boom')
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: {
        files: [new File(['hello'], 'draft.txt', { lastModified: 12, type: 'text/plain' })],
      },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start transfer' }))

    expect(await screen.findByText('Could not start the transfer.')).toBeInTheDocument()
  })

  it('starts a transfer with trimmed settings, clears the draft, and navigates', async () => {
    const { container } = renderStudio()
    const file = new File(['hello'], 'draft.txt', { lastModified: 12, type: 'text/plain' })
    const toggleInputs = Array.from(
      container.querySelectorAll('label.toggle input[type="checkbox"]'),
    ) as HTMLInputElement[]

    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [file] },
    })
    fireEvent.change(screen.getByLabelText('Transfer name'), {
      target: { value: '  My upload  ' },
    })
    fireEvent.change(screen.getByLabelText('Expiry'), {
      target: { value: String(EXPIRY_OPTIONS.at(-1)?.value ?? DEFAULT_EXPIRY_SECONDS) },
    })
    fireEvent.click(toggleInputs[0] as HTMLElement)
    fireEvent.click(toggleInputs[1] as HTMLElement)
    fireEvent.click(screen.getByRole('button', { name: 'Start transfer' }))

    await waitFor(() => {
      expect(createTransferMock).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            file,
            relativePath: 'draft.txt',
          }),
        ],
        {
          clearLocalSecretsOnReady: true,
          displayName: 'My upload',
          expiresInSeconds: EXPIRY_OPTIONS.at(-1)?.value ?? DEFAULT_EXPIRY_SECONDS,
          stripMetadata: false,
        },
      )
    })
    expect(clearDraftMock).toHaveBeenCalled()
    expect(navigateMock).toHaveBeenCalledWith('/share/t-created')
  })

  it('does not persist privacy mode in saved draft settings', async () => {
    const { container } = renderStudio()
    const toggleInputs = Array.from(
      container.querySelectorAll('label.toggle input[type="checkbox"]'),
    ) as HTMLInputElement[]

    await waitFor(() => {
      expect(saveDraftSettingsMock).toHaveBeenCalledWith({
        displayName: '',
        expiresInSeconds: DEFAULT_EXPIRY_SECONDS,
        stripMetadata: true,
      })
    })

    saveDraftSettingsMock.mockClear()
    fireEvent.click(toggleInputs[1] as HTMLElement)

    expect(toggleInputs[1]).toBeChecked()
    expect(saveDraftSettingsMock).not.toHaveBeenCalled()
  })

  it('shows launch errors from createTransfer', async () => {
    createTransferMock.mockRejectedValueOnce(new Error('create failed'))

    const { container } = renderStudio()
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: {
        files: [new File(['hello'], 'draft.txt', { lastModified: 12, type: 'text/plain' })],
      },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start transfer' }))

    expect(await screen.findByText('create failed')).toBeInTheDocument()
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('shows an error when the draft cannot be persisted locally', async () => {
    persistDraftMock.mockRejectedValueOnce(new Error('persist failed'))

    const { container } = renderStudio()
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: {
        files: [new File(['hello'], 'draft.txt', { lastModified: 12, type: 'text/plain' })],
      },
    })

    expect(await screen.findByText('persist failed')).toBeInTheDocument()
  })

  it('falls back to a generic persistence error when draft persistence fails with a non-Error', async () => {
    persistDraftMock.mockRejectedValueOnce('persist failed')

    const { container } = renderStudio()

    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: {
        files: [new File(['folder'], 'nested.txt', { lastModified: 14, type: 'text/plain' })],
      },
    })

    expect(
      await screen.findByText("Couldn't keep this selection after refresh."),
    ).toBeInTheDocument()
  })

  it('avoids updating state when draft persistence resolves after unmount', async () => {
    const persistedFile = new File(['hello'], 'draft.txt', { lastModified: 12, type: 'text/plain' })
    let resolvePersist: ((sources: typeof draftState.sources) => void) | undefined
    persistDraftMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePersist = resolve
        }),
    )
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { container, unmount } = renderStudio()

    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [persistedFile] },
    })

    unmount()

    await act(async () => {
      resolvePersist?.([
        {
          draftKey: 'draft-1',
          file: persistedFile,
          relativePath: 'draft.txt',
        },
      ])
      await Promise.resolve()
    })

    expect(errorSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('avoids surfacing persistence errors after unmount', async () => {
    let rejectPersist: ((reason?: unknown) => void) | undefined
    persistDraftMock.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectPersist = reject
        }),
    )
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { container, unmount } = renderStudio()

    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: {
        files: [new File(['hello'], 'draft.txt', { lastModified: 12, type: 'text/plain' })],
      },
    })

    unmount()

    await act(async () => {
      rejectPersist?.(new Error('persist failed'))
      await Promise.resolve()
    })

    expect(errorSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('prefers webkitRelativePath over the bare filename when a folder is chosen', async () => {
    const { container } = renderStudio()
    const nestedFile = new File(['folder'], 'nested.txt', { lastModified: 14, type: 'text/plain' })
    Object.defineProperty(nestedFile, 'webkitRelativePath', {
      configurable: true,
      value: 'folder/nested.txt',
    })

    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [nestedFile] },
    })

    expect(await screen.findByText('folder/nested.txt')).toBeInTheDocument()
  })

  it('removes files from the draft and clears the whole selection', async () => {
    const { container } = renderStudio()
    const first = new File(['hello'], 'draft.txt', { lastModified: 12, type: 'text/plain' })
    const second = new File(['world'], 'notes.txt', { lastModified: 13, type: 'text/plain' })

    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [first, second] },
    })

    expect(await screen.findByText('draft.txt')).toBeInTheDocument()
    expect(screen.getByText('notes.txt')).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0] as HTMLElement)
    await waitFor(() => {
      expect(screen.queryByText('draft.txt')).not.toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }))
    await waitFor(() => {
      expect(screen.getByText('Nothing selected')).toBeInTheDocument()
    })
  })

  it('opens chooser buttons and handles folder input changes safely', async () => {
    const { container } = renderStudio()
    const chooserButtons = screen.getAllByRole('button', {
      name: /Choose (files|folder)/,
    })
    expect(chooserButtons).toHaveLength(2)
    const fileButton = chooserButtons[0]!
    const folderButton = chooserButtons[1]!
    const fileInputs = Array.from(
      container.querySelectorAll('input[type="file"]'),
    ) as HTMLInputElement[]
    expect(fileInputs).toHaveLength(2)
    const fileInput = fileInputs[0]!
    const folderInput = fileInputs[1]!
    const fileClickSpy = vi.spyOn(fileInput, 'click')
    const folderClickSpy = vi.spyOn(folderInput, 'click')

    fireEvent.click(fileButton)
    fireEvent.click(folderButton)
    fireEvent.change(folderInput, { target: { files: null } })
    fireEvent.change(folderInput, {
      target: {
        files: [new File(['folder'], 'nested.txt', { lastModified: 14, type: 'text/plain' })],
      },
    })

    expect(fileClickSpy).toHaveBeenCalled()
    expect(folderClickSpy).toHaveBeenCalled()
    expect(await screen.findByText('nested.txt')).toBeInTheDocument()
  })

  it('shows recent transfers with status badges, progress, and manage navigation', async () => {
    transfersState.splice(
      0,
      transfersState.length,
      createTransferRecord('uploading', {
        displayName: 'Uploading transfer',
        uploadedBytes: 1024,
      }),
      createTransferRecord('ready', {
        displayName: 'Ready transfer',
        id: 't2',
        status: 'ready',
        uploadedBytes: 2048,
      }),
    )

    renderStudio()

    expect(await screen.findByText('Uploading transfer')).toBeInTheDocument()
    expect(screen.getByText('50% uploaded')).toBeInTheDocument()
    expect(screen.getByText('Ready')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Manage transfers' }))
    expect(navigateMock).toHaveBeenCalledWith('/transfers')
  })

  it('handles drag events and falls back to dropped files', async () => {
    const { container } = renderStudio()
    const dropzone = container.querySelector('.dropzone') as HTMLElement
    const droppedFile = new File(['drop'], 'dropped.txt', { lastModified: 15, type: 'text/plain' })

    fireEvent.dragEnter(dropzone, { preventDefault: vi.fn() })
    expect(dropzone.className).toContain('dropzone--over')
    fireEvent.dragOver(dropzone, { preventDefault: vi.fn() })

    fireEvent.drop(dropzone, {
      dataTransfer: {
        files: [droppedFile],
        items: [],
      },
      preventDefault: vi.fn(),
    })

    expect(await screen.findByText('dropped.txt')).toBeInTheDocument()

    fireEvent.dragLeave(dropzone, { preventDefault: vi.fn() })
    expect(dropzone.className).toContain('dropzone--idle')
  })

  it('prefers dropped directory entries when available', async () => {
    const { container } = renderStudio()
    const dropzone = container.querySelector('.dropzone') as HTMLElement
    const nestedFile = new File(['dir'], 'nested.txt', { lastModified: 16, type: 'text/plain' })

    fireEvent.drop(dropzone, {
      dataTransfer: {
        files: [],
        items: [
          {
            webkitGetAsEntry: () => ({
              file: (callback: (file: File) => void) => callback(nestedFile),
              isDirectory: false,
              isFile: true,
              name: 'nested.txt',
            }),
          },
        ],
      },
      preventDefault: vi.fn(),
    })

    expect(await screen.findByText('nested.txt')).toBeInTheDocument()
  })
})
